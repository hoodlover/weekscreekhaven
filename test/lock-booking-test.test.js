import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingLockTestHandler } from '../api/admin-lock-booking-test.js';
import { createSession } from '../_lib/security.js';

process.env.SESSION_SECRET = 'booking-lock-test-session-secret-at-least-32-characters';
const timestamp = Date.parse('2026-09-08T04:00:00Z');
const config = { id: 'fixture', code: '583291', arrival: '2026-09-08', departure: '2026-09-09', expiresAt: '2026-09-08T04:30:00Z' };
const env = { LOCK_PROVIDER: 'kkhome', KKHOME_LIVE_ENABLED: 'true', KKHOME_BOOKING_TEST_JSON: JSON.stringify(config) };
const request = () => ({ method: 'POST', headers: { cookie: `wch_admin=${createSession({ role: 'admin' }, 60)}` }, body: { testId: 'fixture', action: 'install' } });
const response = () => ({ setHeader() {}, status(value) { this.statusCode = value; }, json(value) { this.body = value; } });

test('booking lock test requires owner authentication and an unexpired server fixture', async () => {
  for (const mode of ['unauthenticated', 'expired', 'missing', 'unknown-action']) {
    const req = request(), res = response();
    if (mode === 'unauthenticated') req.headers = {};
    if (mode === 'unknown-action') req.body.action = 'anything';
    await createBookingLockTestHandler({ env: mode === 'missing' ? {} : env,
      now: () => timestamp + (mode === 'expired' ? 3600000 : 0), install: () => assert.fail('must not contact locks') })(req, res);
    assert.equal(res.statusCode, mode === 'unauthenticated' ? 401 : 409);
  }
});

test('booking fixture ignores caller booking details and partial success cannot record completion', async () => {
  const req = request(), res = response();
  Object.assign(req.body, { bookingId: 'real-booking', code: '111111', arrival: '2026-01-01' });
  await createBookingLockTestHandler({ env, now: () => timestamp, install: async booking => {
    assert.equal(booking.id, 'lock-test-fixture');
    assert.equal(booking.doorCode, config.code);
    assert.equal(booking.dateChoices[0].arrival, config.arrival);
    return { status: 'partial', attemptedAt: config.expiresAt, doors: [{ doorId: 'deck', status: 'failed', message: 'secret provider detail' }] };
  } })(req, res);
  assert.equal(res.body.completionRecorded, false);
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});

test('cleanup remains available after fixture expiry and carries exact saved references', async () => {
  const req = request(), res = response(); req.body.action = 'remove';
  req.body.references = [{ doorId: 'deck', providerCodeId: 'saved-reference' }];
  await createBookingLockTestHandler({ env, now: () => timestamp + 3600000, remove: async booking => {
    assert.deepEqual(booking.doorCodeProvisioning.doors, req.body.references);
    return { status: 'removed', attemptedAt: config.expiresAt, doors: [] };
  } })(req, res);
  assert.equal(res.body.completionRecorded, true);
  assert.equal(res.body.physicalTimingVerified, false);
});
