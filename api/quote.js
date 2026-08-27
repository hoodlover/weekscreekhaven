import { getBookingCalendar } from '../_lib/booking-store.js';
import { json } from '../_lib/security.js';
import { applyFriendsAndFamilyDiscount, quoteStay } from '../pricing.js';

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
  try {
    const input = request.method === 'POST' ? request.body || {} : request.query || {};
    const calendar = await getBookingCalendar();
    const standardQuote = quoteStay({
      arrival: String(input.arrival || ''),
      departure: String(input.departure || ''),
      guests: Number(input.guests || 1),
      dogs: Number(input.dogs || 0),
      lateCheckout: input.lateCheckout,
      rates: calendar.rates || [],
    });
    if (!standardQuote) return json(response, 400, { error: 'Choose a valid arrival and checkout date.' });
    const quote = applyFriendsAndFamilyDiscount(standardQuote, input.phone, calendar.discounts || []);
    return json(response, 200, { quote }, { 'Cache-Control': request.method === 'POST' || input.phone ? 'private, no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'A price estimate is temporarily unavailable.' });
  }
}
