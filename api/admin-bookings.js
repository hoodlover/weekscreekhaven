import { appendBookingRecord, getBookingCalendar, getBookingRequests, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { createAgreementToken, createReviewToken, json, requireAdmin } from '../_lib/security.js';
import { createSquareBookingInvoice, createSquareFriendInvoice, squareStatus } from '../_lib/square.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';
import { daysBetween, PRICING_CONFIG, quoteStay, withEstimatedTaxesAndFees } from '../pricing.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      const [storedBookings, calendar] = await Promise.all([getBookingRequests(), getBookingCalendar()]);
      const bookings = await Promise.all(storedBookings.map(async (booking) => {
        if (!booking.squareInvoiceId || (booking.status === 'booked' && booking.paymentFullyPaid && booking.bookedWelcomeSentAt)) return booking;
        try { return await refreshSquareBooking(booking); }
        catch (error) { return { ...booking, paymentCheckError: error.message || 'Square status unavailable.' }; }
      }));
      const pricedBookings = bookings.map((booking) => ({
        ...booking,
        dateChoices: (booking.dateChoices || []).map((choice) => ({
          ...choice,
          calculatedQuote: choice.quote
            ? withEstimatedTaxesAndFees(choice.quote)
            : quoteStay({ ...choice, guests: booking.guests || 1, dogs: booking.dogs || 0, lateCheckout: booking.lateCheckout, rates: calendar.rates || [] }),
        })),
      }));
      return json(response, 200, { bookings: pricedBookings, square: squareStatus(), pricing: PRICING_CONFIG, rates: calendar.rates || [] }, { 'Cache-Control': 'no-store' });
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
      const approvedChoice = Number(request.body?.dateChoice) === 2 ? 1 : 0;
      if (!Number.isInteger(originalAmountCents) || originalAmountCents < 0 || !Number.isInteger(discountAmountCents) || discountAmountCents < 0 || discountAmountCents > originalAmountCents) return json(response, 400, { error: 'Enter a valid stay price and optional discount.' });
      const requestedDates = booking.dateChoices?.[approvedChoice];
      const conflicts = unavailableRanges(await getBookingCalendar()).filter((range) => range.bookingId !== booking.id);
      if (!requestedDates || conflicts.some((range) => rangesOverlap(requestedDates, range))) return json(response, 409, { error: 'Those dates are no longer available. Choose the other date option or update the calendar.' });
      const preTaxAmountCents = originalAmountCents - discountAmountCents;
      const tax = withEstimatedTaxesAndFees({ totalCents: preTaxAmountCents, actualNights: Math.max(1, daysBetween(requestedDates.arrival, requestedDates.departure)) });
      const amountCents = tax.estimatedGrandTotalCents;
      let payment = null;
      let paymentPlan = 'complimentary';
      if (amountCents > 0 && (booking.friendsAndFamilyDiscount || amountCents < 10000)) {
        payment = await createSquareFriendInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents, arrival: requestedDates.arrival });
        paymentPlan = 'friends-family-total';
      } else if (amountCents >= 10000) {
        payment = await createSquareBookingInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents, arrival: requestedDates.arrival, discountCents: discountAmountCents });
        paymentPlan = 'deposit-balance';
      }
      const changes = {
        status: 'reserved', approvedAt: createdAt, approvedChoice, originalAmountCents, discountAmountCents, amountCents, paymentPlan,
        preTaxAmountCents, salesTaxCents: tax.salesTaxCents, lodgingTaxCents: tax.lodgingTaxCents,
        stateHotelMotelFeeCents: tax.stateHotelMotelFeeCents, taxesAndFeesCents: tax.estimatedTaxesAndFeesCents,
        paymentUrl: payment?.url || null, squareInvoiceId: payment?.invoiceId || null, squareOrderId: payment?.orderId || null, squareCustomerId: payment?.customerId || null,
        invoiceSentAt: payment ? createdAt : null, bookingPacketSentAt: createdAt,
        depositAmountCents: paymentPlan === 'deposit-balance' ? payment.depositAmountCents : amountCents,
        balanceAmountCents: paymentPlan === 'deposit-balance' ? payment.balanceAmountCents : 0,
        balanceDueDate: paymentPlan === 'deposit-balance' ? payment.balanceDueDate : null,
      };
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes, createdAt });
      const dates = requestedDates;
      const safeName = escapeEmailHtml(booking.name);
      const bookingToken = createAgreementToken(booking.id, 365 * 86400);
      const packetUrl = `https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(bookingToken)}`;
      const paymentText = paymentPlan === 'complimentary'
        ? 'This stay is complimentary, so no payment is required.'
        : paymentPlan === 'friends-family-total'
          ? `Your full Friends & Family total of $${(amountCents / 100).toFixed(2)} is due now. Pay here: ${payment.url}`
          : `A $100 deposit reserves the dates, and the remaining $${(payment.balanceAmountCents / 100).toFixed(2)} is due by ${payment.balanceDueDate}. Pay the Square invoice: ${payment.url}`;
      const paymentHtml = paymentPlan === 'complimentary'
        ? '<p style="background:#e8f2e9;padding:12px;border-radius:8px"><strong>Complimentary stay:</strong> No payment is required.</p>'
        : `<p><a href="${payment.url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">${paymentPlan === 'friends-family-total' ? 'Pay Friends & Family total' : 'Open Square invoice'}</a></p>`;
      await sendEmail({
        to: booking.email, toName: booking.name, subject: 'Your Weeks Creek Haven dates are approved',
        text: `Hi ${booking.name},\n\nYour requested stay from ${dates.arrival} to ${dates.departure} is available. The approved total is $${(amountCents / 100).toFixed(2)}. Check-in begins at 4:00 PM and checkout is ${booking.lateCheckout ? 'noon (your $50 late checkout is included)' : '11:00 AM'}. ${paymentText}\n\nOpen your private booking packet to track payment, sign the rental agreement, and download your paperwork: ${packetUrl}\n\nCancellation policy: cancel at least two calendar days before check-in for a 100% refund. No refund is available after that deadline, including the day before check-in.\n\nYour reservation is final after ${paymentPlan === 'complimentary' ? 'the rental agreement is accepted' : 'payment is made and the rental agreement is accepted'}.`,
        html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Your booking packet</h1><p>Hi ${safeName},</p><p>We approved <strong>${dates.arrival} through ${dates.departure}</strong>.</p><p>Check-in: <strong>4:00 PM</strong><br>Checkout: <strong>${booking.lateCheckout ? 'noon ($50 late checkout included)' : '11:00 AM'}</strong></p><p>Approved total: <strong>$${(amountCents / 100).toFixed(2)}</strong></p>${paymentHtml}<p><a href="${packetUrl}" style="display:inline-block;background:#a45d41;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open booking packet</a></p><p>Track payment, sign the rental agreement, and download your paperwork from the packet.</p><p style="background:#fff0cc;padding:12px;border-radius:8px"><strong>Cancellation policy:</strong> Cancel at least two calendar days before check-in for a 100% refund. No refund is available after that deadline, including the day before check-in.</p><p>Your reservation is final after ${paymentPlan === 'complimentary' ? 'the rental agreement is accepted' : 'payment is made and the rental agreement is accepted'}.</p></div>`,
      });
      return json(response, 200, { ok: true, paymentUrl: payment?.url || null, complimentary: paymentPlan === 'complimentary' });
    }
    if (action === 'send-friend-invoice') {
      if (booking.source !== 'direct-invite' || !['reserved', 'booked'].includes(booking.status)) return json(response, 409, { error: 'Friend invoices are available after the invitee selects a stay.' });
      if (booking.squareInvoiceId) return json(response, 409, { error: 'This stay already has a Square invoice.' });
      if (!booking.email) return json(response, 400, { error: 'This friend invite does not have an email address.' });
      const preTaxAmountCents = Number(booking.preTaxAmountCents ?? booking.amountCents);
      if (!Number.isInteger(preTaxAmountCents) || preTaxAmountCents < 100) return json(response, 400, { error: 'The selected friend stay must have a total of at least $1.00.' });
      const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0];
      if (!dates) return json(response, 400, { error: 'The selected stay dates could not be found.' });
      const tax = withEstimatedTaxesAndFees({ totalCents: preTaxAmountCents, actualNights: Math.max(1, daysBetween(dates.arrival, dates.departure)) });
      const amountCents = tax.estimatedGrandTotalCents;
      const payment = await createSquareFriendInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents, arrival: dates.arrival });
      await appendBookingRecord({
        type: 'status', bookingId: booking.id, createdAt,
        changes: { paymentPlan: 'friend-total', preTaxAmountCents, amountCents, salesTaxCents: tax.salesTaxCents, lodgingTaxCents: tax.lodgingTaxCents, stateHotelMotelFeeCents: tax.stateHotelMotelFeeCents, taxesAndFeesCents: tax.estimatedTaxesAndFeesCents, paymentUrl: payment.url, squareInvoiceId: payment.invoiceId, squareOrderId: payment.orderId, squareCustomerId: payment.customerId, friendInvoiceSentAt: createdAt },
      });
      return json(response, 200, { ok: true, paymentUrl: payment.url });
    }
    if (action === 'check-payment') {
      if (!booking.squareInvoiceId) return json(response, 400, { error: 'No Square invoice has been sent for this stay.' });
      const updated = await refreshSquareBooking(booking, { recordCheck: true });
      return json(response, 200, {
        ok: true,
        status: updated.status,
        invoiceStatus: updated.squareInvoiceStatus,
        paidCents: updated.squarePaidCents,
        balanceCents: updated.squareBalanceCents,
        agreementAccepted: Boolean(updated.agreementAcceptedAt),
      });
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
    return json(response, 400, { error: 'Choose approve, decline, check payment, or send review request.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The booking request could not be updated.' });
  }
}
