import { appendBookingRecord, getBookingCalendar, getBookingRequests, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { createAgreementToken, createReviewToken, json, requireAdmin } from '../_lib/security.js';
import { createSquareBookingInvoice, squareStatus } from '../_lib/square.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      return json(response, 200, { bookings: await getBookingRequests(), square: squareStatus() }, { 'Cache-Control': 'no-store' });
    }
    if (request.method !== 'PATCH') return json(response, 405, { error: 'Method not allowed.' });
    const bookings = await getBookingRequests();
    const booking = bookings.find((item) => item.id === String(request.body?.bookingId || ''));
    if (!booking) return json(response, 404, { error: 'Booking request not found.' });
    const action = String(request.body?.action || '');
    const createdAt = new Date().toISOString();
    if (action === 'approve') {
      const originalAmountCents = Math.round(Number(request.body?.amount) * 100);
      const discountAmountCents = Math.round(Number(request.body?.discount || 0) * 100);
      const amountCents = originalAmountCents - discountAmountCents;
      const approvedChoice = Number(request.body?.dateChoice) === 2 ? 1 : 0;
      if (!Number.isInteger(originalAmountCents) || !Number.isInteger(discountAmountCents) || discountAmountCents < 0 || discountAmountCents >= originalAmountCents) return json(response, 400, { error: 'Enter a valid stay price and optional discount.' });
      if (amountCents < 10000) return json(response, 400, { error: 'The discounted stay total must still cover the $100 deposit.' });
      const requestedDates = booking.dateChoices?.[approvedChoice];
      const conflicts = unavailableRanges(await getBookingCalendar()).filter((range) => range.bookingId !== booking.id);
      if (!requestedDates || conflicts.some((range) => rangesOverlap(requestedDates, range))) return json(response, 409, { error: 'Those dates are no longer available. Choose the other date option or update the calendar.' });
      const payment = await createSquareBookingInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents, arrival: requestedDates.arrival, discountCents: discountAmountCents });
      const changes = { status: 'reserved', approvedAt: createdAt, approvedChoice, originalAmountCents, discountAmountCents, amountCents, paymentUrl: payment.url, squareInvoiceId: payment.invoiceId, squareOrderId: payment.orderId, squareCustomerId: payment.customerId, depositAmountCents: payment.depositAmountCents, balanceAmountCents: payment.balanceAmountCents, balanceDueDate: payment.balanceDueDate };
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes, createdAt });
      const dates = requestedDates;
      const safeName = escapeEmailHtml(booking.name);
      const agreementUrl = `https://www.weekscreekhaven.com/rental-agreement.html?token=${encodeURIComponent(createAgreementToken(booking.id))}`;
      await sendEmail({
        to: booking.email, toName: booking.name, subject: 'Your Weeks Creek Haven dates are approved',
        text: `Hi ${booking.name},\n\nYour requested stay from ${dates.arrival} to ${dates.departure} is available.${discountAmountCents ? ` We applied a $${(discountAmountCents / 100).toFixed(2)} discount.` : ''} The total is $${(amountCents / 100).toFixed(2)}. A $100 deposit reserves the dates, and the remaining $${(payment.balanceAmountCents / 100).toFixed(2)} is due by ${payment.balanceDueDate}.\n\nBooking packet:\nPay the Square invoice: ${payment.url}\nReview and accept the rental agreement: ${agreementUrl}\n\nCancellation policy: cancel at least two calendar days before check-in for a 100% refund. No refund is available after that deadline, including the day before check-in.\n\nYour reservation is final after the deposit is paid and the rental agreement is accepted.`,
        html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Your booking packet</h1><p>Hi ${safeName},</p><p>We approved <strong>${dates.arrival} through ${dates.departure}</strong>.</p><p>${discountAmountCents ? `Original stay price: <strong>$${(originalAmountCents / 100).toFixed(2)}</strong><br>Weeks Creek Haven discount: <strong>−$${(discountAmountCents / 100).toFixed(2)}</strong><br>` : ''}Total: <strong>$${(amountCents / 100).toFixed(2)}</strong><br>Reservation deposit due now: <strong>$100.00</strong><br>Remaining balance due ${payment.balanceDueDate}: <strong>$${(payment.balanceAmountCents / 100).toFixed(2)}</strong></p><p><a href="${payment.url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">Open Square invoice</a><a href="${agreementUrl}" style="display:inline-block;background:#a45d41;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Review rental agreement</a></p><p style="background:#fff0cc;padding:12px;border-radius:8px"><strong>Cancellation policy:</strong> Cancel at least two calendar days before check-in for a 100% refund. No refund is available after that deadline, including the day before check-in.</p><p>Your reservation is final after the deposit is paid and the rental agreement is accepted.</p></div>`,
      });
      return json(response, 200, { ok: true, paymentUrl: payment.url });
    }
    if (action === 'send-review') {
      if (!booking.email) return json(response, 400, { error: 'This guest does not have an email address.' });
      const token = createReviewToken(booking.id);
      const reviewUrl = `https://www.weekscreekhaven.com/review.html?token=${encodeURIComponent(token)}`;
      await sendEmail({
        to: booking.email,
        toName: booking.name,
        subject: 'How was your Weeks Creek Haven stay?',
        text: `Hi ${booking.name},\n\nThank you for staying at Weeks Creek Haven. We would love to hear what you enjoyed and anything we can improve.\n\nLeave your rating and review: ${reviewUrl}\n\nYour private comments come directly to us and are never shown publicly unless you give permission.`,
        html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">How was your stay?</h1><p>Hi ${escapeEmailHtml(booking.name)},</p><p>Thank you for staying at Weeks Creek Haven. We would love to hear what you enjoyed and anything we can improve.</p><p><a href="${reviewUrl}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Leave a rating &amp; review</a></p><p style="color:#74685e;font-size:13px">Private comments come directly to us and are never shown publicly unless you give permission.</p></div>`,
      });
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { reviewRequestedAt: createdAt }, createdAt });
      return json(response, 200, { ok: true });
    }
    if (action === 'decline') {
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { status: 'declined', declinedAt: createdAt }, createdAt });
      await sendEmail({
        to: booking.email, toName: booking.name, subject: 'Your Weeks Creek Haven date request',
        text: `Hi ${booking.name},\n\nThanks for checking with us. We can’t make either requested date work this time, but we’d love for you to try another weekend.`,
        html: `<p>Hi ${escapeEmailHtml(booking.name)},</p><p>Thanks for checking with us. We can’t make either requested date work this time, but we’d love for you to try another weekend.</p>`,
      });
      return json(response, 200, { ok: true });
    }
    return json(response, 400, { error: 'Choose approve, decline, or send review request.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The booking request could not be updated.' });
  }
}
