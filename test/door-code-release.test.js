import test from 'node:test';
import assert from 'node:assert/strict';
import { doorCodeAvailable, doorCodeEmailDue, doorCodeReleaseDate } from '../_lib/door-code-release.js';

const booking = { status: 'booked', doorCode: '582739', doorCodeInstalledAt: '2026-09-08T05:00:00Z',
  dateChoices: [{ arrival: '2026-10-23', departure: '2026-10-25' }] };

test('Abby code email and guest display release at 9 AM Eastern October 22', () => {
  for (const [timestamp, expected] of [['2026-10-22T12:59:59Z', false], ['2026-10-22T13:00:00Z', true], ['2026-10-23T04:00:00Z', true]]) {
    assert.equal(doorCodeAvailable(booking, new Date(timestamp)), expected);
    assert.equal(doorCodeEmailDue(booking, new Date(timestamp)), expected);
  }
});

test('release follows Eastern daylight saving rather than a fixed UTC hour', () => {
  for (const [arrival, departure, before, at] of [
    ['2026-11-02', '2026-11-04', '2026-11-01T13:59:59Z', '2026-11-01T14:00:00Z'],
    ['2027-03-15', '2027-03-17', '2027-03-14T12:59:59Z', '2027-03-14T13:00:00Z'],
  ]) {
    const b = { ...booking, dateChoices: [{ arrival, departure }] };
    assert.equal(doorCodeEmailDue(b, new Date(before)), false);
    assert.equal(doorCodeEmailDue(b, new Date(at)), true);
  }
});

test('unsent code catches up during stay but sent, failed, removed, and past-stay codes do not send', () => {
  const now = new Date('2026-10-24T16:00:00Z');
  assert.equal(doorCodeEmailDue(booking, now), true);
  for (const changes of [{ doorCodeGuestSentAt: 'sent' }, { doorCodeInstalledAt: null }, { doorCodeRemovedAt: 'removed' }, { status: 'cancelled' }, { status: 'completed' }, { doorCode: '' }]) {
    assert.equal(doorCodeEmailDue({ ...booking, ...changes }, now), false);
  }
  assert.equal(doorCodeEmailDue(booking, new Date('2026-10-26T04:00:00Z')), false);
});

test('release date handles year boundaries and rejects invalid calendar dates', () => {
  assert.equal(doorCodeReleaseDate('2027-01-01'), '2026-12-31');
  assert.equal(doorCodeReleaseDate('2026-02-30'), '');
});
