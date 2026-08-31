import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from './booking-store.js';
import { escapeEmailHtml, sendEmail } from './email.js';
import { createAgreementToken } from './security.js';

function selectedDates(booking) {
  return booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || {};
}

function paymentMet(booking) {
  return booking.paymentPlan === 'complimentary' || Number(booking.amountCents) === 0 || booking.paymentRequirementMet === true;
}

function checkoutLabel(booking) {
  const dates = selectedDates(booking);
  return booking.friendsAndFamilyDiscount || dates.quote?.friendsAndFamilyDiscount
    ? 'flexible—there is no set time unless Lance or Heather lets you know personally'
    : (booking.lateCheckout ? 'noon' : '11:00 AM');
}

function packetUrl(bookingId) {
  const token = createAgreementToken(bookingId, 365 * 86400);
  return `https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(token)}`;
}

async function record(booking, changes, createdAt) {
  await appendBookingRecord({ type: 'status', bookingId: booking.id, changes, createdAt });
  return { ...booking, ...changes };
}

async function paymentWelcome(booking, url) {
  const dates = selectedDates(booking);
  const safeName = escapeEmailHtml(booking.name);
  await sendEmail({
    to: booking.email,
    toName: booking.name,
    templateKey: 'payment-received', templateVariables: { guestName:booking.name, arrival:dates.arrival, departure:dates.departure, packetUrl:url },
    subject: 'Payment received — finish your Weeks Creek Haven booking',
    text: `Hi ${booking.name},\n\nWe received your required payment for ${dates.arrival} through ${dates.departure}. Your stay is not locked in until the rental agreement is also signed.\n\nOpen your private booking packet to sign the rental agreement and download your paperwork: ${url}\n\nOnce the agreement is signed, your stay will be marked Booked automatically if the dates are still available.`,
    html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Payment received</h1><p>Hi ${safeName},</p><p>We received your required payment for <strong>${dates.arrival} through ${dates.departure}</strong>. Your stay is not locked in until the rental agreement is also signed.</p><p><a href="${url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open your booking packet</a></p><p>Once the agreement is signed, your stay will be marked <strong>Booked</strong> automatically if the dates are still available.</p></div>`,
  });
}

async function bookedWelcome(booking, url) {
  const dates = selectedDates(booking);
  const safeName = escapeEmailHtml(booking.name);
  const checkout = checkoutLabel(booking);
  const referralCode=booking.referralCode||'';
  await sendEmail({
    to: booking.email,
    toName: booking.name,
    templateKey: 'booking-confirmed', templateVariables: { guestName:booking.name, arrival:dates.arrival, departure:dates.departure, checkout, packetUrl:url, referralCode },
    subject: 'You’re booked at Weeks Creek Haven',
    text: `Hi ${booking.name},\n\nYou’re officially booked for ${dates.arrival} through ${dates.departure}. Check-in begins at 4:00 PM and checkout is ${checkout}.\n\nYour private booking packet contains your signed agreement, booking summary, and downloadable cabin information: ${url}\n\nYour return and referral code is ${referralCode}. Share it with a new guest or use it for your own eligible future stay. One promotional discount per stay.\n\nWe’re excited to welcome you to the Haven!`,
    html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">You’re booked!</h1><p>Hi ${safeName},</p><p>Your Weeks Creek Haven stay is confirmed for <strong>${dates.arrival} through ${dates.departure}</strong>.</p><p>Check-in: <strong>4:00 PM</strong><br>Checkout: <strong>${checkout}</strong></p><p><a href="${url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open your welcome packet</a></p><p style="background:#e8f2e9;padding:12px;border-radius:8px"><strong>Your return and referral code:</strong> ${escapeEmailHtml(referralCode)}<br>Share it with a new guest or use it for your own eligible future stay. One promotional discount per stay.</p><p>Your signed agreement, booking summary, and downloadable cabin information are all kept there. We’re excited to welcome you to the Haven!</p></div>`,
  });
}

export async function finalizeBookingFlow(booking) {
  let current = booking;
  const now = new Date().toISOString();
  const paid = paymentMet(current);
  const agreementSigned = Boolean(current.agreementAcceptedAt);
  if (paid && agreementSigned && ['pending-payment', 'reserved'].includes(current.status)) {
    const dates = selectedDates(current);
    const conflicts = unavailableRanges(await getBookingCalendar()).filter((range) => range.bookingId !== current.id);
    if (dates.arrival && dates.departure && conflicts.some((range) => rangesOverlap(dates, range))) {
      current = await record(current, { status: 'payment-conflict', paymentConflictAt: now, paymentConflictReason: 'Another guest completed payment and the rental agreement first. Owner refund or alternate dates required.' }, now);
    } else {
      current = await record(current, { status: 'booked', bookedAt: current.bookedAt || now, bookedAutomatically: true }, now);
    }
  }
  if (!current.email) return current;
  const url = packetUrl(current.id);
  if (paid && !agreementSigned && !current.paymentWelcomeSentAt) {
    try {
      await paymentWelcome(current, url);
      current = await record(current, { paymentWelcomeSentAt: now }, now);
    } catch (error) { console.error('Payment welcome email failed', error); }
  }
  if (paid && agreementSigned && !current.bookedWelcomeSentAt) {
    try {
      await bookedWelcome(current, url);
      current = await record(current, { bookedWelcomeSentAt: now }, now);
    } catch (error) { console.error('Booked welcome email failed', error); }
  }
  return current;
}
