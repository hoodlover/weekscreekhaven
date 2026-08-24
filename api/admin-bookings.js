import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { json, requireAdmin } from '../_lib/security.js';
import { createSquarePaymentLink } from '../_lib/square.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      return json(response, 200, { bookings: await getBookingRequests() }, { 'Cache-Control': 'no-store' });
    }
    if (request.method !== 'PATCH') return json(response, 405, { error: 'Method not allowed.' });
    const bookings = await getBookingRequests();
    const booking = bookings.find((item) => item.id === String(request.body?.bookingId || ''));
    if (!booking) return json(response, 404, { error: 'Booking request not found.' });
    const action = String(request.body?.action || '');
    const createdAt = new Date().toISOString();
    if (action === 'approve') {
      const amountCents = Math.round(Number(request.body?.amount) * 100);
      const approvedChoice = Number(request.body?.dateChoice) === 2 ? 1 : 0;
      if (!Number.isInteger(amountCents) || amountCents < 100) return json(response, 400, { error: 'Enter the total amount to collect.' });
      const payment = await createSquarePaymentLink({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents });
      const changes = { status: 'approved', approvedAt: createdAt, approvedChoice, amountCents, paymentUrl: payment.url, squarePaymentLinkId: payment.id, squareOrderId: payment.orderId };
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes, createdAt });
      const dates = booking.dateChoices[approvedChoice];
      const safeName = escapeEmailHtml(booking.name);
      await sendEmail({
        to: booking.email, toName: booking.name, subject: 'Your Weeks Creek Haven dates are approved',
        text: `Hi ${booking.name},\n\nYour requested stay from ${dates.arrival} to ${dates.departure} is available. The total is $${(amountCents / 100).toFixed(2)}. Complete payment here to reserve it: ${payment.url}\n\nYour reservation is not final until payment is completed and the rental agreement is accepted.`,
        html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Your dates are available</h1><p>Hi ${safeName},</p><p>We approved <strong>${dates.arrival} through ${dates.departure}</strong>.</p><p>Total: <strong>$${(amountCents / 100).toFixed(2)}</strong></p><p><a href="${payment.url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Pay securely with Square</a></p><p>Your reservation is final after payment and acceptance of the rental agreement.</p></div>`,
      });
      return json(response, 200, { ok: true, paymentUrl: payment.url });
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
    return json(response, 400, { error: 'Choose approve or decline.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The booking request could not be updated.' });
  }
}
