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
  const rates = new Map();
  const discounts = new Map();
  const emailTemplates = new Map();
  let defaultNightlyRateCents = 0;
  for (const record of records) {
    if (record.type === 'requested') requests.set(record.booking.id, record.booking);
    if (record.type === 'status' && requests.has(record.bookingId)) {
      Object.assign(requests.get(record.bookingId), record.changes);
    }
    if (record.type === 'block_created') blocks.set(record.block.id, record.block);
    if (record.type === 'block_updated' && blocks.has(record.blockId)) Object.assign(blocks.get(record.blockId), record.changes);
    if (record.type === 'block_removed') blocks.delete(record.blockId);
    if (record.type === 'rate_default') defaultNightlyRateCents = Number(record.amountCents) || 0;
    if (record.type === 'rate_created') rates.set(record.rate.id, record.rate);
    if (record.type === 'rate_removed') rates.delete(record.rateId);
    if (record.type === 'discount_created') discounts.set(record.discount.id, record.discount);
    if (record.type === 'discount_updated') discounts.set(record.discount.id, record.discount);
    if (record.type === 'discount_removed') discounts.delete(record.discountId);
    if (record.type === 'email_template_saved') emailTemplates.set(record.template.id, record.template);
    if (record.type === 'email_template_removed') emailTemplates.set(record.templateId, { id: record.templateId, deletedAt: record.createdAt });
  }
  const now = Date.now();
  const bookings = [...requests.values()].map((booking) => {
    const inquiryExpiresAt = booking.bookingIntent === 'questions'
      ? booking.inquiryExpiresAt || new Date(Date.parse(booking.createdAt) + 48 * 60 * 60 * 1000).toISOString()
      : null;
    if (inquiryExpiresAt && Date.parse(inquiryExpiresAt) <= now && booking.status === 'pending') {
      return { ...booking, inquiryExpiresAt, status: 'expired', archivedAt: booking.archivedAt || inquiryExpiresAt };
    }
    return inquiryExpiresAt ? { ...booking, inquiryExpiresAt } : booking;
  });
  return {
    bookings: bookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    blocks: [...blocks.values()].sort((a, b) => a.arrival.localeCompare(b.arrival)),
    defaultNightlyRateCents,
    rates: [...rates.values()].sort((a, b) => a.arrival.localeCompare(b.arrival)),
    discounts: [...discounts.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    emailTemplates: [...emailTemplates.values()],
  };
}

export async function getBookingRequests() {
  return (await getBookingCalendar()).bookings;
}

export function rangesOverlap(first, second) {
  return first.arrival < second.departure && second.arrival < first.departure;
}

export function unavailableRanges(calendar) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const todayValues = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
  const bookingRanges = calendar.bookings.flatMap((booking) => {
    const status = booking.status === 'approved' ? 'reserved' : booking.status;
    if (status !== 'booked') return [];
    const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0];
    return dates ? [{ ...dates, type: status, label: booking.name, bookingId: booking.id }] : [];
  });
  return [...bookingRanges, ...calendar.blocks.filter((block) => block.holdType !== 'flexible').map((block) => ({ ...block, type: 'blocked' }))];
}
