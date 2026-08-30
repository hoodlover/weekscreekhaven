import { getBookingCalendar } from '../_lib/booking-store.js';
import { getInvites } from '../_lib/invite-store.js';
import { applyInviteComplimentary } from '../_lib/invite-pricing.js';
import { enforceRateLimit, json, rateLimitJson, requireInvite, sameOriginRequest } from '../_lib/security.js';
import { applyFriendsAndFamilyDiscount, quoteStay } from '../pricing.js';

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
  if (request.method === 'POST') {
    if (!sameOriginRequest(request)) return json(response, 403, { error: 'Open the booking form directly from this website.' });
    const rate = enforceRateLimit(request, 'private-quote', 30, 15 * 60 * 1000);
    if (!rate.allowed) return rateLimitJson(response, rate);
  }
  try {
    const input = request.method === 'POST' ? request.body || {} : request.query || {};
    const calendar = await getBookingCalendar();
    const inviteSession = requireInvite(request);
    const invites = inviteSession && !String(inviteSession.visitorName || '').includes('owner preview') ? await getInvites() : [];
    const activeInvite = invites.find((item) => item.id === inviteSession?.inviteId && !item.archivedAt && !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) >= Date.now()));
    const standardQuote = quoteStay({
      arrival: String(input.arrival || ''),
      departure: String(input.departure || ''),
      guests: Number(input.guests || 1),
      dogs: Number(input.dogs || 0),
      lateCheckout: input.lateCheckout,
      rates: calendar.rates || [],
    });
    if (!standardQuote) return json(response, 400, { error: 'Choose a valid arrival and checkout date.' });
    const pricingPhone = activeInvite?.recipientPhone || (request.method === 'POST' ? input.phone : '');
    const discountedQuote = applyFriendsAndFamilyDiscount(standardQuote, pricingPhone, calendar.discounts || []);
    const quote = applyInviteComplimentary(discountedQuote, activeInvite);
    return json(response, 200, { quote }, { 'Cache-Control': request.method === 'POST' || input.phone ? 'private, no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'A price estimate is temporarily unavailable.' });
  }
}
