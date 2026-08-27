import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { finalizeBookingFlow } from '../_lib/booking-finalization.js';
import { anonymizeIp, json, verifyAgreementToken } from '../_lib/security.js';

export const AGREEMENT_VERSION = '2026-08-27-fannin';
export const AGREEMENT_VERSION_LABEL = 'August 27, 2026 · Fannin County edition';

async function context(rawToken) {
  const token = verifyAgreementToken(rawToken);
  if (!token) return null;
  const booking = (await getBookingRequests()).find((item) => item.id === token.bookingId);
  if (!booking) return null;
  const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || null;
  return { booking, dates };
}

function bookingDetails({ booking, dates }) {
  return {
    guestName: booking.name,
    email: booking.email,
    guests: booking.guests || 1,
    arrival: dates?.arrival || '',
    departure: dates?.departure || '',
    totalCents: Number(booking.amountCents) || Number(dates?.amountCents) || 0,
    discountCents: Number(booking.discountAmountCents) || 0,
    acceptedAt: booking.agreementAcceptedAt || null,
    acceptedBy: booking.agreementAcceptedBy || '',
    agreementVersion: booking.agreementVersion || AGREEMENT_VERSION,
    agreementVersionLabel: booking.agreementVersion && booking.agreementVersion !== AGREEMENT_VERSION
      ? booking.agreementVersion
      : AGREEMENT_VERSION_LABEL,
  };
}

export default async function handler(request, response) {
  try {
    const rawToken = request.method === 'GET' ? request.query?.token : request.body?.token;
    const result = await context(rawToken);
    if (!result) return json(response, 404, { error: 'This rental agreement link is invalid or has expired.' });
    if (request.method === 'GET') return json(response, 200, bookingDetails(result), { 'Cache-Control': 'no-store' });
    if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
    if (result.booking.agreementAcceptedAt) return json(response, 409, { error: 'This rental agreement has already been accepted.' });
    const acceptedBy = String(request.body?.acceptedBy || '').trim().slice(0, 100);
    if (acceptedBy.length < 2 || request.body?.accepted !== true || request.body?.electronicConsent !== true) {
      return json(response, 400, { error: 'Type your full name and check both agreement boxes.' });
    }
    const acceptedAt = new Date().toISOString();
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const changes = {
      agreementAcceptedAt: acceptedAt,
      agreementAcceptedBy: acceptedBy,
      agreementVersion: AGREEMENT_VERSION,
      agreementIpHash: anonymizeIp(forwarded || request.socket?.remoteAddress || ''),
      agreementUserAgent: String(request.headers['user-agent'] || '').slice(0, 300),
    };
    await appendBookingRecord({
      type: 'status',
      bookingId: result.booking.id,
      changes,
      createdAt: acceptedAt,
    });
    const finalized = await finalizeBookingFlow({ ...result.booking, ...changes });
    return json(response, 201, { ok: true, acceptedAt, booked: finalized.status === 'booked' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'The rental agreement could not be saved.' });
  }
}
