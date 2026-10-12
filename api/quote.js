import { getBookingCalendar } from '../_lib/booking-store.js';
import { getInvites } from '../_lib/invite-store.js';
import { guestQuote, pricingIdentity } from '../_lib/guest-quote.js';
import { matchingGuestDiscount, normalizedEmail, normalizedPhone } from '../guest-identity.js';
import { enforceRateLimit, json, rateLimitJson, requireInvite, sameOriginRequest } from '../_lib/security.js';

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { error: 'Method not allowed.' });
  if (request.method === 'POST') {
    if (!sameOriginRequest(request)) return json(response, 403, { error: 'Open the booking form directly from this website.' });
    const identifying = request.body?.action === 'identify';
    const rate = enforceRateLimit(request, identifying ? 'guest-profile-check' : 'private-quote', identifying ? 15 : 90, 15 * 60 * 1000);
    if (!rate.allowed) return rateLimitJson(response, rate);
  }
  try {
    const input = request.method === 'POST' ? request.body || {} : request.query || {};
    const calendar = await getBookingCalendar();
    const inviteSession = requireInvite(request);
    const invites = inviteSession && !String(inviteSession.visitorName || '').includes('owner preview') ? await getInvites() : [];
    const activeInvite = invites.find((item) => item.id === inviteSession?.inviteId && !item.archivedAt && !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) >= Date.now()));
    const identity = pricingIdentity(request.method === 'POST' ? input : {}, activeInvite);
    if (request.method === 'POST' && input.action === 'identify') {
      if (!activeInvite && !normalizedPhone(input.phone) && !normalizedEmail(input.email)) return json(response, 400, { error: 'Enter a valid phone number or email to check your guest profile.' }, { 'Cache-Control': 'private, no-store' });
      const rule = matchingGuestDiscount(identity, calendar.discounts || []);
      return json(response, 200, { privatePricing: Boolean(rule || activeInvite?.complimentary), complimentary: Boolean(activeInvite?.complimentary || rule?.discountType === 'complimentary') }, { 'Cache-Control': 'private, no-store' });
    }
    const quote = guestQuote({
      arrival: String(input.arrival || ''),
      departure: String(input.departure || ''),
      guests: Number(input.guests || 1),
      dogs: Number(input.dogs || 0),
      lateCheckout: input.lateCheckout,
      ...identity,
    }, calendar, activeInvite);
    if (!quote) return json(response, 400, { error: 'Choose valid arrival and checkout dates, up to 365 nights apart.' });
    // A contact lookup reveals the rate, never the saved guest's name or other profile fields.
    if (quote.friendsAndFamilyDiscount) quote.friendsAndFamilyDiscount = { ...quote.friendsAndFamilyDiscount, guestName: '', id: undefined };
    return json(response, 200, { quote }, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    if (error.status === 409) return json(response, 409, { error: error.message }, { 'Cache-Control': 'private, no-store' });
    console.error(error);
    return json(response, 503, { error: 'A price estimate is temporarily unavailable.' });
  }
}
