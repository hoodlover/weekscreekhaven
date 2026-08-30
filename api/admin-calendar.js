import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { getInvites } from '../_lib/invite-store.js';
import { createAgreementToken, json, requireAdmin } from '../_lib/security.js';
import { cancelSquareInvoice } from '../_lib/square.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';
import { findBookingInvite } from '../_lib/booking-invite.js';

const text = (value, max = 120) => String(value || '').trim().slice(0, max);
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
const nights = (arrival, departure) => Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86400000);
const addDays = (value, amount) => new Date(Date.parse(`${value}T12:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      const [calendar, invites] = await Promise.all([getBookingCalendar(), getInvites()]);
      calendar.bookings = await Promise.all((calendar.bookings || []).map(async (booking) => {
        let current = booking;
        if (booking.squareInvoiceId && !(booking.status === 'booked' && booking.paymentFullyPaid && booking.bookedWelcomeSentAt)) {
          try { current = await refreshSquareBooking(booking); }
          catch (error) { current = { ...booking, paymentCheckError: error.message || 'Square status unavailable.' }; }
        }
        const token = createAgreementToken(current.id, 365 * 86400);
        const invite = findBookingInvite(current, invites);
        return { ...current, bookingPacketUrl: `https://www.weekscreekhaven.com/booking-packet.html?token=${encodeURIComponent(token)}`, invitePasscode: invite?.passcode || '', welcomePreviewUrl: invite ? `/api/admin-preview-invite?inviteId=${encodeURIComponent(invite.id)}` : '' };
      }));
      return json(response, 200, calendar, { 'Cache-Control': 'no-store' });
    }
    const createdAt = new Date().toISOString();
    if (request.method === 'POST') {
      const arrival = date(request.body?.arrival);
      const lastHeldDate = date(request.body?.departure);
      if (!arrival || !lastHeldDate || lastHeldDate < arrival) return json(response, 400, { error: 'Choose a valid first and last day for the hold.' });
      const departure = addDays(lastHeldDate, 1);
      if (unavailableRanges(await getBookingCalendar()).some((range) => rangesOverlap({ arrival, departure }, range))) return json(response, 409, { error: 'Those dates already include a reservation, booking, or owner block.' });
      const holdType = request.body?.holdType === 'flexible' ? 'flexible' : 'firm';
      const block = { id: crypto.randomUUID(), arrival, departure, label: text(request.body?.label, 100) || 'Owner hold', holdType, createdAt };
      await appendBookingRecord({ type: 'block_created', block, createdAt });
      return json(response, 201, { block });
    }
    if (request.method === 'PATCH') {
      const action = text(request.body?.action, 30);
      if (action === 'set-default-rate') {
        const amountCents = Math.round(Number(request.body?.amount) * 100);
        if (!Number.isInteger(amountCents) || amountCents < 0) return json(response, 400, { error: 'Enter a valid nightly rate.' });
        await appendBookingRecord({ type: 'rate_default', amountCents, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'add-rate') {
        const arrival = date(request.body?.arrival);
        const departure = date(request.body?.departure);
        const pricingMode = request.body?.pricingMode === 'total' ? 'total' : 'nightly';
        const enteredCents = Math.round(Number(request.body?.amount) * 100);
        const nightCount = nights(arrival, departure);
        const amountCents = pricingMode === 'total' && nightCount > 0 ? Math.round(enteredCents / nightCount) : enteredCents;
        if (!arrival || !departure || departure <= arrival) return json(response, 400, { error: 'Choose a valid rate start and end date.' });
        if (nightCount < 2) return json(response, 400, { error: 'Select at least two nights.' });
        if (!Number.isInteger(enteredCents) || enteredCents < 100) return json(response, 400, { error: `Enter the ${pricingMode === 'total' ? 'total stay' : 'nightly'} amount for this date range.` });
        const calendar = await getBookingCalendar();
        if ((calendar.rates || []).some((rate) => rangesOverlap({ arrival, departure }, rate))) return json(response, 409, { error: 'That range overlaps another special rate. Remove the old rate first.' });
        const rate = { id: crypto.randomUUID(), arrival, departure, amountCents, pricingMode, totalCents: pricingMode === 'total' ? enteredCents : null, nightCount, createdAt };
        await appendBookingRecord({ type: 'rate_created', rate, createdAt });
        return json(response, 200, { rate });
      }
      if (action === 'remove-rate') {
        await appendBookingRecord({ type: 'rate_removed', rateId: text(request.body?.rateId, 80), createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'edit-block') {
        const blockId = text(request.body?.blockId, 80);
        const calendar = await getBookingCalendar();
        const block = calendar.blocks.find((item) => item.id === blockId);
        if (!block) return json(response, 404, { error: 'Calendar block not found.' });
        const arrival = date(request.body?.arrival);
        const departure = date(request.body?.departure);
        if (!arrival || !departure || departure <= arrival) return json(response, 400, { error: 'Choose a valid start and checkout date.' });
        const conflicts = unavailableRanges(calendar).filter((range) => range.id !== blockId);
        if (conflicts.some((range) => rangesOverlap({ arrival, departure }, range))) return json(response, 409, { error: 'Those dates overlap another reservation, booking, or owner block.' });
        await appendBookingRecord({ type: 'block_updated', blockId, changes: { label: text(request.body?.name, 100) || block.label, note: text(request.body?.note, 240), arrival, departure }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'remove-block') {
        await appendBookingRecord({ type: 'block_removed', blockId: text(request.body?.blockId, 80), createdAt });
        return json(response, 200, { ok: true });
      }
      const bookingId = text(request.body?.bookingId, 80);
      const calendar = await getBookingCalendar();
      const booking = calendar.bookings.find((item) => item.id === bookingId);
      if (!booking) return json(response, 404, { error: 'Booking request not found.' });
      if (action === 'edit-booking') {
        const arrival = date(request.body?.arrival);
        const lastHeldDate = date(request.body?.departure);
        if (!arrival || !lastHeldDate || lastHeldDate < arrival) return json(response, 400, { error: 'Choose a valid first and last day for the hold.' });
        const departure = addDays(lastHeldDate, 1);
        const requestedChoice = Math.max(0, Number(request.body?.dateChoice || 1) - 1);
        const choiceIndex = ['pending', 'offered'].includes(booking.status) ? requestedChoice : (Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0);
        const dateChoices = (booking.dateChoices || []).map((choice) => ({ ...choice }));
        if (!dateChoices[choiceIndex]) return json(response, 400, { error: 'That date choice could not be found.' });
        const conflicts = unavailableRanges(calendar).filter((range) => range.bookingId !== booking.id);
        if (conflicts.some((range) => rangesOverlap({ arrival, departure }, range))) return json(response, 409, { error: 'Those dates overlap another reservation, booking, or owner block.' });
        dateChoices[choiceIndex] = { ...dateChoices[choiceIndex], arrival, departure };
        await appendBookingRecord({ type: 'status', bookingId, changes: { name: text(request.body?.name, 100) || booking.name, calendarNote: text(request.body?.note, 240), dateChoices }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'reserve-request') {
        const approvedChoice = Math.max(0, Number(request.body?.dateChoice || 1) - 1);
        const requestedDates = booking.dateChoices?.[approvedChoice];
        const conflicts = unavailableRanges(await getBookingCalendar()).filter((range) => range.bookingId !== booking.id);
        if (!requestedDates || conflicts.some((range) => rangesOverlap(requestedDates, range))) return json(response, 409, { error: 'Those dates are no longer available.' });
        await appendBookingRecord({ type: 'status', bookingId, changes: { status: 'reserved', approvedChoice, amountCents: requestedDates.amountCents || booking.amountCents, reservedAt: createdAt }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'mark-booked') {
        const paymentReady = booking.paymentPlan === 'complimentary' || Number(booking.amountCents) === 0 || booking.paymentRequirementMet === true;
        if (!paymentReady || !booking.agreementAcceptedAt) return json(response, 409, { error: `This stay is still missing ${!paymentReady && !booking.agreementAcceptedAt ? 'payment and the rental agreement' : !paymentReady ? 'the required payment' : 'the rental agreement'}. Use Check payment after Square is paid.` });
        await appendBookingRecord({ type: 'status', bookingId, changes: { status: 'booked', bookedAt: createdAt }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'cancel-booking') {
        if (booking.squareInvoiceId) await cancelSquareInvoice(booking.squareInvoiceId);
        await appendBookingRecord({ type: 'status', bookingId, changes: { status: 'cancelled', cancelledAt: createdAt }, createdAt });
        const choice = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0];
        try {
          await sendEmail({
            to: booking.email,
            toName: booking.name,
            templateKey:'reservation-cancelled', templateVariables:{ guestName:booking.name, arrival:choice?.arrival || 'your scheduled arrival', departure:choice?.departure || 'your scheduled departure' },
            subject: 'Your Weeks Creek Haven reservation was cancelled',
            text: `Hi ${booking.name},\n\nYour Weeks Creek Haven reservation${choice ? ` from ${choice.arrival} to ${choice.departure}` : ''} has been cancelled. Those dates are no longer being held for you.\n\nIf a payment or refund needs attention, we will follow up separately. If this was unexpected or you would like to request different dates, please reply to this email and we will help.`,
            html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Reservation cancelled</h1><p>Hi ${escapeEmailHtml(booking.name)},</p><p>Your Weeks Creek Haven reservation${choice ? ` for <strong>${choice.arrival} through ${choice.departure}</strong>` : ''} has been cancelled. Those dates are no longer being held for you.</p><p>If a payment or refund needs attention, we will follow up separately. If this was unexpected or you would like to request different dates, please reply to this email and we will help.</p></div>`,
          });
          await appendBookingRecord({ type: 'status', bookingId, changes: { cancellationEmailSentAt: new Date().toISOString() }, createdAt: new Date().toISOString() });
          return json(response, 200, { ok: true, cancellationEmailSent: true });
        } catch (emailError) {
          console.error(emailError);
          return json(response, 200, { ok: true, cancellationEmailSent: false, warning: 'The booking was cancelled, but the guest email could not be delivered.' });
        }
      }
      return json(response, 400, { error: 'Unknown calendar action.' });
    }
    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'The owner calendar is temporarily unavailable.' });
  }
}
