import { getBookingRequests } from '../_lib/booking-store.js';
import { getSquareInvoiceAccounting } from '../_lib/square.js';
import { json, requireAdmin } from '../_lib/security.js';
import { daysBetween, withEstimatedTaxesAndFees } from '../pricing.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const bookings = (await getBookingRequests()).filter((booking) => booking.status === 'booked' || booking.paymentFullyPaid);
    const rows = await Promise.all(bookings.map(async (booking) => {
      const choice = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || {};
      const actualNights = choice.arrival && choice.departure ? daysBetween(choice.arrival, choice.departure) : 0;
      const preTaxAmountCents = Number(booking.preTaxAmountCents ?? choice.quote?.totalCents ?? choice.amountCents ?? booking.amountCents) || 0;
      const tax = withEstimatedTaxesAndFees({ totalCents: preTaxAmountCents, actualNights });
      let paidCents = Number(booking.squarePaidCents) || (booking.paymentPlan === 'complimentary' ? 0 : Number(booking.amountCents) || 0);
      let refundedCents = (booking.refunds || []).reduce((sum, refund) => sum + (Number(refund.amountCents) || 0), 0);
      let squareFeeCents = null;
      let squareFeeStatus = booking.squareInvoiceId ? 'unavailable' : 'not-applicable';
      if (booking.squareInvoiceId) {
        try {
          const square = await getSquareInvoiceAccounting(booking.squareInvoiceId, booking.squareOrderId);
          paidCents = square.paidCents;
          refundedCents = square.refundedCents;
          squareFeeCents = square.processingFeeCents;
          squareFeeStatus = 'actual';
        } catch {
          squareFeeStatus = 'unavailable';
        }
      }
      const netPaidCents = Math.max(0, paidCents - refundedCents);
      const salesTaxCents = Number(booking.salesTaxCents ?? tax.salesTaxCents) || 0;
      const lodgingTaxCents = Number(booking.lodgingTaxCents ?? tax.lodgingTaxCents) || 0;
      const stateHotelMotelFeeCents = Number(booking.stateHotelMotelFeeCents ?? tax.stateHotelMotelFeeCents) || 0;
      return {
        id: booking.id,
        guestName: booking.name || 'Guest',
        arrival: choice.arrival || '',
        departure: choice.departure || '',
        bookedAt: booking.bookedAt || booking.paymentReceivedAt || booking.approvedAt || '',
        preTaxAmountCents,
        paidCents,
        refundedCents,
        netPaidCents,
        salesTaxCents,
        lodgingTaxCents,
        stateHotelMotelFeeCents,
        totalGovernmentCents: salesTaxCents + lodgingTaxCents + stateHotelMotelFeeCents,
        squareFeeCents,
        squareFeeStatus,
        netAfterTaxesAndSquareCents: netPaidCents - salesTaxCents - lodgingTaxCents - stateHotelMotelFeeCents - (squareFeeCents || 0),
      };
    }));
    rows.sort((a, b) => String(a.arrival).localeCompare(String(b.arrival)));
    return json(response, 200, { rows, generatedAt: new Date().toISOString() }, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'The accounting report is temporarily unavailable.' });
  }
}
