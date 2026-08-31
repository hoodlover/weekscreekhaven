import { getBookingCalendar } from '../_lib/booking-store.js';
import { bookingAccessCode, createAgreementToken, enforceRateLimit, json, normalizePasscode, rateLimitJson, sameOriginRequest } from '../_lib/security.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const accessibleStatuses = new Set(['pending-payment', 'reserved', 'booked', 'completed']);

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error: 'Open the Guest Guide sign-in from this website.' });
  const rate = enforceRateLimit(request, 'guest-guide-login', 8, 15 * 60 * 1000);
  if (!rate.allowed) return rateLimitJson(response, rate);
  try {
    const suppliedCode = normalizePasscode(request.body?.reservationCode);
    if (!suppliedCode || !/^WCH-[A-Z0-9]{10}$/.test(suppliedCode)) {
      return json(response, 400, { error: 'Enter the WCH reservation code from your booking email.' });
    }
    const calendar = await getBookingCalendar();
    const booking = (calendar.bookings || []).find((candidate) => (
      accessibleStatuses.has(candidate.status) && bookingAccessCode(candidate.id) === suppliedCode
    ));
    if (!booking) {
      await wait(400);
      return json(response, 401, { error: 'We could not find an active reservation with that code. Check the code or contact Lance or Heather.' });
    }
    const token = createAgreementToken(booking.id, 365 * 86400);
    return json(response, 200, {
      ok: true,
      destination: `/friends-hub.html?token=${encodeURIComponent(token)}&tab=checkin`,
    }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'The Guest Guide lookup is temporarily unavailable. Please try again shortly.' });
  }
}
