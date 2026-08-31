import { appendBookingRecord, getBookingCalendar } from '../_lib/booking-store.js';
import { sendEmail } from '../_lib/email.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';
import { createAgreementToken, createReviewToken, json } from '../_lib/security.js';
import { cancelSquareInvoice } from '../_lib/square.js';
import { doorCodeTask, generateDoorCode } from '../_lib/door-code.js';

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function easternHour() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone:'America/New_York', hour:'2-digit', hourCycle:'h23'
  }).format(new Date()));
}
function shiftDate(value, days) { const date=new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10); }
function money(cents) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100); }
function selectedDates(booking) { return booking.dateChoices?.[Number.isInteger(booking.approvedChoice)?booking.approvedChoice:0] || booking.dateChoices?.[0] || {}; }
function midpoint(arrival,departure) { const nights=Math.max(1,Math.round((Date.parse(`${departure}T12:00:00Z`)-Date.parse(`${arrival}T12:00:00Z`))/86400000)); return shiftDate(arrival,Math.max(1,Math.floor(nights/2))); }
function checkoutDetails(booking) {
  const noCleaner=Boolean(booking.friendsAndFamilyDiscount) && booking.friendsAndFamilyDiscount.chargeCleaning !== true;
  return {
    checkoutChecklistUrl:`https://www.weekscreekhaven.com/checkout.html?token=${encodeURIComponent(createAgreementToken(booking.id,365*86400))}`,
    checkoutExtraSteps:noCleaner?'Friends & Family checkout — no cleaner is scheduled after this stay. Please strip used beds, clean the bathrooms you used, complete at least one load of linens, and leave the cabin ready for the next adventure. Don’t let the door hit you on the way out — say “Alexa, Going Home” for the quick exit routine.':'Your cleaner will handle beds, bathrooms, and laundry. Please do not strip the beds.',
  };
}

async function scheduledOwnerSend(booking, templateKey, variables, marker) {
  if (booking[marker] || !process.env.OWNER_EMAIL) return false;
  const result=await sendEmail({ to:process.env.OWNER_EMAIL, toName:'Lance & Heather', templateKey, templateVariables:variables, subject:'Review the Weeks Creek Haven security deposit', text:`Review ${booking.name}'s checkout and refund the refundable security deposit if no deductions are needed.`, html:`<p><strong>${booking.name}</strong> checked out. Review the stay, document any deductions, and issue the refundable security deposit through the Command Center.</p><p><a href="https://www.weekscreekhaven.com/admin.html">Open Command Center</a></p>`, idempotencyKey:`${booking.id}-${templateKey}` });
  if (result?.skipped) return false;
  const createdAt=new Date().toISOString();
  await appendBookingRecord({ type:'status', bookingId:booking.id, changes:{[marker]:createdAt}, createdAt });
  booking[marker]=createdAt;
  return true;
}

async function scheduledSend(booking, templateKey, variables, marker) {
  if (booking[marker] || !booking.email) return false;
  if (String(process.env.OWNER_EMAIL || '').trim().toLowerCase() === String(booking.email).trim().toLowerCase()) {
    console.warn(`Skipped guest email ${templateKey} for ${booking.id}: recipient is the owner address.`);
    return false;
  }
  const result=await sendEmail({ to:booking.email, toName:booking.name, templateKey, templateVariables:variables, subject:'Weeks Creek Haven stay update', text:`Hi ${booking.name},\n\nPlease review this update for your Weeks Creek Haven stay.`, html:`<p>Hi ${booking.name},</p><p>Please review this update for your Weeks Creek Haven stay.</p>`, idempotencyKey:`${booking.id}-${templateKey}` });
  if (result?.skipped) return false;
  const createdAt=new Date().toISOString();
  await appendBookingRecord({ type:'status', bookingId:booking.id, changes:{[marker]:createdAt}, createdAt });
  booking[marker]=createdAt;
  return true;
}

