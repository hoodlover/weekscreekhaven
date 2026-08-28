import { getBookingCalendar, unavailableRanges } from '../_lib/booking-store.js';
import { json } from '../_lib/security.js';
import { PRICING_CONFIG } from '../pricing.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const calendar = await getBookingCalendar();
    const requestCutoff = Date.now() - 48 * 60 * 60 * 1000;
    const requested = calendar.bookings.flatMap((booking) => {
      const status = booking.status === 'approved' ? 'reserved' : booking.status;
      if (status === 'pending' && Date.parse(booking.createdAt) >= requestCutoff) {
        return (booking.dateChoices || []).map(({ arrival, departure }) => ({ arrival, departure, state: 'requested' }));
      }
      if (status === 'reserved' && booking.paymentRequirementMet !== true && (!booking.paymentPlan || booking.paymentPlan === 'deposit-balance')) {
        const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0];
        return dates ? [{ arrival: dates.arrival, departure: dates.departure, state: 'deposit-pending' }] : [];
      }
      return [];
    });
    return json(response, 200, {
      unavailable: unavailableRanges(calendar).map(({ arrival, departure }) => ({ arrival, departure })),
      requested,
      defaultNightlyRateCents: calendar.defaultNightlyRateCents || 0,
      rates: (calendar.rates || []).map(({ arrival, departure, amountCents, pricingMode, totalCents, nightCount }) => ({ arrival, departure, amountCents, pricingMode, totalCents, nightCount })),
      pricing: PRICING_CONFIG,
      updatedAt: new Date().toISOString(),
    }, { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Availability is temporarily unavailable.' });
  }
}
