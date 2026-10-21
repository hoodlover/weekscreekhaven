import { configuredDoors } from './lock-service.js';
import { createKKHomeLockProvider } from './lock-providers/kkhome.js';
import { getCleanerState, appendCleanerRecord } from './cleaner-store.js';
import { getBookingRequests } from './booking-store.js';
import { get, put, del } from '@vercel/blob';
import { LEGACY_CLEANER_ID, requireCleanerProfile } from './cleaner-profiles.js';
import { appliedCleanerPlan, assertAvailableCleanerCode, cleanerAccessRevision, profileAccessDates, requestedCleanerPlan } from './cleaner-access.js';
import { ownerLockEntries, withOwnerLockLease } from './owner-lock-store.js';

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

export async function reconcileCleanerLocks({ state, bookings, provider, doors, save, now = new Date(), allowAdopt = true, name = 'Cleaner scheduled access' }) {
  const desiredCode = String(state.settings.doorCode || '');
  if (desiredCode && !/^\d{4,10}$/.test(desiredCode)) throw new Error('Save a valid cleaner door code first.');
  if (desiredCode && bookings.some(b => [b.doorCode, ...(b.retiredDoorCodes || [])].map(String).includes(desiredCode))) {
    throw new Error('The cleaner PIN must be separate from every guest PIN.');
  }
  const window = desiredCode ? cleanerAccessWindow(state, now) : null;
  const ledger = structuredClone(state.settings.cleanerLockState || { doors: {} });
  ledger.doors ||= {};
  const expectedStatus = window ? 'scheduled' : 'inactive';
  if (ledger.status === expectedStatus && ledger.code === desiredCode && JSON.stringify(ledger.window) === JSON.stringify(window)
    && doors.every(door => ledger.doors[door.id]?.status === (window ? 'installed' : 'removed'))
    && now.getTime() - Date.parse(ledger.checkedAt || '') < 86400000) return ledger;
  ledger.code = desiredCode;
  ledger.status = 'updating';
  ledger.checkedAt = now.toISOString();
  ledger.window = window;
  // Persist each reference before proceeding to the next door, including failed writes.
  for (const door of doors) {
    let entry = ledger.doors[door.id] || {};
    try {
      if (entry.uncertain && !entry.providerCodeId && entry.code !== desiredCode) throw new Error('Resolve the previous unconfirmed PIN before changing it.');
      if (entry.providerCodeId && entry.code !== desiredCode) {
        await provider.removeCode({ door, code: entry.code, providerCodeId: entry.providerCodeId });
        entry = {}; ledger.doors[door.id] = entry; await save(ledger);
      }
      if (!entry.providerCodeId && desiredCode && (window || allowAdopt)) {
        const found = await provider.findCode({ door, code: desiredCode });
        if (found && !allowAdopt) throw new Error('This PIN already exists on the lock. Choose another PIN.');
        if (found) { entry = { code: desiredCode, ...found }; ledger.doors[door.id] = entry; await save(ledger); }
      }
      if (!window) {
        if (entry.uncertain && !entry.providerCodeId) throw new Error('An unconfirmed lock entry needs owner review before removal can be confirmed.');
        if (entry.providerCodeId) await provider.removeCode({ door, code: entry.code, providerCodeId: entry.providerCodeId });
        entry = { status: 'removed' };
      } else {
        entry = { ...entry, code: desiredCode, status: 'updating', uncertain: !entry.providerCodeId };
        ledger.doors[door.id] = entry; await save(ledger);
        const result = await provider.installCode({ door, code: desiredCode, name, ...window, providerCodeId: entry.providerCodeId });
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

export function profileLockState(profile, state) {
  const plan = appliedCleanerPlan(profile, state);
  return { settings: { doorCode: plan.code, cleanerAccessDates: profile.enabled ? plan.dates : [], cleanerLockState: profile.cleanerLockState }, assignments: [] };
}

export function visibleCleanerAccess(profile, state, now = new Date()) {
  const active = profileLockState(profile, state), plan = appliedCleanerPlan(profile, state), ledger = profile.cleanerLockState;
  const window = plan.code ? cleanerAccessWindow(active, now) : null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const dates = profileAccessDates(profile, state).filter(date => date >= today);
  const needsApply = (profile.doorCode || '') !== plan.code || JSON.stringify(dates) !== JSON.stringify(plan.dates.filter(date => date >= today));
  const confirmed = ledger?.code === plan.code && JSON.stringify(ledger?.window) === JSON.stringify(window);
  return { dates, needsApply, revision: cleanerAccessRevision(profile, state), status: ledger?.status === 'needs-attention' ? 'needs-attention' : confirmed ? ledger.status : plan.code ? 'pending' : 'not-applied',
    window, appliedCode: plan.code, appliedDates: plan.dates.filter(date => date >= today), checkedAt: ledger?.checkedAt || '',
    doors: configuredDoors().map(({ id, name }) => ({ id, name, status: confirmed || ledger?.doors?.[id]?.status === 'failed' ? ledger?.doors?.[id]?.status || 'not-applied' : ledger ? 'pending' : 'not-applied' })) };
}

export async function reconcileCleanerProfile({ profile, state, bookings, ownerEntries = [], provider, doors, save, now = new Date() }) {
  const active = profileLockState(profile, state);
  // Revocation must remain possible even if a conflicting PIN was saved later.
  if (cleanerAccessWindow(active, now)) assertAvailableCleanerCode(active.settings.doorCode, profile.id, state, bookings, ownerEntries);
  return reconcileCleanerLocks({ state: active, bookings: cleanerAccessWindow(active, now) ? bookings : [], provider, doors, save, now,
    allowAdopt: profile.id === LEGACY_CLEANER_ID && active.settings.doorCode === state.settings.doorCode, name: `${profile.cleanerName} · Cleaner access`.slice(0, 60) });
}

export async function syncCleanerLocks(env = process.env, command = null) {
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
    return await withOwnerLockLease(async () => {
      const [state, bookings, ownerEntries] = await Promise.all([getCleanerState(), getBookingRequests(), ownerLockEntries()]);
      let profiles = state.cleanerProfiles;
      if (command) {
        const profile = requireCleanerProfile(state, command.profileId, command.action==='revoke-cleaner-keypad');
        const keypadPlan = requestedCleanerPlan(profile, command, state);
        if (keypadPlan.dates.length) assertAvailableCleanerCode(keypadPlan.code, profile.id, state, bookings, ownerEntries);
        await appendCleanerRecord({ type: 'cleaner_profile', profileId: profile.id, changes: { keypadPlan } });
        profile.keypadPlan = keypadPlan;
        profiles = [profile];
      }
      const provider = createKKHomeLockProvider(env, { fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) });
      const started = Date.now(), results = [];
      // Check the least recently checked profiles first so a failed door cannot
      // starve another cleaner. Remaining profiles are picked up by the next cron.
      profiles = profiles.filter(profile => appliedCleanerPlan(profile, state).code || Object.keys(profile.cleanerLockState?.doors || {}).length)
        .sort((a, b) => String(a.cleanerLockState?.checkedAt || '').localeCompare(String(b.cleanerLockState?.checkedAt || '')));
      for (const profile of profiles) {
        if (Date.now() - started > 180000) { results.push({ status: 'queued' }); break; }
        const save = async cleanerLockState => { await appendCleanerRecord({ type: 'cleaner_profile', profileId: profile.id, changes: { cleanerLockState } }); profile.cleanerLockState = structuredClone(cleanerLockState); };
        try {
          results.push(await reconcileCleanerProfile({ profile, state, bookings, ownerEntries, provider, doors: configuredDoors(env), save }));
        } catch (error) {
          const ledger = { ...profile.cleanerLockState, status: 'needs-attention', checkedAt: new Date().toISOString() };
          await save(ledger); results.push(ledger);
        }
      }
      return command ? results[0] || { status: 'inactive' } : { status: results.some(item => item.status === 'needs-attention') ? 'needs-attention' : results.some(item => item.status === 'queued') ? 'queued' : 'synced' };
    });
  } finally {
    await del(path, { token, ifMatch: lease.etag }).catch(() => {});
  }
}
