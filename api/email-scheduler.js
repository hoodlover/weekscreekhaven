import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { sendEmail } from '../_lib/email.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';
import { bookingAccessCode, createAgreementToken, createReviewToken, json } from '../_lib/security.js';
import { cancelSquareInvoice } from '../_lib/square.js';
import { getReviews } from '../_lib/review-store.js';

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function easternHour() {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  return Number(parts.find(part=>part.type==='hour')?.value || 0);
}
function shiftDate(value, days) { const date=new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10); }
function money(cents) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100); }
function selectedDates(booking) { return booking.dateChoices?.[Number.isInteger(booking.approvedChoice)?booking.approvedChoice:0] || booking.dateChoices?.[0] || {}; }
function midpoint(arrival,departure) { const nights=Math.max(1,Math.round((Date.parse(`${departure}T12:00:00Z`)-Date.parse(`${arrival}T12:00:00Z`))/86400000)); return shiftDate(arrival,Math.max(1,Math.floor(nights/2))); }
function checkoutDetails(booking) {
  const dates=selectedDates(booking);
  const friendsAndFamily=Boolean(booking.friendsAndFamilyDiscount || dates.quote?.friendsAndFamilyDiscount);
  const discount=booking.friendsAndFamilyDiscount || dates.quote?.friendsAndFamilyDiscount;
  const noCleaner=friendsAndFamily && discount?.chargeCleaning !== true;
  return {
    checkoutChecklistUrl:`https://www.weekscreekhaven.com/checkout.html?token=${encodeURIComponent(createAgreementToken(booking.id,365*86400))}&cleaner=${noCleaner?'0':'1'}`,
    checkoutTiming:friendsAndFamily?'There is no set checkout time for this friends-and-family stay. If we need the cabin by a certain time, Lance or Heather will let you know personally.':`Checkout is ${booking.lateCheckout?'noon':'11:00 AM'} today.`,
    checkoutExtraSteps:noCleaner?'No cleaner is scheduled. Please strip the beds you used; wash sheets, pillowcases, and towels; move the load to the dryer and start it; and clean the sinks, toilets, and showers you used.':'Your cleaner will handle beds, bathrooms, and laundry. Please do not strip the beds.',
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
    const today=easternToday(),hour=easternHour();
    const [stored,reviews]=await Promise.all([getBookingRequests(),getReviews()]);
    const reviewedBookingIds=new Set(reviews.map(review=>review.bookingId).filter(Boolean));
    let sent=0;
    for (let booking of stored) {
      if (!['pending-payment','reserved','booked','completed'].includes(booking.status) || !booking.email) continue;
      if (booking.squareInvoiceId && !booking.paymentFullyPaid) { try { booking=await refreshSquareBooking(booking); } catch { /* use last confirmed payment state */ } }
      const dates=selectedDates(booking); if (!dates.arrival || !dates.departure) continue;
      const agreementToken=createAgreementToken(booking.id,365*86400);
      const packetUrl=`https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(agreementToken)}`;
      const guestGuideUrl=`https://www.weekscreekhaven.com/friends-hub.html?token=${encodeURIComponent(agreementToken)}&tab=checkin`;
      const reviewUrl=`https://www.weekscreekhaven.com/review.html?token=${encodeURIComponent(createReviewToken(booking.id))}`;
      const guestBookUrl=`https://www.weekscreekhaven.com/friends-hub.html?token=${encodeURIComponent(createAgreementToken(booking.id,365*86400))}&tab=guestbook`;
      const friendsAndFamily=Boolean(booking.friendsAndFamilyDiscount || dates.quote?.friendsAndFamilyDiscount);
      const common={ guestName:booking.name, arrival:dates.arrival, departure:dates.departure, checkout:friendsAndFamily?'flexible—there is no set time unless Lance or Heather lets you know personally':(booking.lateCheckout?'noon':'11:00 AM'), packetUrl, guestGuideUrl, bookingCode:bookingAccessCode(booking.id), paymentUrl:booking.paymentUrl||packetUrl, depositAmount:money(booking.depositAmountCents), balanceAmount:money(booking.squareBalanceCents ?? booking.balanceAmountCents), reviewUrl, guestBookUrl, bookingUrl:'https://www.weekscreekhaven.com/register.html', referralCode:booking.referralCode||'', securityDeposit:money(booking.securityDepositCents||0), adminUrl:'https://www.weekscreekhaven.com/admin.html', ...checkoutDetails(booking) };
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
      if (booking.paymentPlan==='deposit-balance' && !booking.paymentRequirementMet && approvalAge>=depositReminderAge && !booking.depositReminderSentAt) sent+=await scheduledSend(booking,'deposit-reminder',common,'depositReminderSentAt');
      else if (booking.paymentPlan==='deposit-balance' && !booking.paymentRequirementMet && booking.depositReminderSentAt && Date.now()-Date.parse(booking.depositReminderSentAt)>=20*3600000) sent+=await scheduledSend(booking,'deposit-grace',common,'depositGraceSentAt');
      if (booking.paymentPlan==='deposit-balance' && !booking.paymentFullyPaid && booking.balanceDueDate && today===shiftDate(booking.balanceDueDate,-1)) sent+=await scheduledSend(booking,'balance-reminder',common,'balanceReminderSentAt');
      if (booking.paymentPlan==='deposit-balance' && !booking.paymentFullyPaid && booking.balanceDueDate && today>booking.balanceDueDate) sent+=await scheduledSend(booking,'balance-grace',common,'balanceGraceSentAt');
      if (booking.status==='booked' && today===shiftDate(dates.arrival,-3) && hour>=9) sent+=await scheduledSend(booking,'pre-arrival-guide',common,'preArrivalEmailSentAt');
      if (booking.status==='booked' && today===dates.arrival && hour>=9) sent+=await scheduledSend(booking,'checkin-reminder',common,'checkinEmailSentAt');
      if (booking.status==='booked' && today===midpoint(dates.arrival,dates.departure) && hour>=10) sent+=await scheduledSend(booking,'midstay-rebook',common,'midstayRebookSentAt');
      if (booking.status==='booked' && today===dates.departure && hour>=8 && hour<15) sent+=await scheduledSend(booking,'checkout-reminder',common,'checkoutEmailSentAt');
      if (['booked','completed'].includes(booking.status) && !booking.checkoutCompletedAt && today===dates.departure && hour>=15) sent+=await scheduledSend(booking,'checkout-checklist-followup',common,'checkoutFollowupSentAt');
      if (booking.status==='booked' && today===dates.departure && hour>=17) {
        const completedAt=new Date().toISOString();
        await appendBookingRecord({type:'status',bookingId:booking.id,changes:{status:'completed',completedAt,completedAutomaticallyAt:completedAt},createdAt:completedAt});
        booking.status='completed'; booking.completedAt=completedAt;
      }
      if (['booked','completed'].includes(booking.status) && today===dates.departure && hour>=17 && !booking.reviewRequestedAt && !reviewedBookingIds.has(booking.id)) {
        const sentReview=await scheduledSend(booking,'thank-you-review',common,'thankYouEmailSentAt');
        sent+=sentReview;
        if(sentReview){const reviewRequestedAt=new Date().toISOString();await appendBookingRecord({type:'status',bookingId:booking.id,changes:{reviewRequestedAt},createdAt:reviewRequestedAt});booking.reviewRequestedAt=reviewRequestedAt;}
      }
      if (booking.status==='completed' && Number(booking.securityDepositCents)>0 && today===shiftDate(dates.departure,1)) sent+=await scheduledOwnerSend(booking,'security-deposit-review',common,'securityDepositReviewSentAt');
      if (booking.status==='completed' && !booking.complimentary && today===shiftDate(dates.departure,7)) sent+=await scheduledSend(booking,'return-referral-offer',common,'returnOfferEmailSentAt');
    }
    return json(response, 200, { ok:true, checked:stored.length, sent });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error:error.message || 'Scheduled emails could not be processed.' });
  }
}
