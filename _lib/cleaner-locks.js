import { configuredDoors } from './lock-service.js';
import { createKKHomeLockProvider } from './lock-providers/kkhome.js';
import { getCleanerState, appendCleanerRecord } from './cleaner-store.js';
import { getBookingRequests } from './booking-store.js';
import { get, put, del } from '@vercel/blob';

export function validCleaningDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
const shift = date => new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
function localTime(date, time) {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T${time}Z`)).find(part => part.type === 'timeZoneName').value.replace('GMT', '');
  return `${date}T${time}${offset}`;
}
export function cleanerAccessDates(state) {
  // Only dates explicitly entered by the owner grant access. Suggested checkouts do not.
  return [...new Set([...(state.settings.cleanerAccessDates || []), ...state.assignments
    .filter(item => item.customSession && !['cancelled', 'declined'].includes(item.status)).map(item => item.cleanDate)])]
    .filter(date => validCleaningDate(date) && !(state.settings.cleanerAccessExcludedDates || []).includes(date)).sort();
}
export function cleanerAccessWindow(state, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const dates = cleanerAccessDates(state).filter(date => date >= today);
  if (!dates.length) return null;
  let last = dates[0];
  for (let index = 1; index < dates.length && dates[index] === shift(last); index++) last = dates[index];
  return { startsAt: localTime(dates[0], '00:00:00'), endsAt: localTime(last, '23:59:59'), timezone: 'America/New_York' };
}

export async function reconcileCleanerLocks({ state, bookings, provider, doors, save, now = new Date() }) {
  const desiredCode = String(state.settings.doorCode || '');
  if (desiredCode && !/^\d{4,10}$/.test(desiredCode)) throw new Error('Save a valid cleaner door code first.');
  if (desiredCode && bookings.some(b => [b.doorCode, ...(b.retiredDoorCodes || [])].map(String).includes(desiredCode))) {
    throw new Error('The cleaner PIN must be separate from every guest PIN.');
  }
  const window = desiredCode ? cleanerAccessWindow(state, now) : null;
  const ledger = structuredClone(state.settings.cleanerLockState || { doors: {} });
  ledger.doors ||= {};
  ledger.checkedAt = now.toISOString();
  ledger.window = window;
  // Persist each reference before proceeding to the next door, including failed writes.
  for (const door of doors) {
    let entry = ledger.doors[door.id] || {};
    try {
      if (entry.providerCodeId && entry.code !== desiredCode) {
        await provider.removeCode({ door, code: entry.code, providerCodeId: entry.providerCodeId });
        entry = {}; ledger.doors[door.id] = entry; await save(ledger);
      }
      if (!entry.providerCodeId && desiredCode) {
        const found = await provider.findCode({ door, code: desiredCode });
        if (found) { entry = { code: desiredCode, ...found }; ledger.doors[door.id] = entry; await save(ledger); }
      }
      if (!window) {
        if (entry.providerCodeId) await provider.removeCode({ door, code: entry.code, providerCodeId: entry.providerCodeId });
        entry = { status: 'removed' };
      } else {
        entry = { ...entry, code: desiredCode };
        const result = await provider.installCode({ door, code: desiredCode, name: 'Cleaner scheduled access', ...window, providerCodeId: entry.providerCodeId });
        entry = { code: desiredCode, providerCodeId: result.providerCodeId, status: result.status };
      }
    } catch (error) {
      entry = { ...entry, status: 'failed', ...(error.providerCodeId ? { providerCodeId: error.providerCodeId, code: desiredCode } : {}), message: 'Lock update needs another check.' };
    }
    ledger.doors[door.id] = entry;
    await save(ledger);
  }
  ledger.status = doors.every(door => ledger.doors[door.id]?.status === (window ? 'installed' : 'removed')) ? (window ? 'scheduled' : 'inactive') : 'needs-attention';
  await save(ledger);
  return ledger;
}

export async function syncCleanerLocks(env = process.env) {
  if (env.LOCK_PROVIDER !== 'kkhome' || env.KKHOME_LIVE_ENABLED !== 'true') return { status: 'disabled' };
  const token = env.INVITE_BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN;
  const path = 'secure-cleaner/lock-sync-lease.json';
  const options = { token, access: 'private' };
  const existing = await get(path, { ...options, useCache: false });
  if (existing?.statusCode === 200) {
    const lease = JSON.parse(await new Response(existing.stream).text());
    if (lease.expiresAt > Date.now()) return { status: 'queued' };
    try { await del(path, { token, ifMatch: existing.blob.etag }); } catch { return { status: 'queued' }; }
  }
  let lease;
  try {
    lease = await put(path, JSON.stringify({ expiresAt: Date.now() + 300000 }), { ...options, addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
  } catch (error) {
    if (/already exists|precondition/i.test(error.message)) return { status: 'queued' };
    throw error;
  }
  try {
    const [state, bookings] = await Promise.all([getCleanerState(), getBookingRequests()]);
    const provider = createKKHomeLockProvider(env, { fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) });
    return await reconcileCleanerLocks({ state, bookings, provider, doors: configuredDoors(env),
      save: cleanerLockState => appendCleanerRecord({ type: 'settings', createdAt: new Date().toISOString(), changes: { cleanerLockState } }) });
  } finally {
    await del(path, { token, ifMatch: lease.etag }).catch(() => {});
  }
}
