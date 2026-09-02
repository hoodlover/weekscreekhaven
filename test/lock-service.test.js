import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingAccessWindow, configuredDoors, manualConfirmation, provisionDoorCode,
  provisioningChanges, removeDoorCode, removalChanges,
} from '../_lib/lock-service.js';
import { doorCodeTask } from '../_lib/door-code.js';

const booking = {
  id:'booking-1', name:'Abby Example', status:'booked', doorCode:'482963',
  doorCodeGeneratedAt:'2026-09-02T12:00:00.000Z',
  dateChoices:[{ arrival:'2026-11-06', departure:'2026-11-09' }], approvedChoice:0,
};

test('uses the three cabin doors by default', () => {
  assert.deepEqual(configuredDoors({}), [
    { id:'front', name:'Front door' }, { id:'side', name:'Side door' }, { id:'back', name:'Back door' },
  ]);
});

test('creates an Eastern access window with a checkout grace period', () => {
  assert.deepEqual(bookingAccessWindow(booking, {}), {
    startsAt:'2026-11-06T15:45:00-05:00', endsAt:'2026-11-09T11:15:00-05:00', timezone:'America/New_York',
  });
});

test('uses the daylight-saving offset for summer stays', () => {
  const result = bookingAccessWindow({
    ...booking,
    dateChoices:[{ arrival:'2026-09-06', departure:'2026-09-09' }],
  }, {});
  assert.equal(result.startsAt, '2026-09-06T15:45:00-04:00');
});

test('does not impose an early checkout time on a flexible stay', () => {
  const result = bookingAccessWindow({
    ...booking,
    friendsAndFamilyDiscount:{ chargeCleaning:false },
  }, {});
  assert.equal(result.endsAt, '2026-11-09T23:45:00-05:00');
});

test('keeps the current manual workflow as the default', async () => {
  const result = await provisionDoorCode(booking, { env:{}, now:'2026-09-02T13:00:00.000Z' });
  assert.equal(result.provider, 'manual');
  assert.equal(result.status, 'manual');
  assert.equal(result.doors.length, 3);
  assert.equal(provisioningChanges(result).doorCodeInstalledAt, null);
});

test('simulator installs and removes a code on every door', async () => {
  const env = { LOCK_PROVIDER:'simulated' };
  const installed = await provisionDoorCode(booking, { env, now:'2026-09-02T13:00:00.000Z' });
  assert.equal(installed.status, 'installed');
  assert.ok(installed.doors.every((door) => door.status === 'installed'));
  const changes = provisioningChanges(installed);
  assert.equal(changes.doorCodeInstalledAt, '2026-09-02T13:00:00.000Z');

  const removed = await removeDoorCode({ ...booking, ...changes }, { env, now:'2026-11-09T17:00:00.000Z' });
  assert.equal(removed.status, 'removed');
  assert.equal(removalChanges(removed).doorCodeRemovedAt, '2026-11-09T17:00:00.000Z');
});

test('does not report overall success when one door fails', async () => {
  const result = await provisionDoorCode(booking, {
    env:{ LOCK_PROVIDER:'simulated', LOCK_SIMULATOR_FAIL_DOORS:'side' }, now:'2026-09-02T13:00:00.000Z',
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.doors.find((door) => door.doorId === 'side').status, 'failed');
  assert.equal(provisioningChanges(result).doorCodeInstalledAt, null);
});

test('never allows the simulator to confirm physical locks in production', async () => {
  const result = await provisionDoorCode(booking, {
    env:{ LOCK_PROVIDER:'simulated', VERCEL_ENV:'production' }, now:'2026-09-02T13:00:00.000Z',
  });
  assert.equal(result.provider, 'simulated-blocked');
  assert.equal(result.status, 'failed');
  assert.ok(result.doors.every((door) => door.status === 'failed'));
  assert.equal(provisioningChanges(result).doorCodeInstalledAt, null);
});

test('an invalid provider fails closed instead of releasing the code', async () => {
  const result = await provisionDoorCode(booking, {
    env:{ LOCK_PROVIDER:'unknown-provider' }, now:'2026-09-02T13:00:00.000Z',
  });
  assert.equal(result.status, 'failed');
  assert.equal(provisioningChanges(result).doorCodeInstalledAt, null);
});

test('manual confirmation records every door', () => {
  const result = manualConfirmation(booking, 'install', '2026-09-02T14:00:00.000Z');
  assert.equal(result.status, 'installed');
  assert.ok(result.doors.every((door) => door.status === 'installed'));
});

test('a cancelled booking keeps a removal task until the code is confirmed removed', () => {
  const task = doorCodeTask({ ...booking, status:'cancelled', doorCodeInstalledAt:'2026-09-02T14:00:00.000Z' }, '2026-09-02');
  assert.equal(task.type, 'remove');
  assert.equal(task.label, 'Remove cancelled guest door code');
});
