import { get, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';
import { createHash } from 'node:crypto';

const PATH = 'secure-bookings/calendar-sync/airbnb.json.enc';
const token = () => process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;

export function validateAirbnbFeed(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || !['www.airbnb.com', 'airbnb.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/calendar\/ical\/[^/]+\.ics$/.test(url.pathname)) throw new Error('Use the Airbnb export calendar link ending in .ics.');
  return url.href;
}

function day(value) {
  if (!/^\d{8}$/.test(value || '')) throw new Error('Calendar dates must be all-day dates.');
  const result = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  if (new Date(`${result}T00:00:00Z`).toISOString().slice(0,10) !== result) throw new Error('Invalid calendar date.');
  return result;
}

export function parseAirbnbCalendar(source) {
  if (typeof source !== 'string' || !source.includes('BEGIN:VCALENDAR') || !source.includes('END:VCALENDAR') || source.length > 2_000_000) throw new Error('Airbnb did not return a valid calendar.');
  const unfolded = source.replace(/\r?\n[ \t]/g, '');
  const entries = [];
  const events = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)];
  if (events.length !== (unfolded.match(/BEGIN:VEVENT/g) || []).length) throw new Error('Incomplete calendar response.');
  for (const match of events) {
    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      fields[line.slice(0,colon).split(';')[0].toUpperCase()] = line.slice(colon+1).trim();
    }
    if (fields.STATUS === 'CANCELLED' || fields.TRANSP === 'TRANSPARENT') continue;
    // Imported WCH events must never be sent back and become permanent mirrored holds.
    if ((fields.UID || '').includes('@weekscreekhaven.com') || /^WCH\s*[—-]/.test(fields.SUMMARY || '')) continue;
    const arrival = day(fields.DTSTART), departure = day(fields.DTEND);
    if (departure <= arrival) throw new Error('Invalid calendar date range.');
    const id = createHash('sha256').update(fields.UID || `${arrival}:${departure}`).digest('hex').slice(0,32);
    entries.push({ id, arrival, departure, label: 'Airbnb unavailable' });
  }
  return [...new Map(entries.map(entry => [entry.id, entry])).values()];
}

export async function readCalendarSync() {
  const result = await get(PATH, { access:'private', token:token() });
  if (!result || result.statusCode === 404) return { entries:[] };
  if (result.statusCode !== 200) throw new Error('Calendar sync storage is unavailable.');
  return decryptRecord(await new Response(result.stream).text());
}

async function saveCalendarSync(record) {
  await put(PATH, encryptRecord(record), { access:'private', token:token(), addRandomSuffix:false, allowOverwrite:true, contentType:'text/plain', cacheControlMaxAge:60 });
}

export async function refreshCalendarSync(feedUrl) {
  const previous = await readCalendarSync();
  const url = validateAirbnbFeed(feedUrl || previous.feedUrl);
  const response = await fetch(url, { redirect:'error', signal:AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Airbnb calendar could not be refreshed. Existing blocked dates have been kept.');
  const entries = parseAirbnbCalendar(await response.text());
  const record = { feedUrl:url, entries, syncedAt:new Date().toISOString() };
  await saveCalendarSync(record);
  return record;
}
