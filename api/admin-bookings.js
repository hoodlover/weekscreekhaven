import { appendBookingRecord, getBookingCalendar, getBookingRequests, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { getInvites } from '../_lib/invite-store.js';
import { createAgreementToken, createReviewToken, json, requireAdmin } from '../_lib/security.js';
import { cancelSquareInvoice, createSquareBookingInvoice, createSquareFriendInvoice, getSquareInvoice, squareStatus } from '../_lib/square.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';
import { findBookingInvite } from '../_lib/booking-invite.js';
import { daysBetween, PRICING_CONFIG, quoteStay, withEstimatedTaxesAndFees } from '../pricing.js';

const MANUAL_STAY_EMAILS = new Set(['pre-arrival-guide', 'checkin-reminder', 'midstay-rebook', 'checkout-reminder']);
const MANUAL_STAY_EMAIL_MARKERS = {
  'pre-arrival-guide': 'preArrivalEmailSentAt',
  'checkin-reminder': 'checkinEmailSentAt',
  'midstay-rebook': 'midstayRebookSentAt',
  'checkout-reminder': 'checkoutEmailSentAt',
};

function completedInvoiceCents(invoice) {
  return (invoice?.payment_requests || []).reduce((sum, paymentRequest) => sum + (Number(paymentRequest.total_completed_amount_money?.amount) || 0), 0);
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function bookingPacketUrl(bookingId) {
  const token = createAgreementToken(bookingId, 365 * 86400);
  return `https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(token)}`;
}

async function sendBookingPacketEmail(booking, packetUrl) {
  const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || {};
  const paid = booking.paymentPlan === 'complimentary' || Number(booking.amountCents) === 0 || booking.paymentRequirementMet === true;
  const signed = Boolean(booking.agreementAcceptedAt);
  const nextStep = signed
    ? 'Your signed agreement, payment status, and booking information are available in the packet.'
    : paid
      ? 'We received your payment. Please open the packet and sign the rental agreement to finish your booking.'
      : 'Open the packet to review payment details and sign the rental agreement.';
  await sendEmail({
    to: booking.email,
    toName: booking.name,
    templateKey:'booking-packet', templateVariables:{ guestName:booking.name, nextStep, arrival:dates.arrival || 'To be confirmed', departure:dates.departure || 'To be confirmed', packetUrl, checkout:booking.lateCheckout?'noon':'11:00 AM' },
    subject: signed ? 'Your Weeks Creek Haven booking packet' : 'Please sign your Weeks Creek Haven agreement',
    text: `Hi ${booking.name},\n\n${nextStep}\n\nStay: ${dates.arrival || 'To be confirmed'} through ${dates.departure || 'To be confirmed'}\n\nOpen your private booking packet: ${packetUrl}\n\nCheck-in begins at 4:00 PM. Checkout is ${booking.lateCheckout ? 'noon' : '11:00 AM'}.`,
    html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Your private booking packet</h1><p>Hi ${escapeEmailHtml(booking.name)},</p><p>${escapeEmailHtml(nextStep)}</p><p><strong>${escapeEmailHtml(dates.arrival || 'To be confirmed')} through ${escapeEmailHtml(dates.departure || 'To be confirmed')}</strong></p><p><a href="${packetUrl}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${signed ? 'Open booking packet' : 'Open packet and sign agreement'}</a></p><p>Check-in begins at <strong>4:00 PM</strong>. Checkout is <strong>${booking.lateCheckout ? 'noon' : '11:00 AM'}</strong>.</p></div>`,
  });
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      const [storedBookings, calendar, invites] = await Promise.all([getBookingRequests(), getBookingCalendar(), getInvites()]);
      const bookings = await Promise.all(storedBookings.map(async (booking) => {
        if (!booking.squareInvoiceId || (booking.status === 'booked' && booking.paymentFullyPaid && booking.bookedWelcomeSentAt)) return booking;
        try { return await refreshSquareBooking(booking); }
        catch (error) { return { ...booking, paymentCheckError: error.message || 'Square status unavailable.' }; }
      }));
      const pricedBookings = bookings.map((booking) => {
        const invite = findBookingInvite(booking, invites);
        return {
          ...booking,
          bookingPacketUrl: bookingPacketUrl(booking.id),
          invitePasscode: invite?.passcode || '',
          welcomePreviewUrl: invite ? `/api/admin-preview-invite?inviteId=${encodeURIComponent(invite.id)}` : '',
          dateChoices: (booking.dateChoices || []).map((choice, choiceIndex) => {
            const calculatedQuote = choice.quote
              ? withEstimatedTaxesAndFees(choice.quote)
              : quoteStay({ ...choice, guests: booking.guests || 1, dogs: booking.dogs || 0, lateCheckout: booking.lateCheckout, rates: calendar.rates || [] });
            const isApprovedChoice = choiceIndex === (Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0);
            const revisedTotalCents = Number(booking.preTaxAmountCents);
            const displayedQuote = isApprovedChoice && !['pending', 'offered', 'declined', 'cancelled'].includes(booking.status) && Number.isInteger(revisedTotalCents)
              ? withEstimatedTaxesAndFees({
                  ...calculatedQuote,
                  totalCents: revisedTotalCents,
                  standardTotalCents: Number(booking.originalAmountCents) || calculatedQuote?.standardTotalCents || calculatedQuote?.totalCents || revisedTotalCents,
                  discountAmountCents: Math.max(0, (Number(booking.originalAmountCents) || calculatedQuote?.standardTotalCents || calculatedQuote?.totalCents || revisedTotalCents) - revisedTotalCents),
                  discountCents: Math.max(0, (Number(booking.originalAmountCents) || calculatedQuote?.standardTotalCents || calculatedQuote?.totalCents || revisedTotalCents) - revisedTotalCents),
                })
              : calculatedQuote;
            const finalDisplayedQuote = booking.friendsAndFamilyDiscount
              ? { ...displayedQuote, refundableSecurityDepositCents: 0, estimatedAmountDueCents: displayedQuote?.estimatedGrandTotalCents || 0 }
              : displayedQuote;
            return {
              ...choice,
              calculatedQuote: choice.complimentary
                ? withEstimatedTaxesAndFees({ ...finalDisplayedQuote, totalCents: 0, complimentary: true })
                : finalDisplayedQuote,
            };
          }),
        };
      });
      return json(response, 200, { bookings: pricedBookings, square: squareStatus(), pricing: PRICING_CONFIG, rates: calendar.rates || [] }, { 'Cache-Control': 'no-store' });
    }
    if (request.method !== 'PATCH') return json(response, 405, { error: 'Method not allowed.' });
    const bookings = await getBookingRequests();
    const booking = bookings.find((item) => item.id === String(request.body?.bookingId || ''));
    if (!booking) return json(response, 404, { error: 'Booking request not found.' });
    const action = String(request.body?.action || '');
    const createdAt = new Date().toISOString();
    if (action === 'correct-guest-contact') {
      const email = validEmail(request.body?.email);
      const name = String(request.body?.name || '').trim().slice(0, 100);
      const inviteId = String(request.body?.inviteId || '').trim();
      if (!email || name.length < 2) return json(response, 400, { error: 'Add the correct guest name and email address.' });
      if (inviteId) {
        const invite = (await getInvites()).find((item) => item.id === inviteId && !item.revokedAt);
        if (!invite) return json(response, 400, { error: 'That active invite could not be found.' });
        if (invite.recipientEmail && invite.recipientEmail.toLowerCase() !== email) return json(response, 409, { error: 'The entered email does not match that invitation.' });
      }
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { name, email, inviteId: inviteId || null, source: inviteId ? 'invite-booking' : booking.source, guestContactCorrectedAt: createdAt }, createdAt });
      return json(response, 200, { ok: true, name, email, inviteId: inviteId || null });
    }
    if (action === 'archive') {
      if (!['declined', 'cancelled'].includes(booking.status)) return json(response, 409, { error: 'Only declined or canceled bookings can be archived.' });
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { archivedAt: createdAt }, createdAt });
      return json(response, 200, { ok: true, archivedAt: createdAt });
    }
    if (action === 'unarchive') {
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { archivedAt: null }, createdAt });
      return json(response, 200, { ok: true });
    }
    if (action === 'convert-legacy-complimentary') {
      if (booking.status !== 'booked' || booking.agreementAcceptedAt || booking.squareInvoiceId) return json(response, 409, { error: 'This repair applies only to an unsigned legacy booking with no Square invoice.' });
      const preTaxAmountCents = Number(booking.preTaxAmountCents ?? booking.amountCents ?? booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0]?.amountCents) || 0;
      const changes = { status: 'reserved', paymentPlan: 'complimentary', complimentary: true, preTaxAmountCents, amountCents: 0, paymentRequirementCents: 0, paymentRequirementMet: true, paymentFullyPaid: true, legacyModelUpdatedAt: createdAt };
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes, createdAt });
      return json(response, 200, { ok: true, status: 'reserved', complimentary: true });
    }
    if (action === 'approve') {
      const approvedQuote = booking.dateChoices?.[Number(request.body?.dateChoice) === 2 ? 1 : 0]?.quote;
      const earlyBirdDiscountCents = approvedQuote?.friendsAndFamilyDiscount ? 0 : Math.max(0, Number(approvedQuote?.earlyBirdDiscountCents) || 0);
      const enteredAmountCents = Math.round(Number(request.body?.amount) * 100);
      const additionalDiscountCents = Math.round(Number(request.body?.discount || 0) * 100);
      const originalAmountCents = enteredAmountCents + earlyBirdDiscountCents;
      const discountAmountCents = earlyBirdDiscountCents + additionalDiscountCents;
      const approvedChoice = Number(request.body?.dateChoice) === 2 ? 1 : 0;
      if (!Number.isInteger(enteredAmountCents) || enteredAmountCents < 0 || !Number.isInteger(additionalDiscountCents) || additionalDiscountCents < 0 || additionalDiscountCents > enteredAmountCents) return json(response, 400, { error: 'Enter a valid stay price and optional additional discount.' });
      const requestedDates = booking.dateChoices?.[approvedChoice];
      const conflicts = unavailableRanges(await getBookingCalendar()).filter((range) => range.bookingId !== booking.id);
      if (!requestedDates || conflicts.some((range) => rangesOverlap(requestedDates, range))) return json(response, 409, { error: 'Those dates are no longer available. Choose the other date option or update the calendar.' });
      const preTaxAmountCents = enteredAmountCents - additionalDiscountCents;
      const earlyBirdExpiresAt = earlyBirdDiscountCents ? new Date(Date.parse(createdAt) + 7 * 86400000).toISOString() : null;
      const complimentary = preTaxAmountCents === 0 && (requestedDates.complimentary === true || requestedDates.quote?.complimentary === true || booking.friendsAndFamilyDiscount?.discountType === 'complimentary');
      const tax = withEstimatedTaxesAndFees({ totalCents: preTaxAmountCents, actualNights: Math.max(1, daysBetween(requestedDates.arrival, requestedDates.departure)), complimentary });
      const amountCents = tax.estimatedGrandTotalCents;
      let payment = null;
      let paymentPlan = 'complimentary';
      const securityDepositCents = booking.friendsAndFamilyDiscount ? 0 : Number(tax.refundableSecurityDepositCents) || 30000;
      if (amountCents > 0 && booking.friendsAndFamilyDiscount) {
        payment = await createSquareFriendInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents, securityDepositCents: 0, arrival: requestedDates.arrival });
        paymentPlan = 'friends-family-total';
      } else if (amountCents > 0) {
        payment = await createSquareBookingInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents, depositBaseCents: preTaxAmountCents, arrival: requestedDates.arrival, discountCents: discountAmountCents, depositDueDays: earlyBirdDiscountCents ? 7 : 1 });
        paymentPlan = payment.fullPaymentRequired ? 'full-payment' : 'deposit-balance';
      }
      const changes = {
        status: 'reserved', approvedAt: createdAt, approvedChoice, originalAmountCents, discountAmountCents, additionalDiscountCents, earlyBirdDiscountCents, earlyBirdPercentage: approvedQuote?.earlyBirdDiscount?.percentage || null, earlyBirdExpiresAt, amountCents, paymentPlan, complimentary,
        preTaxAmountCents, securityDepositCents, salesTaxCents: tax.salesTaxCents, lodgingTaxCents: tax.lodgingTaxCents,
        stateHotelMotelFeeCents: tax.stateHotelMotelFeeCents, taxesAndFeesCents: tax.estimatedTaxesAndFeesCents,
        paymentUrl: payment?.url || null, squareInvoiceId: payment?.invoiceId || null, squareOrderId: payment?.orderId || null, squareCustomerId: payment?.customerId || null,
        invoiceSentAt: payment ? createdAt : null, bookingPacketSentAt: createdAt,
        depositAmountCents: payment?.depositAmountCents ?? amountCents,
        balanceAmountCents: paymentPlan === 'deposit-balance' ? payment.balanceAmountCents : 0,
        balanceDueDate: paymentPlan === 'deposit-balance' ? payment.balanceDueDate : null,
        depositDueDate: paymentPlan === 'deposit-balance' ? payment.depositDueDate : null,
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
          : paymentPlan === 'full-payment'
            ? `Because check-in is within seven days, the full $${(amountCents / 100).toFixed(2)} is due now. The 20% cancellation-deposit amount is $${(payment.depositAmountCents / 100).toFixed(2)}. Pay the Square invoice: ${payment.url}`
            : `A 20% deposit of $${(payment.depositAmountCents / 100).toFixed(2)} is due within ${earlyBirdDiscountCents ? 'seven days' : '24 hours'} to reserve the dates. ${earlyBirdDiscountCents ? `Sign the rental agreement and pay by ${earlyBirdExpiresAt.slice(0,10)} to keep your automatic ${approvedQuote.earlyBirdDiscount.percentage}% Early Bird price; otherwise it expires and the stay must be repriced or rebooked. ` : ''}The remaining $${(payment.balanceAmountCents / 100).toFixed(2)} is due by ${payment.balanceDueDate}. Pay the Square invoice: ${payment.url}`;
      const paymentHtml = paymentPlan === 'complimentary'
        ? '<p style="background:#e8f2e9;padding:12px;border-radius:8px"><strong>Complimentary stay:</strong> No payment is required.</p>'
        : `<p><a href="${payment.url}" style="display:inline-block;background:#183c2d;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">${paymentPlan === 'friends-family-total' ? 'Pay Friends & Family total' : 'Open Square invoice'}</a></p>`;
      await sendEmail({
        to: booking.email, toName: booking.name, subject: 'Your Weeks Creek Haven dates are approved',
        templateKey:'booking-approved', templateVariables:{ guestName:booking.name, arrival:dates.arrival, departure:dates.departure, total:`$${(amountCents/100).toFixed(2)}`, paymentText, packetUrl, checkout:booking.lateCheckout?'noon':'11:00 AM' },
        text: `Hi ${booking.name},\n\nYour requested stay from ${dates.arrival} to ${dates.departure} is available. The approved total is $${(amountCents / 100).toFixed(2)}. Check-in begins at 4:00 PM and checkout is ${booking.lateCheckout ? 'noon (your $50 late checkout is included)' : '11:00 AM'}. ${paymentText}\n\nOpen your private booking packet to track payment, sign the rental agreement, and download your paperwork: ${packetUrl}\n\nCancellation policy: cancel at least 24 hours before the 4:00 PM Eastern check-in time for a full refund. Inside 24 hours, the 20% reservation deposit is retained and any remaining amount paid is refunded.\n\nYour reservation is final after ${paymentPlan === 'complimentary' ? 'the rental agreement is accepted' : 'payment is made and the rental agreement is accepted'}.`,
        html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Your booking packet</h1><p>Hi ${safeName},</p><p>We approved <strong>${dates.arrival} through ${dates.departure}</strong>.</p><p>Check-in: <strong>4:00 PM</strong><br>Checkout: <strong>${booking.lateCheckout ? 'noon ($50 late checkout included)' : '11:00 AM'}</strong></p><p>Approved total: <strong>$${(amountCents / 100).toFixed(2)}</strong></p>${paymentHtml}<p><a href="${packetUrl}" style="display:inline-block;background:#a45d41;color:#fff;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open booking packet</a></p><p>Track payment, sign the rental agreement, and download your paperwork from the packet.</p><p style="background:#fff0cc;padding:12px;border-radius:8px"><strong>Cancellation policy:</strong> Cancel at least 24 hours before the 4:00 PM Eastern check-in time for a full refund. Inside 24 hours, the 20% reservation deposit is retained and any remaining amount paid is refunded.</p><p>Your reservation is final after ${paymentPlan === 'complimentary' ? 'the rental agreement is accepted' : 'payment is made and the rental agreement is accepted'}.</p></div>`,
      });
      return json(response, 200, { ok: true, paymentUrl: payment?.url || null, complimentary: paymentPlan === 'complimentary' });
    }
    if (action === 'revise-unpaid-price') {
      if (!booking.email) return json(response, 400, { error: 'This guest does not have an email address for the replacement invoice.' });
      if (['cancelled', 'declined'].includes(booking.status)) return json(response, 409, { error: 'A canceled or declined booking cannot be repriced.' });
      const currentInvoice = booking.squareInvoiceId ? await getSquareInvoice(booking.squareInvoiceId) : null;
      const paidCents = completedInvoiceCents(currentInvoice);
      if (paidCents > 0 || booking.paymentRequirementMet) return json(response, 409, { error: 'This invoice already has a payment. Use the refund or credit controls instead.' });
      const enteredPreTaxAmountCents = Math.round(Number(request.body?.revisedPreTaxAmount) * 100);
      const enteredDiscountCents = Math.round(Number(request.body?.discountAmount || 0) * 100);
      const revisedPreTaxAmountCents = enteredPreTaxAmountCents - enteredDiscountCents;
      if (!Number.isInteger(enteredDiscountCents) || enteredDiscountCents < 0) return json(response, 400, { error: 'Enter the discount as a valid dollar amount.' });
      if (!Number.isInteger(revisedPreTaxAmountCents) || revisedPreTaxAmountCents < 100) return json(response, 400, { error: 'Enter a revised pre-tax stay price of at least $1.00.' });
      const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0];
      if (!dates?.arrival || !dates?.departure) return json(response, 400, { error: 'The selected stay dates could not be found.' });
      const previousPreTaxAmountCents = Number(booking.preTaxAmountCents) || 0;
      const ownerPriceAdjustmentCents = previousPreTaxAmountCents - revisedPreTaxAmountCents;
      const originalAmountCents = Number(booking.originalAmountCents) || previousPreTaxAmountCents;
      const discountAmountCents = Math.max(0, originalAmountCents - revisedPreTaxAmountCents);
      const isFriendInvoice = Boolean(booking.friendsAndFamilyDiscount) || String(booking.paymentPlan || '').includes('friend');
      const securityDepositCents = isFriendInvoice ? 0 : Number.isInteger(Number(booking.securityDepositCents)) ? Number(booking.securityDepositCents) : 30000;
      const tax = withEstimatedTaxesAndFees({ totalCents: revisedPreTaxAmountCents, actualNights: Math.max(1, daysBetween(dates.arrival, dates.departure)) });
      const stayAmountCents = tax.estimatedGrandTotalCents;
      const amountCents = stayAmountCents + securityDepositCents;
      const invoiceRevision = (Number(booking.invoiceRevision) || 0) + 1;
      if (currentInvoice && !['CANCELED', 'PAID', 'REFUNDED'].includes(currentInvoice.status)) await cancelSquareInvoice(booking.squareInvoiceId);
      const payment = isFriendInvoice
        ? await createSquareFriendInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, amountCents, securityDepositCents, arrival: dates.arrival, revisionKey: invoiceRevision })
        : await createSquareBookingInvoice({ bookingId: booking.id, guestName: booking.name, email: booking.email, address: { line1: booking.billingAddress, city: booking.billingCity, state: booking.billingState, postalCode: booking.billingPostalCode }, amountCents, securityDepositCents, depositBaseCents: revisedPreTaxAmountCents, arrival: dates.arrival, discountCents: discountAmountCents, depositDueDays: booking.earlyBirdDiscountCents ? 7 : 1, revisionKey: invoiceRevision });
      const paymentPlan = isFriendInvoice ? 'friends-family-total' : payment.fullPaymentRequired ? 'full-payment' : 'deposit-balance';
      const invoiceHistory = [...(booking.invoiceHistory || []), ...(booking.squareInvoiceId ? [{ invoiceId: booking.squareInvoiceId, orderId: booking.squareOrderId || null, paymentUrl: booking.paymentUrl || null, replacedAt: createdAt, amountCents: Number(booking.amountCents) || 0 }] : [])];
      const changes = {
        status: 'pending-payment', previousPreTaxAmountCents, originalAmountCents, preTaxAmountCents: revisedPreTaxAmountCents, stayAmountCents, securityDepositCents, amountCents,
        discountAmountCents, ownerPriceAdjustmentCents, ownerPriceAdjustedAt: createdAt, invoiceRevision, invoiceHistory,
        salesTaxCents: tax.salesTaxCents, lodgingTaxCents: tax.lodgingTaxCents, stateHotelMotelFeeCents: tax.stateHotelMotelFeeCents, taxesAndFeesCents: tax.estimatedTaxesAndFeesCents,
        paymentPlan, paymentUrl: payment.url, squareInvoiceId: payment.invoiceId, squareOrderId: payment.orderId, squareCustomerId: payment.customerId,
        invoiceSentAt: createdAt, squareInvoiceStatus: 'UNPAID', squarePaidCents: 0, squareBalanceCents: amountCents, paymentRequirementMet: false, paymentFullyPaid: false,
        depositAmountCents: payment.depositAmountCents ?? amountCents, balanceAmountCents: paymentPlan === 'deposit-balance' ? payment.balanceAmountCents : 0,
        balanceDueDate: paymentPlan === 'deposit-balance' ? payment.balanceDueDate : null, depositDueDate: paymentPlan === 'deposit-balance' ? payment.depositDueDate : null,
      };
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes, createdAt });
      return json(response, 200, { ok: true, amountCents, ownerPriceAdjustmentCents, paymentUrl: payment.url });
    }
    if (action === 'cancel-unpaid') {
      if (['cancelled', 'declined'].includes(booking.status)) return json(response, 409, { error: 'This booking is already canceled or declined.' });
      const currentInvoice = booking.squareInvoiceId ? await getSquareInvoice(booking.squareInvoiceId) : null;
      const paidCents = completedInvoiceCents(currentInvoice);
      if (paidCents > 0 || booking.paymentRequirementMet) return json(response, 409, { error: 'A payment has already been received. Use the refund controls instead of unpaid cancellation.' });
      if (currentInvoice && !['CANCELED', 'PAID', 'REFUNDED'].includes(currentInvoice.status)) await cancelSquareInvoice(booking.squareInvoiceId);
      const reason = String(request.body?.reason || 'Canceled before payment').trim().slice(0, 192);
      await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { status: 'cancelled', cancelledAt: createdAt, cancellationReason: reason, paymentUrl: null, squareInvoiceStatus: 'CANCELED' }, createdAt });
      if (booking.email) {
        const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || {};
        await sendEmail({
          to: booking.email, toName: booking.name, templateKey: 'booking-cancelled', templateVariables: { guestName: booking.name, arrival: dates.arrival || '', departure: dates.departure || '', reason },
          subject: 'Your Weeks Creek Haven booking was canceled',
          text: `Hi ${booking.name},\n\nYour unpaid Weeks Creek Haven booking for ${dates.arrival || 'the selected dates'} through ${dates.departure || ''} has been canceled. The Square invoice is no longer payable, and no payment was collected.\n\nReason: ${reason}\n\nYou are welcome to choose new dates anytime.`,
          html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Booking canceled</h1><p>Hi ${escapeEmailHtml(booking.name)},</p><p>Your unpaid booking for <strong>${escapeEmailHtml(dates.arrival || 'the selected dates')} through ${escapeEmailHtml(dates.departure || '')}</strong> has been canceled.</p><p>The Square invoice is no longer payable, and no payment was collected.</p><p><strong>Reason:</strong> ${escapeEmailHtml(reason)}</p><p>You are welcome to choose new dates anytime.</p></div>`,
        });
      }
      return json(response, 200, { ok: true, status: 'cancelled' });
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
    if (action === 'send-booking-packet') {
      if (!booking.email) return json(response, 400, { error: 'This guest does not have an email address.' });
      if (!['reserved', 'booked'].includes(booking.status)) return json(response, 409, { error: 'Reserve the stay before sending its signing packet.' });
      const packetUrl = bookingPacketUrl(booking.id);
      await sendBookingPacketEmail(booking, packetUrl);
      await appendBookingRecord({
        type: 'status', bookingId: booking.id, createdAt,
        changes: { bookingPacketSentAt: booking.bookingPacketSentAt || createdAt, bookingPacketResentAt: createdAt },
      });
      return json(response, 200, { ok: true, packetUrl });
    }
    if (action === 'send-stay-email') {
      if (!booking.email) return json(response, 400, { error: 'This guest does not have an email address.' });
      if (booking.status !== 'booked') return json(response, 409, { error: 'Only a booked guest can receive current-stay emails.' });
      const templateKey = String(request.body?.templateKey || '');
      if (!MANUAL_STAY_EMAILS.has(templateKey)) return json(response, 400, { error: 'Choose one of the current-stay emails.' });
      const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || {};
      if (!dates.arrival || !dates.departure) return json(response, 409, { error: 'This booking does not have confirmed stay dates.' });
      const packetUrl = bookingPacketUrl(booking.id);
      const reviewUrl = `https://www.weekscreekhaven.com/review.html?token=${encodeURIComponent(createReviewToken(booking.id))}`;
      const templateVariables = {
        guestName: booking.name,
        arrival: dates.arrival,
        departure: dates.departure,
        checkout: booking.lateCheckout ? 'noon' : '11:00 AM',
        packetUrl,
        paymentUrl: booking.paymentUrl || packetUrl,
        reviewUrl,
        bookingUrl: 'https://www.weekscreekhaven.com/register.html',
        referralCode: booking.referralCode || '',
      };
      await sendEmail({
        to: booking.email,
        toName: booking.name,
        templateKey,
        templateVariables,
        subject: 'Weeks Creek Haven stay update',
        text: `Hi ${booking.name},\n\nHere is an update for your Weeks Creek Haven stay.`,
        html: `<p>Hi ${escapeEmailHtml(booking.name)},</p><p>Here is an update for your Weeks Creek Haven stay.</p>`,
      });
      await appendBookingRecord({
        type: 'status', bookingId: booking.id, createdAt,
        changes: { lastManualStayEmail: templateKey, lastManualStayEmailSentAt: createdAt, [MANUAL_STAY_EMAIL_MARKERS[templateKey]]: createdAt },
      });
      return json(response, 200, { ok: true, templateKey, sentAt: createdAt });
    }
    if (action === 'send-review') {
      if (!booking.email) return json(response, 400, { error: 'This guest does not have an email address.' });
      const token = createReviewToken(booking.id);
      const reviewUrl = `https://www.weekscreekhaven.com/review.html?token=${encodeURIComponent(token)}`;
      await sendEmail({
        to: booking.email,
        toName: booking.name,
        templateKey:'review-request', templateVariables:{ guestName:booking.name, reviewUrl },
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
        templateKey:'request-declined', templateVariables:{ guestName:booking.name },
        text: `Hi ${booking.name},\n\nThanks for checking with us. We can’t make either requested date work this time, but we’d love for you to try another weekend.`,
        html: `<p>Hi ${escapeEmailHtml(booking.name)},</p><p>Thanks for checking with us. We can’t make either requested date work this time, but we’d love for you to try another weekend.</p>`,
      });
      return json(response, 200, { ok: true });
    }
    return json(response, 400, { error: 'Choose a valid booking action.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The booking request could not be updated.' });
  }
}