export default async function handler(request, response) {
  const secret=process.env.CRON_SECRET;
  if (!secret || request.headers.authorization !== `Bearer ${secret}`) return json(response, 401, { error:'Scheduled email authorization failed.' });
  if (request.method !== 'GET') return json(response, 405, { error:'Method not allowed.' });
  try {
    const today=easternToday();
    const hour=easternHour();
    // Vercel invokes this endpoint on UTC. Never allow an automatic email
    // outside the owner-approved daytime window in Blue Ridge local time.
    if (hour < 8 || hour >= 20) {
      return json(response, 200, { ok:true, deferred:true, reason:'Eastern quiet hours', sent:0 });
    }
    const calendar=await getBookingCalendar();
    const stored=calendar.bookings||[];
    let sent=0;
    for (let booking of stored) {
      if (!['pending-payment','reserved','booked','completed'].includes(booking.status) || !booking.email) continue;
      if (booking.squareInvoiceId && !booking.paymentFullyPaid) { try { booking=await refreshSquareBooking(booking); } catch { /* use last confirmed payment state */ } }
      const dates=selectedDates(booking); if (!dates.arrival || !dates.departure) continue;
      if(booking.status==='booked'&&!booking.doorCode){const doorCode=generateDoorCode(stored);const generatedAt=new Date().toISOString();await appendBookingRecord({type:'status',bookingId:booking.id,changes:{doorCode,doorCodeGeneratedAt:generatedAt,doorCodeInstalledAt:null,doorCodeRemovedAt:null,doorCodeGuestSentAt:null},createdAt:generatedAt});Object.assign(booking,{doorCode,doorCodeGeneratedAt:generatedAt});}
      const packetUrl=`https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(createAgreementToken(booking.id,365*86400))}`;
      const reviewUrl=`https://www.weekscreekhaven.com/review.html?token=${encodeURIComponent(createReviewToken(booking.id))}`;
      const common={ guestName:booking.name, arrival:dates.arrival, departure:dates.departure, checkout:booking.lateCheckout?'noon':'11:00 AM', packetUrl, paymentUrl:booking.paymentUrl||packetUrl, depositAmount:money(booking.depositAmountCents), balanceAmount:money(booking.squareBalanceCents ?? booking.balanceAmountCents), reviewUrl, bookingUrl:'https://www.weekscreekhaven.com/register.html', referralCode:booking.referralCode||'', securityDeposit:money(booking.securityDepositCents||0), adminUrl:'https://www.weekscreekhaven.com/admin.html', ...checkoutDetails(booking) };
      if (booking.earlyBirdExpiresAt && !booking.earlyBirdExpiredAt && Date.now() >= Date.parse(booking.earlyBirdExpiresAt) && (!booking.paymentRequirementMet || !booking.agreementAcceptedAt)) {
        if (booking.squareInvoiceId) { try { await cancelSquareInvoice(booking.squareInvoiceId); } catch { /* record expiration even if Square already closed the invoice */ } }
        const expiredAt=new Date().toISOString();
        await appendBookingRecord({ type:'status', bookingId:booking.id, changes:{status:'expired',earlyBirdExpiredAt:expiredAt,paymentUrl:null}, createdAt:expiredAt });
        await scheduledSend(booking,'early-bird-expired',{...common,bookingUrl:'https://www.weekscreekhaven.com/register.html'},'earlyBirdExpiredEmailSentAt');
        sent++;
        continue;
      }
      const approvalAge=booking.approvedAt ? Date.now()-Date.parse(booking.approvedAt) : 0;
      const depositReminderAge=booking.earlyBirdExpiresAt ? 6*86400000 : 18*3600000;
      const hasDepositPlan=['deposit-balance','friends-family-deposit'].includes(booking.paymentPlan);
      if (hasDepositPlan && !booking.paymentRequirementMet && approvalAge>=depositReminderAge && !booking.depositReminderSentAt && hour>=9) sent+=await scheduledSend(booking,'deposit-reminder',common,'depositReminderSentAt');
      else if (hasDepositPlan && !booking.paymentRequirementMet && booking.depositReminderSentAt && Date.now()-Date.parse(booking.depositReminderSentAt)>=20*3600000 && hour>=9) sent+=await scheduledSend(booking,'deposit-grace',common,'depositGraceSentAt');
      if (hasDepositPlan && !booking.paymentFullyPaid && booking.balanceDueDate && today===shiftDate(booking.balanceDueDate,-1) && hour>=9) sent+=await scheduledSend(booking,'balance-reminder',common,'balanceReminderSentAt');
      if (hasDepositPlan && !booking.paymentFullyPaid && booking.balanceDueDate && today>booking.balanceDueDate && hour>=9) sent+=await scheduledSend(booking,'balance-grace',common,'balanceGraceSentAt');
      if (booking.status==='booked' && today===shiftDate(dates.arrival,-3) && hour>=9) sent+=await scheduledSend(booking,'pre-arrival-guide',common,'preArrivalEmailSentAt');
      if (booking.status==='booked' && today===dates.arrival && hour>=9) sent+=await scheduledSend(booking,'checkin-reminder',common,'checkinEmailSentAt');
      if(booking.status==='booked'&&today===dates.arrival&&hour>=9&&booking.doorCode&&booking.doorCodeInstalledAt&&!booking.doorCodeGuestSentAt){const result=await sendEmail({to:booking.email,toName:booking.name,subject:'Your Weeks Creek Haven door code',text:`Hi ${booking.name},\n\nYour private cabin door code is ${booking.doorCode}. It is also available now in your Booking & Signing Packet and the Check In page of your Guest Guide. Please keep it within your registered group. Check-in begins at 4:00 PM Eastern.`,html:`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6"><h1 style="color:#183c2d">Your cabin door code</h1><p>Hi ${booking.name},</p><p>Your private cabin door code is:</p><p style="font-size:30px;font-weight:800;letter-spacing:.14em">${booking.doorCode}</p><p>It is also available now in your Booking &amp; Signing Packet and the Check In page of your Guest Guide. Please keep it within your registered group.</p><p><strong>Check-in begins at 4:00 PM Eastern.</strong></p></div>`,idempotencyKey:`${booking.id}-door-code`});if(!result?.skipped){const sentAt=new Date().toISOString();await appendBookingRecord({type:'status',bookingId:booking.id,changes:{doorCodeGuestSentAt:sentAt},createdAt:sentAt});sent++;}}
      if (booking.status==='booked' && today===midpoint(dates.arrival,dates.departure) && hour>=10) sent+=await scheduledSend(booking,'midstay-rebook',common,'midstayRebookSentAt');
      if (booking.status==='booked' && today===dates.departure && hour>=8) sent+=await scheduledSend(booking,'checkout-reminder',common,'checkoutEmailSentAt');
      if (booking.status==='booked' && !booking.checkoutCompletedAt && today===dates.departure && hour>=15) sent+=await scheduledSend(booking,'checkout-checklist-followup',common,'checkoutFollowupSentAt');
      if (booking.status==='completed' && today===dates.departure && hour>=17 && !booking.reviewRequestedAt) sent+=await scheduledSend(booking,'thank-you-review',common,'thankYouEmailSentAt');
      if (booking.status==='completed' && Number(booking.securityDepositCents)>0 && today===shiftDate(dates.departure,1) && hour>=9) sent+=await scheduledOwnerSend(booking,'security-deposit-review',common,'securityDepositReviewSentAt');
      if (booking.status==='completed' && !booking.complimentary && today===shiftDate(dates.departure,7) && hour>=10) sent+=await scheduledSend(booking,'return-referral-offer',common,'returnOfferEmailSentAt');
    }
    const codeTasks=stored.map(booking=>doorCodeTask(booking,today)).filter(Boolean);
    if(codeTasks.length&&process.env.OWNER_EMAIL&&hour>=9){const rows=codeTasks.map(task=>`• ${task.label}: ${task.guestName}${task.code?` · ${task.code}`:''}${task.arrival?` · ${task.arrival} to ${task.departure}`:''}`).join('\n');const htmlRows=codeTasks.map(task=>`<li><strong>${task.label}</strong>: ${task.guestName}${task.code?` · <span style="font-family:monospace;font-size:18px">${task.code}</span>`:''}${task.arrival?` · ${task.arrival} to ${task.departure}`:''}</li>`).join('');const result=await sendEmail({to:process.env.OWNER_EMAIL,toName:'Heather & Lance',subject:`Door-code tasks · ${codeTasks.length} need attention`,text:`Door-code tasks that still need confirmation:\n\n${rows}\n\nOpen the Command Center to mark each task complete.`,html:`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6"><h1 style="color:#183c2d">Door-code tasks</h1><ul>${htmlRows}</ul><p><a href="https://www.weekscreekhaven.com/admin.html">Open the Command Center</a> to mark each task complete.</p></div>`,idempotencyKey:`door-code-tasks-${today}`});if(!result?.skipped)sent++;}
    return json(response, 200, { ok:true, checked:stored.length, sent });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error:error.message || 'Scheduled emails could not be processed.' });
  }
}
