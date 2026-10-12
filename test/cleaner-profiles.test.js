import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildCleanerProfiles, cleanerForPasscode, cleanerForSession, cleanerProfileRecord, publicCleanerProfiles, LEGACY_CLEANER_ID } from '../_lib/cleaner-profiles.js';
import { hashPasscode } from '../_lib/security.js';

const original = hashPasscode('original-test-code');
const legacy = { type: 'settings', changes: { cleanerName: 'Original Cleaner', cleanerEmail: 'original@example.test', standardPayCents: 17500, passcodeHash: original.hash, passcodeSalt: original.salt, cleanerAuthVersion: 'original-version', doorCode: '739426', closetCode: '412' } };
const newDetails = { cleanerName: 'Backup Cleaner', cleanerEmail: 'backup@example.test', cleanerPhone: '555-0100', standardPay: '190.50', notes: 'Available weekends', passcode: 'backup-test-code' };
const add = records => cleanerProfileRecord('save-cleaner-profile', newDetails, buildCleanerProfiles(records));

test('existing settings become the original profile and its sessions and password still work', () => {
  const state = buildCleanerProfiles([legacy]);
  assert.equal(state.cleanerProfiles.length, 1);
  assert.equal(state.settings.primaryCleanerId, LEGACY_CLEANER_ID);
  assert.equal(cleanerForSession({ authVersion: 'original-version' }, state).cleanerName, 'Original Cleaner');
  assert.equal(cleanerForPasscode('original-test-code', state).id, LEGACY_CLEANER_ID);
  assert.equal(cleanerForSession({ authVersion: '' }, buildCleanerProfiles([])), null);
});

test('adding a profile preserves the primary cleaner and gives the new cleaner independent access', () => {
  const record = add([legacy]), state = buildCleanerProfiles([legacy, record]);
  assert.equal(state.cleanerProfiles.length, 2);
  assert.equal(state.settings.cleanerEmail, legacy.changes.cleanerEmail);
  assert.equal(state.settings.standardPayCents, 17500);
  assert.equal(record.changes.passcode, undefined);
  const backup = cleanerForPasscode('backup-test-code', state);
  assert.equal(backup.id, record.profileId);
  assert.equal(backup.standardPayCents, 19050);
  assert.equal(cleanerForSession({ cleanerId: backup.id, authVersion: backup.cleanerAuthVersion }, state).id, backup.id);
  assert.equal(cleanerForSession({ cleanerId: backup.id, authVersion: 'original-version' }, state), null);
});

test('contact-only profiles cannot sign in, and public profiles never include credentials', () => {
  const record = cleanerProfileRecord('save-cleaner-profile', { ...newDetails, passcode: '' }, buildCleanerProfiles([legacy]));
  const state = buildCleanerProfiles([legacy, record]), profiles = publicCleanerProfiles(state);
  assert.equal(profiles[1].hasAccess, false);
  assert.equal(cleanerForSession({ cleanerId: record.profileId, authVersion: '' }, state), null);
  assert.ok(!JSON.stringify(profiles).includes(original.hash));
  for (const profile of profiles) for (const field of ['passcodeHash', 'passcodeSalt', 'cleanerAuthVersion']) assert.ok(!Object.hasOwn(profile, field));
});

test('editing a profile with a blank password preserves its password; resetting revokes only its sessions', () => {
  const added = add([legacy]), records = [legacy, added], state = buildCleanerProfiles(records);
  const backup = state.cleanerProfiles[1], session = { cleanerId: backup.id, authVersion: backup.cleanerAuthVersion };
  const edit = cleanerProfileRecord('save-cleaner-profile', { ...newDetails, profileId: backup.id, cleanerName: 'Updated Cleaner', passcode: '' }, state);
  const edited = buildCleanerProfiles([...records, edit]);
  assert.equal(cleanerForSession(session, edited).cleanerName, 'Updated Cleaner');
  const reset = cleanerProfileRecord('setup-access', { profileId: backup.id, passcode: 'new-backup-test-code' }, edited);
  const changed = buildCleanerProfiles([...records, edit, reset]);
  assert.equal(cleanerForSession(session, changed), null);
  assert.equal(cleanerForPasscode('backup-test-code', changed), null);
  assert.equal(cleanerForPasscode('new-backup-test-code', changed).id, backup.id);
  assert.ok(cleanerForSession({ authVersion: 'original-version' }, changed));
});

test('changing the primary updates defaults but leaves both profiles and existing sessions intact', () => {
  const added = add([legacy]), records = [legacy, added], state = buildCleanerProfiles(records);
  const primary = cleanerProfileRecord('primary-cleaner', { profileId: added.profileId }, state);
  assert.deepEqual(Object.keys(primary.changes), ['primaryCleanerId']);
  const changed = buildCleanerProfiles([...records, primary, { type: 'settings', changes: { cleanerName: 'Updated Primary' } }]);
  assert.equal(changed.settings.cleanerName, 'Updated Primary');
  assert.equal(changed.settings.cleanerEmail, newDetails.cleanerEmail);
  assert.equal(changed.settings.standardPayCents, 19050);
  assert.equal(changed.cleanerProfiles[0].cleanerName, 'Original Cleaner');
  assert.equal(cleanerForSession({ authVersion: 'original-version' }, changed).id, LEGACY_CLEANER_ID);
});

test('disabling a profile revokes its sessions and password access; re-enabling does not revive old sessions', () => {
  const added = add([legacy]), records = [legacy, added], state = buildCleanerProfiles(records);
  const session = { cleanerId: added.profileId, authVersion: state.cleanerProfiles[1].cleanerAuthVersion };
  const disabled = cleanerProfileRecord('cleaner-profile-access', { profileId: added.profileId, enabled: false }, state);
  records.push(disabled);const off = buildCleanerProfiles(records);
  assert.equal(cleanerForSession(session, off), null);
  assert.equal(cleanerForPasscode(newDetails.passcode, off), null);
  assert.throws(() => cleanerProfileRecord('primary-cleaner', { profileId: added.profileId }, off), /Enable/);
  records.push(cleanerProfileRecord('cleaner-profile-access', { profileId: added.profileId, enabled: true }, off));
  const restored = buildCleanerProfiles(records);
  assert.equal(cleanerForSession(session, restored), null);
  assert.ok(cleanerForPasscode(newDetails.passcode, restored));
  assert.throws(() => cleanerProfileRecord('cleaner-profile-access', { profileId: LEGACY_CLEANER_ID, enabled: false }, restored), /another primary/);
});

test('profiles validate identity, rate, email, password uniqueness, and existing IDs', () => {
  const state = buildCleanerProfiles([legacy]);
  for (const patch of [{ cleanerName: '' }, { cleanerEmail: 'not-an-email' }, { cleanerEmail: 'ORIGINAL@example.test' }, { standardPay: '' }, { standardPay: -1 }, { standardPay: 1001 }, { standardPay: 'bad' }, { passcode: 'a a a' }, { passcode: ' ORIGINAL-test-CODE ' }, { profileId: 'missing' }]) {
    assert.throws(() => cleanerProfileRecord('save-cleaner-profile', { ...newDetails, ...patch }, state), error => [400, 404].includes(error.status));
  }
  const free = cleanerProfileRecord('save-cleaner-profile', { ...newDetails, standardPay: 0 }, state);
  assert.equal(free.changes.standardPayCents, 0);
});

test('the cleaner page JavaScript parses', () => {
  const html = readFileSync(new URL('../cleaner.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const checked = spawnSync(process.execPath, ['--check', '--input-type=commonjs'], { input: script, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
});
