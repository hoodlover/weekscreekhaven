import crypto from 'node:crypto';
import { hashPasscode, normalizePasscode, verifyPasscode } from './security.js';

export const LEGACY_CLEANER_ID = 'legacy-cleaner';
const PROFILE_FIELDS = ['cleanerName', 'cleanerEmail', 'cleanerPhone', 'notes', 'standardPayCents', 'passcodeHash', 'passcodeSalt', 'cleanerAuthVersion'];
const ACCESS_FIELDS = ['doorCode', 'closetCode', 'accessNotes', 'doorCodeUpdatedAt', 'cleanerAccessDates', 'cleanerAccessExcludedDates', 'cleanerLockState'];
const blankProfile = id => ({ id, cleanerName: 'Cabin Care Team', cleanerEmail: '', cleanerPhone: '', notes: '', standardPayCents: 17500, passcodeHash: '', passcodeSalt: '', cleanerAuthVersion: '', enabled: true });
const text = (value, max) => String(value ?? '').trim().slice(0, max);
function invalid(message, status = 400) { throw Object.assign(new Error(message), { status }); }

// Replay the existing settings as the original profile. No migration writes are needed.
export function buildCleanerProfiles(records) {
  const profiles = new Map([[LEGACY_CLEANER_ID, blankProfile(LEGACY_CLEANER_ID)]]);
  let primaryCleanerId = LEGACY_CLEANER_ID;
  for (const record of records) {
    if (record.type === 'cleaner_profile') {
      const current = profiles.get(record.profileId) || blankProfile(record.profileId);
      profiles.set(record.profileId, { ...current, ...record.changes, id: record.profileId, updatedAt: record.createdAt });
    }
    if (record.type === 'settings') {
      const changes = record.changes || {};
      if (changes.primaryCleanerId && profiles.has(changes.primaryCleanerId)) primaryCleanerId = changes.primaryCleanerId;
      const profile = profiles.get(primaryCleanerId);
      for (const key of PROFILE_FIELDS) if (Object.hasOwn(changes, key)) profile[key] = changes[key];
      // Older shared lock settings always belong to the original cleaner, even
      // if a different contact was subsequently made primary.
      const original = profiles.get(LEGACY_CLEANER_ID);
      for (const key of ACCESS_FIELDS) if (Object.hasOwn(changes, key)) original[key] = changes[key];
    }
  }
  const primary = profiles.get(primaryCleanerId);
  return {
    cleanerProfiles: [...profiles.values()],
    settings: { primaryCleanerId, ...Object.fromEntries(PROFILE_FIELDS.map(key => [key, primary[key]])) },
  };
}

export function requireCleanerProfile(state, id) {
  const profile = state.cleanerProfiles.find(item => item.id === id);
  if (!profile) invalid('Choose a cleaner profile and try again.', 404);
  return profile;
}

export function cleanerReservedCodes(profile) {
  return [profile.doorCode, profile.keypadPlan?.code, profile.cleanerLockState?.code,
    ...Object.values(profile.cleanerLockState?.doors || {}).map(door => door.code)].filter(Boolean).map(String);
}

export function publicCleanerProfiles(state) {
  return state.cleanerProfiles.map(profile => ({
    id: profile.id, cleanerName: profile.cleanerName, cleanerEmail: profile.cleanerEmail,
    cleanerPhone: profile.cleanerPhone, notes: profile.notes, standardPayCents: profile.standardPayCents,
    enabled: profile.enabled, hasAccess: Boolean(profile.passcodeHash && profile.passcodeSalt),
    isPrimary: profile.id === state.settings.primaryCleanerId,
  }));
}

export function cleanerForSession(session, state) {
  if (!session) return null;
  const profile = state.cleanerProfiles?.find(item => item.id === (session.cleanerId || LEGACY_CLEANER_ID));
  return profile?.enabled && profile.passcodeHash && profile.passcodeSalt && session.authVersion === profile.cleanerAuthVersion ? profile : null;
}

export function cleanerForPasscode(passcode, state) {
  if (typeof passcode !== 'string' || !passcode.trim() || passcode.length > 80) return null;
  return state.cleanerProfiles.find(profile => profile.enabled && profile.passcodeHash && profile.passcodeSalt && verifyPasscode(passcode, profile.passcodeSalt, profile.passcodeHash)) || null;
}

function accessChanges(passcode, profileId, state) {
  if (typeof passcode !== 'string' || normalizePasscode(passcode).length < 6 || passcode.length > 80) invalid('Use 6–80 characters (excluding spaces) for the Cleaner Hub password.');
  if (state.cleanerProfiles.some(profile => profile.id !== profileId && profile.passcodeHash && profile.passcodeSalt && verifyPasscode(passcode, profile.passcodeSalt, profile.passcodeHash))) invalid('Choose a different Hub password. Another cleaner profile already uses this one.');
  const hashed = hashPasscode(passcode);
  return { passcodeHash: hashed.hash, passcodeSalt: hashed.salt, cleanerAuthVersion: crypto.randomUUID() };
}

export function cleanerProfileRecord(action, body, state) {
  const profileId = text(body.profileId, 80);
  const current = state.cleanerProfiles.find(profile => profile.id === profileId);
  if (action === 'save-cleaner-profile') {
    if (profileId && !current) invalid('That cleaner profile no longer exists. Refresh and try again.', 404);
    if (!current && state.cleanerProfiles.length >= 50) invalid('You can save up to 50 cleaner profiles.');
    const cleanerName = text(body.cleanerName, 80), cleanerEmail = text(body.cleanerEmail, 160).toLowerCase();
    if (!cleanerName) invalid('Enter the cleaner’s name.');
    if (cleanerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanerEmail)) invalid('Enter a valid cleaner email address.');
    if (cleanerEmail && state.cleanerProfiles.some(profile => profile.id !== profileId && profile.cleanerEmail.toLowerCase() === cleanerEmail)) invalid('A cleaner profile already uses that email address. Edit that profile instead.');
    const standardPayCents = Math.round(Number(body.standardPay) * 100);
    if (body.standardPay === '' || body.standardPay == null || !Number.isInteger(standardPayCents) || standardPayCents < 0 || standardPayCents > 100000) invalid('Enter standard cleaning pay between $0 and $1,000.');
    const id = current?.id || crypto.randomUUID();
    const changes = { cleanerName, cleanerEmail, cleanerPhone: text(body.cleanerPhone, 40), notes: text(body.notes, 1000), standardPayCents };
    if (body.passcode) Object.assign(changes, accessChanges(body.passcode, id, state));
    return { type: 'cleaner_profile', profileId: id, changes };
  }
  if (!current) invalid('Choose an existing cleaner profile.', 404);
  if (action === 'primary-cleaner') {
    if (!current.enabled) invalid('Enable this cleaner profile before making it primary.');
    return { type: 'settings', changes: { primaryCleanerId: current.id } };
  }
  if (action === 'cleaner-profile-access') {
    if (typeof body.enabled !== 'boolean') invalid('Choose whether this profile is enabled.');
    if (!body.enabled && current.id === state.settings.primaryCleanerId) invalid('Choose another primary cleaner before disabling this profile.');
    return { type: 'cleaner_profile', profileId, changes: { enabled: body.enabled, cleanerAuthVersion: crypto.randomUUID() } };
  }
  if (action === 'setup-access') return { type: 'cleaner_profile', profileId, changes: accessChanges(body.passcode, profileId, state) };
  invalid('Unknown cleaner profile update.');
}
