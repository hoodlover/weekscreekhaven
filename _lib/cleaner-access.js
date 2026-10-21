import { cleanerOwnsCleaning } from './cleaner-assignments.js';
import crypto from 'node:crypto';
import { LEGACY_CLEANER_ID, cleanerReservedCodes } from './cleaner-profiles.js';

// The original automatic schedule is retained until the owner first edits it.
// Thereafter only an explicitly applied snapshot is sent to the locks.
export function profileAccessDates(profile, state) {
  const custom = profile.id === LEGACY_CLEANER_ID && !profile.keypadPlan
    ? (state.assignments || []).filter(item => item.customSession && cleanerOwnsCleaning(state,item.bookingId,profile.id) && !['cancelled', 'declined'].includes(item.status)).map(item => item.cleanDate) : [];
  return [...new Set([...(profile.cleanerAccessDates || []), ...custom])]
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && !(profile.cleanerAccessExcludedDates || []).includes(date)).sort();
}

export function appliedCleanerPlan(profile, state) {
  return profile.keypadPlan || { code: profile.id === LEGACY_CLEANER_ID ? profile.doorCode || '' : '',
    dates: profile.id === LEGACY_CLEANER_ID ? profileAccessDates(profile, state) : [] };
}

export function freezeCleanerPlan(profile, state) {
  return profile.keypadPlan ? {} : { keypadPlan: appliedCleanerPlan(profile, state), cleanerAccessDates: profileAccessDates(profile, state), cleanerAccessExcludedDates: [] };
}

export function cleanerAccessRevision(profile, state) {
  return crypto.createHash('sha256').update(JSON.stringify([profile.enabled, profile.doorCode || '', profileAccessDates(profile, state)])).digest('hex');
}

export function assertAvailableCleanerCode(code, profileId, state, bookings = [], ownerEntries = []) {
  if (!code) return;
  const others = state.cleanerProfiles.filter(profile => profile.id !== profileId).flatMap(cleanerReservedCodes);
  const reserved = [...others, ...bookings.flatMap(item => [item.doorCode, ...(item.retiredDoorCodes || [])]), ...ownerEntries.map(item => item.code)].filter(Boolean).map(String);
  if (reserved.includes(code)) throw Object.assign(new Error('Choose a separate cabin PIN. This PIN is reserved for another cleaner, guest, or personal access code.'), { status: 409 });
}

export function savedCleanerAccess(profile, body, state) {
  const doorCode = String(body.doorCode || '').trim();
  const closetCode = String(body.closetCode || '').trim();
  if (doorCode && !/^\d{4,10}$/.test(doorCode)) throw Object.assign(new Error('Use a 4–10 digit cabin door PIN.'), { status: 400 });
  if (closetCode && !/^\d{3,10}$/.test(closetCode)) throw Object.assign(new Error('Use a 3–10 digit closet-lock code.'), { status: 400 });
  assertAvailableCleanerCode(doorCode, profile.id, state);
  return { ...freezeCleanerPlan(profile, state), doorCode, closetCode, accessNotes: String(body.accessNotes || '').trim().slice(0, 1500), doorCodeUpdatedAt: new Date().toISOString() };
}

export function requestedCleanerPlan(profile, body, state) {
  if (body.action === 'revoke-cleaner-keypad') return { code: appliedCleanerPlan(profile, state).code, dates: [], requestedAt: new Date().toISOString() };
  if (!profile.enabled) throw Object.assign(new Error('Enable this cleaner profile before applying door access.'), { status: 400 });
  if (body.revision !== cleanerAccessRevision(profile, state)) throw Object.assign(new Error('The saved PIN or dates changed. Refresh and review them before applying.'), { status: 409 });
  if (!/^\d{4,10}$/.test(profile.doorCode || '')) throw Object.assign(new Error('Save a valid cabin door PIN first.'), { status: 400 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dates = profileAccessDates(profile, state).filter(date => date >= today);
  if (!dates.length) throw Object.assign(new Error('Add at least one upcoming access day before applying to the doors.'), { status: 400 });
  return { code: profile.doorCode, dates, requestedAt: new Date().toISOString() };
}
