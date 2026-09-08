import test from 'node:test';
import assert from 'node:assert/strict';
import { createLockTestHandler } from '../api/admin-lock-test.js';
import { createSession } from '../_lib/security.js';

process.env.SESSION_SECRET = 'lock-test-owner-session-secret-at-least-32-characters';
const timestamp = Date.parse('2026-09-08T04:00:00Z');
const config = { id: 'test-1', doorId: 'deck', code: '583291', startsAt: '2026-09-08T04:00:00Z', endsAt: '2026-09-08T04:30:00Z' };
const env = { KKHOME_TEST_JSON: JSON.stringify(config), LOCK_DOORS_JSON: JSON.stringify([
  { id: 'deck', name: 'Deck door', deviceId: 'deck-1' }, { id: 'basement', name: 'Basement door', deviceId: 'basement-1' },
]) };
const request = () => ({ method: 'POST', headers: { cookie: `wch_admin=${createSession({ role: 'admin' }, 60)}` }, body: { testId: 'test-1' } });
const response = () => ({ setHeader() {}, status(v) { this.statusCode = v; }, json(v) { this.body = v; } });

test('test code requires owner authentication', async () => {
  const res = response();
  await createLockTestHandler({ env, now: () => timestamp, providerFactory: () => assert.fail() })({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});
test('test uses only the server-configured door, code, and window', async () => {
  const res = response(), req = request();
  req.body.code = '111111';
  await createLockTestHandler({ env, now: () => timestamp, providerFactory: () => ({ installCode: async input => {
    assert.equal(input.door.id, 'deck'); assert.equal(input.code, config.code);
    assert.equal(input.endsAt, config.endsAt); return { status: 'installed' };
  } }) })(req, res);
  assert.equal(res.body.status, 'installed');
});
test('test cannot switch to a door outside the configured test set', async () => {
  const res = response(), req = request(); req.body.doorId = 'basement';
  await createLockTestHandler({env, now:()=>timestamp, providerFactory:()=>assert.fail('must not contact another door')})(req,res);
  assert.equal(res.statusCode,409);
});
test('expired and mismatched tests cannot contact a lock', async () => {
  for (const [now, testId] of [[timestamp + 3600000, 'test-1'], [timestamp, 'another-test']]) {
    const res = response(), req = request(); req.body.testId = testId;
    await createLockTestHandler({ env, now: () => now, providerFactory: () => assert.fail() })(req, res);
    assert.equal(res.statusCode, 409);
  }
});
test('failed test never returns a successful result or raw provider error', async () => {
  const res = response();
  await createLockTestHandler({ env, now: () => timestamp, providerFactory: () => ({ installCode: async () => { throw new Error('account-secret'); } }) })(request(), res);
  assert.equal(res.body.status, 'unconfirmed');
  assert.doesNotMatch(JSON.stringify(res.body), /account-secret/);
});
