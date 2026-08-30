import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { enforceRateLimit, json, rateLimitJson, sameOriginRequest, verifyAgreementToken } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error:'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error:'This checkout request was blocked.' });
  const rate = enforceRateLimit(request, 'complete-checkout', 12, 15 * 60 * 1000);
  if (!rate.allowed) return rateLimitJson(response, rate);
  try {
    const payload = verifyAgreementToken(request.body?.token);
    if (!payload) return json(response, 401, { error:'This checkout link is invalid or has expired.' });
    const bookings = await getBookingRequests();
    const booking = bookings.find(item => item.id === payload.bookingId);
    if (!booking) return json(response, 404, { error:'This booking could not be found.' });
    if (['cancelled','declined'].includes(booking.status)) return json(response, 409, { error:'This booking is no longer active.' });
    if (booking.checkoutCompletedAt) return json(response, 200, { ok:true, completedAt:booking.checkoutCompletedAt });
    const completedAt = new Date().toISOString();
    await appendBookingRecord({
      type:'status', bookingId:booking.id, createdAt:completedAt,
      changes:{ status:'completed', checkoutCompletedAt:completedAt, checkoutFormSubmittedAt:completedAt },
    });
    return json(response, 200, { ok:true, completedAt });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error:error.message || 'Checkout could not be marked complete.' });
  }
}
