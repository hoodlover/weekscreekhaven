import { getBookingRequests } from '../_lib/booking-store.js';
import { enforceRateLimit, json, rateLimitJson, sameOriginRequest } from '../_lib/security.js';

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length === 10 ? digits : '';
};
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error: 'Open the Weeks Creek Haven booking page to continue.' });
  const rate = enforceRateLimit(request, 'returning-guest', 20, 60 * 60 * 1000);
  if (!rate.allowed) return rateLimitJson(response, rate);
  const phone = normalizePhone(request.body?.phone);
  const email = normalizeEmail(request.body?.email);
  if (!phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(response, 200, { found: false });
  try {
    const bookings = await getBookingRequests();
    const match = bookings.find((booking) => normalizePhone(booking.phone) === phone && normalizeEmail(booking.email) === email);
    if (!match) return json(response, 200, { found: false }, { 'Cache-Control': 'private, no-store' });
    return json(response, 200, { found: true, profile: {
      name: match.name || '', billingAddress: match.billingAddress || '', billingCity: match.billingCity || '', billingState: match.billingState || '', billingPostalCode: match.billingPostalCode || '',
      guestNames: match.guestNames || '', vehicleCount: Number.isFinite(Number(match.vehicleCount)) ? String(match.vehicleCount) : '', relationship: match.relationship || '', reference: match.reference || '',
    } }, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Saved guest information is temporarily unavailable.' });
  }
}
