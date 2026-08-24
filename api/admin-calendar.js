import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { json, requireAdmin } from '../_lib/security.js';

const text = (value, max = 120) => String(value || '').trim().slice(0, max);
const date = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      return json(response, 200, await getBookingCalendar(), { 'Cache-Control': 'no-store' });
    }
    const createdAt = new Date().toISOString();
    if (request.method === 'POST') {
      const arrival = date(request.body?.arrival);
      const departure = date(request.body?.departure);
      if (!arrival || !departure || departure <= arrival) return json(response, 400, { error: 'Choose a valid start and end date.' });
      if (unavailableRanges(await getBookingCalendar()).some((range) => rangesOverlap({ arrival, departure }, range))) return json(response, 409, { error: 'Those dates already include a reservation, booking, or owner block.' });
      const block = { id: crypto.randomUUID(), arrival, departure, label: text(request.body?.label, 100) || 'Owner hold', createdAt };
      await appendBookingRecord({ type: 'block_created', block, createdAt });
      return json(response, 201, { block });
    }
    if (request.method === 'PATCH') {
      const action = text(request.body?.action, 30);
      if (action === 'edit-block') {
        const blockId = text(request.body?.blockId, 80);
        const block = (await getBookingCalendar()).blocks.find((item) => item.id === blockId);
        if (!block) return json(response, 404, { error: 'Calendar block not found.' });
        await appendBookingRecord({ type: 'block_updated', blockId, changes: { label: text(request.body?.name, 100) || block.label, note: text(request.body?.note, 240) }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'remove-block') {
        await appendBookingRecord({ type: 'block_removed', blockId: text(request.body?.blockId, 80), createdAt });
        return json(response, 200, { ok: true });
      }
      const bookingId = text(request.body?.bookingId, 80);
      const booking = (await getBookingCalendar()).bookings.find((item) => item.id === bookingId);
      if (!booking) return json(response, 404, { error: 'Booking request not found.' });
      if (action === 'edit-booking') {
        await appendBookingRecord({ type: 'status', bookingId, changes: { name: text(request.body?.name, 100) || booking.name, calendarNote: text(request.body?.note, 240) }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'reserve-request') {
        const approvedChoice = Number(request.body?.dateChoice) === 2 ? 1 : 0;
        const requestedDates = booking.dateChoices?.[approvedChoice];
        const conflicts = unavailableRanges(await getBookingCalendar()).filter((range) => range.bookingId !== booking.id);
        if (!requestedDates || conflicts.some((range) => rangesOverlap(requestedDates, range))) return json(response, 409, { error: 'Those dates are no longer available.' });
        await appendBookingRecord({ type: 'status', bookingId, changes: { status: 'reserved', approvedChoice, reservedAt: createdAt }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'mark-booked') {
        await appendBookingRecord({ type: 'status', bookingId, changes: { status: 'booked', bookedAt: createdAt }, createdAt });
        return json(response, 200, { ok: true });
      }
      if (action === 'cancel-booking') {
        await appendBookingRecord({ type: 'status', bookingId, changes: { status: 'cancelled', cancelledAt: createdAt }, createdAt });
        return json(response, 200, { ok: true });
      }
      return json(response, 400, { error: 'Unknown calendar action.' });
    }
    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'The owner calendar is temporarily unavailable.' });
  }
}
