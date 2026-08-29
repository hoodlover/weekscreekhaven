import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { json, requireAdmin } from '../_lib/security.js';
import { refundSquareBooking } from '../_lib/square.js';

function safeReason(value) {
  return String(value || '').trim().slice(0, 192);
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const booking = (await getBookingRequests()).find((item) => item.id === String(request.body?.bookingId || ''));
    if (!booking) return json(response, 404, { error: 'Booking not found.' });
    if (!booking.squareInvoiceId || !booking.squareOrderId) return json(response, 400, { error: 'This booking does not have a refundable Square invoice.' });
    const reason = safeReason(request.body?.reason);
    if (reason.length < 3) return json(response, 400, { error: 'Add a brief reason for the guest adjustment.' });
    const amount = request.body?.amount;
    const amountCents = amount === '' || amount == null ? null : Math.round(Number(amount) * 100);
    if (amountCents != null && (!Number.isInteger(amountCents) || amountCents < 1)) return json(response, 400, { error: 'Enter a valid refund amount, or leave it blank for a full refund.' });
    const operationId = String(request.body?.operationId || '').trim();
    if (!/^[A-Za-z0-9-]{8,45}$/.test(operationId)) return json(response, 400, { error: 'The refund confirmation expired. Please try again.' });

    const result = await refundSquareBooking({
      bookingId: booking.id,
      invoiceId: booking.squareInvoiceId,
      orderId: booking.squareOrderId,
      amountCents,
      reason,
      operationId,
    });
    const createdAt = new Date().toISOString();
    const refundHistory = [...(booking.refunds || []), ...result.refunds];
    const refundedAmountCents = refundHistory.reduce((sum, refund) => sum + (Number(refund.amountCents) || 0), 0);
    await appendBookingRecord({
      type: 'status',
      bookingId: booking.id,
      changes: { refunds: refundHistory, refundedAmountCents, lastRefundAt: createdAt },
      createdAt,
    });

    if (booking.email) {
      const amountText = `$${(result.amountCents / 100).toFixed(2)}`;
      await sendEmail({
        to: booking.email,
        toName: booking.name,
        templateKey:'refund-issued', templateVariables:{ guestName:booking.name, refundAmount:amountText, refundReason:reason },
        subject: 'A Weeks Creek Haven refund was issued',
        text: `Hi ${booking.name},\n\nWe issued a ${amountText} refund through Square. Reason: ${reason}.\n\nSquare will return the funds to the original payment method. Processing time depends on the bank or card issuer.`,
        html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Your refund was issued</h1><p>Hi ${escapeEmailHtml(booking.name)},</p><p>We issued a <strong>${amountText}</strong> refund through Square.</p><p><strong>Reason:</strong> ${escapeEmailHtml(reason)}</p><p>Square will return the funds to the original payment method. Processing time depends on the bank or card issuer.</p></div>`,
      });
    }
    return json(response, 200, { ok: true, amountCents: result.amountCents, refunds: result.refunds });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The refund could not be completed.' });
  }
}
