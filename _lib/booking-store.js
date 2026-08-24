import { get, list, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';

const PREFIX = 'secure-bookings/records/';

function token() {
  return process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
}

function ensureConfigured() {
  if (!token()) throw new Error('Booking storage is not configured.');
}

async function readBlob(blob) {
  const result = await get(blob.pathname, { access: 'private', token: token() });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

export async function appendBookingRecord(record) {
  ensureConfigured();
  const timestamp = new Date(record.createdAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  await put(`${PREFIX}${timestamp}-${crypto.randomUUID()}.json.enc`, encryptRecord(record), {
    access: 'private', token: token(), contentType: 'text/plain; charset=utf-8',
    addRandomSuffix: false, cacheControlMaxAge: 60,
  });
  return record;
}

async function getRecords() {
  ensureConfigured();
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000, token: token() });
    const values = await Promise.all(page.blobs.map(async (blob) => {
      try { return decryptRecord(await readBlob(blob)); } catch { return null; }
    }));
    records.push(...values.filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return records.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getBookingCalendar() {
  const records = await getRecords();
  const requests = new Map();
  const blocks = new Map();
  for (const record of records) {
    if (record.type === 'requested') requests.set(record.booking.id, record.booking);
    if (record.type === 'status' && requests.has(record.bookingId)) {
      Object.assign(requests.get(record.bookingId), record.changes);
    }
    if (record.type === 'block_created') blocks.set(record.block.id, record.block);
    if (record.type === 'block_removed') blocks.delete(record.blockId);
  }
  return {
    bookings: [...requests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    blocks: [...blocks.values()].sort((a, b) => a.arrival.localeCompare(b.arrival)),
  };
}

export async function getBookingRequests() {
  return (await getBookingCalendar()).bookings;
}

export function rangesOverlap(first, second) {
  return first.arrival < second.departure && second.arrival < first.departure;
}

export function unavailableRanges(calendar) {
  const bookingRanges = calendar.bookings.flatMap((booking) => {
    const status = booking.status === 'approved' ? 'reserved' : booking.status;
    if (!['reserved', 'booked'].includes(status)) return [];
    const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0];
    return dates ? [{ ...dates, type: status, label: booking.name, bookingId: booking.id }] : [];
  });
  return [...bookingRanges, ...calendar.blocks.map((block) => ({ ...block, type: 'blocked' }))];
}
