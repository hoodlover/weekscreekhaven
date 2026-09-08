import test from 'node:test';
import assert from 'node:assert/strict';
import { createLockStatusHandler } from '../api/admin-lock-status.js';
import { createSession } from '../_lib/security.js';

process.env.SESSION_SECRET = 'lock-status-test-secret-with-at-least-32-characters';
const env = { KKHOME_EMAIL: 'owner@example.com', KKHOME_PASSWORD: 'private-password', KKHOME_APP_PRIVATE_KEY: 'private-key',
  LOCK_DOORS_JSON: JSON.stringify([{ id: 'front', name: 'Front door', deviceId: 'front-123' }]) };
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; }, json(v) { this.body = v; } };
}
function request() { return { method: 'POST', headers: { cookie: `wch_admin=${createSession({ role: 'admin' }, 60)}` } }; }

test('connection check rejects unauthenticated requests without contacting KK Home', async () => {
  const res = response();
  await createLockStatusHandler({ env, clientFactory() { assert.fail('must not contact provider'); } })({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('connection check only returns configured door matches and no raw device details', async () => {
  const res = response();
  await createLockStatusHandler({ env, clientFactory: () => ({ listDevices: async () => ({ data: [{ esn: 'front-123', token: 'secret-token', pwd: '123456' }] }) }) })(request(), res);
  assert.equal(res.body.allDoorsFound, true);
  assert.deepEqual(res.body.doors, [{ id: 'front', name: 'Front door', found: true, matches: 1 }]);
  assert.doesNotMatch(JSON.stringify(res.body), /secret-token|123456|private-password/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('connection check hides provider errors that might contain credentials', async () => {
  const res = response();
  await createLockStatusHandler({ env, clientFactory: () => ({ listDevices: async () => { throw new Error('private-password'); } }) })(request(), res);
  assert.equal(res.body.connected, false);
  assert.doesNotMatch(JSON.stringify(res.body), /private-password/);
});

test('connection check blocks requests that could change a lock', async () => {
  const res = response();
  await createLockStatusHandler({ env, fetchImpl: () => assert.fail('must not send request'), clientFactory: ({ fetchImpl }) => ({
    listDevices: () => fetchImpl('https://api.kksecurityhome.com/v3/device/insert-pwd', {}),
  }) })(request(), res);
  assert.equal(res.body.connected, false);
});
