import { getBookingCalendar, unavailableRanges } from '../_lib/booking-store.js';
import { json } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const calendar = await getBookingCalendar();
    return json(response, 200, {
      unavailable: unavailableRanges(calendar).map(({ arrival, departure }) => ({ arrival, departure })),
      defaultNightlyRateCents: calendar.defaultNightlyRateCents || 0,
      rates: (calendar.rates || []).map(({ arrival, departure, amountCents }) => ({ arrival, departure, amountCents })),
      updatedAt: new Date().toISOString(),
    }, { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Availability is temporarily unavailable.' });
  }
}
