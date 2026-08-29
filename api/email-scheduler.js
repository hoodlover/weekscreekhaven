import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { sendEmail } from '../_lib/email.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';
import { createAgreementToken, createReviewToken, json } from '../_lib/security.js';

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function shiftDate(value, days) { const date=new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10); }
function money(cents) { return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100); }
function selectedDates(booking) { return booking.dateChoices?.[Number.isInteger(booking.approvedChoice)?booking.approvedChoice:0] || booking.dateChoices?.[0] || {}; }

async function scheduledSend(booking, templateKey, variables, marker) {
  if (booking[marker] || !booking.email) return false;
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
    const stored=await getBookingRequests();
    let sent=0;
    for (let booking of stored) {
      if (!['reserved','booked'].includes(booking.status) || !booking.email) continue;
      if (booking.squareInvoiceId && !booking.paymentFullyPaid) { try { booking=await refreshSquareBooking(booking); } catch { /* use last confirmed payment state */ } }
      const dates=selectedDates(booking); if (!dates.arrival || !dates.departure) continue;
      const packetUrl=`https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(createAgreementToken(booking.id,365*86400))}`;
      const reviewUrl=`https://www.weekscreekhaven.com/review.html?token=${encodeURIComponent(createReviewToken(booking.id))}`;
      const common={ guestName:booking.name, arrival:dates.arrival, departure:dates.departure, checkout:booking.lateCheckout?'noon':'11:00 AM', packetUrl, paymentUrl:booking.paymentUrl||packetUrl, depositAmount:money(booking.depositAmountCents), balanceAmount:money(booking.squareBalanceCents ?? booking.balanceAmountCents), reviewUrl, bookingUrl:'https://www.weekscreekhaven.com/register.html' };
      const approvalAge=booking.approvedAt ? Date.now()-Date.parse(booking.approvedAt) : 0;
      if (booking.paymentPlan==='deposit-balance' && !booking.paymentRequirementMet && approvalAge>=18*3600000 && !booking.depositReminderSentAt) sent+=await scheduledSend(booking,'deposit-reminder',common,'depositReminderSentAt');
      else if (booking.paymentPlan==='deposit-balance' && !booking.paymentRequirementMet && booking.depositReminderSentAt && Date.now()-Date.parse(booking.depositReminderSentAt)>=20*3600000) sent+=await scheduledSend(booking,'deposit-grace',common,'depositGraceSentAt');
      if (booking.paymentPlan==='deposit-balance' && !booking.paymentFullyPaid && booking.balanceDueDate && today===shiftDate(booking.balanceDueDate,-1)) sent+=await scheduledSend(booking,'balance-reminder',common,'balanceReminderSentAt');
      if (booking.paymentPlan==='deposit-balance' && !booking.paymentFullyPaid && booking.balanceDueDate && today>booking.balanceDueDate) sent+=await scheduledSend(booking,'balance-grace',common,'balanceGraceSentAt');
      if (booking.status==='booked' && today===shiftDate(dates.arrival,-3)) sent+=await scheduledSend(booking,'pre-arrival-guide',common,'preArrivalEmailSentAt');
      if (booking.status==='booked' && today===dates.arrival) sent+=await scheduledSend(booking,'checkin-reminder',common,'checkinEmailSentAt');
      if (booking.status==='booked' && today===dates.departure) sent+=await scheduledSend(booking,'checkout-reminder',common,'checkoutEmailSentAt');
      if (booking.status==='booked' && today===shiftDate(dates.departure,1) && !booking.reviewRequestedAt) sent+=await scheduledSend(booking,'thank-you-review',common,'thankYouEmailSentAt');
      if (booking.status==='booked' && !booking.complimentary && today===shiftDate(dates.departure,7)) sent+=await scheduledSend(booking,'return-referral-offer',common,'returnOfferEmailSentAt');
    }
    return json(response, 200, { ok:true, checked:stored.length, sent });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error:error.message || 'Scheduled emails could not be processed.' });
  }
}
