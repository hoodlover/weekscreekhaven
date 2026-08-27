import crypto from 'node:crypto';
import { getBookingRequests } from '../_lib/booking-store.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';

export const config = { api: { bodyParser: false } };

function send(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function rawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function validSignature(body, signature) {
  const key = String(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '');
  const url = String(process.env.SQUARE_WEBHOOK_URL || 'https://www.weekscreekhaven.com/api/square-webhook');
  if (!key || !signature) return false;
  const expected = crypto.createHmac('sha256', key).update(`${url}${body}`).digest();
  let supplied;
  try { supplied = Buffer.from(String(signature), 'base64'); } catch { return false; }
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed.' });
  try {
    const body = await rawBody(request);
    if (!validSignature(body, request.headers['x-square-hmacsha256-signature'])) return send(response, 403, { error: 'Invalid Square signature.' });
    const event = JSON.parse(body);
    if (!['invoice.payment_made', 'invoice.updated'].includes(event.type)) return send(response, 200, { received: true, ignored: true });
    const invoiceId = String(event.data?.object?.invoice?.id || '');
    if (!invoiceId) return send(response, 200, { received: true, ignored: true });
    const booking = (await getBookingRequests()).find((item) => item.squareInvoiceId === invoiceId);
    if (!booking || booking.squareLastEventId === event.event_id) return send(response, 200, { received: true, ignored: true });
    await refreshSquareBooking(booking, { eventId: String(event.event_id || '') });
    return send(response, 200, { received: true });
  } catch (error) {
    console.error(error);
    return send(response, 503, { error: 'Square payment update could not be recorded.' });
  }
}
