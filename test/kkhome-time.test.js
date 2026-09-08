import test from 'node:test';
import assert from 'node:assert/strict';
import { kkhomeLocalTimestamp } from '../_lib/kkhome-time.js';
import { correctTestTime } from '../_lib/kkhome-test-time.js';

test('KK Home encodes Eastern wall time in summer and winter', () => {
  assert.equal(kkhomeLocalTimestamp('2026-09-08T03:56:00Z'), Date.parse('2026-09-07T23:56:00Z') / 1000);
  assert.equal(kkhomeLocalTimestamp('2026-12-08T04:56:00Z'), Date.parse('2026-12-07T23:56:00Z') / 1000);
  assert.equal(kkhomeLocalTimestamp('2026-09-08T04:00:00Z'), Date.parse('2026-09-08T00:00:00Z') / 1000);
});

test('each endpoint uses the offset on its date across daylight saving changes', () => {
  assert.equal(kkhomeLocalTimestamp('2026-03-07T21:00:00Z'), Date.parse('2026-03-07T16:00:00Z') / 1000);
  assert.equal(kkhomeLocalTimestamp('2026-03-09T15:00:00Z'), Date.parse('2026-03-09T11:00:00Z') / 1000);
  assert.equal(kkhomeLocalTimestamp('2026-10-31T20:00:00Z'), Date.parse('2026-10-31T16:00:00Z') / 1000);
  assert.equal(kkhomeLocalTimestamp('2026-11-02T16:00:00Z'), Date.parse('2026-11-02T11:00:00Z') / 1000);
});

test('time correction edits the existing test slot and is idempotent', async () => {
  const config = { code: '388387', startsAt: '2026-09-08T03:11:00Z', endsAt: '2026-09-08T03:56:00Z' };
  let records = [{ num: 6, pwdType: 0, type: 1, nickName: 'Test', startTime: Date.parse(config.startsAt) / 1000, endTime: Date.parse(config.endsAt) / 1000 }];
  let updates = 0, saves = 0;
  const client = { listKeys: async () => ({ pwdList: records }), updateKey: async payload => {
    updates++; assert.equal(payload.keyNum, 6); assert.equal(payload.key, config.code);
  }, saveKeyMetadata: async payload => {
    saves++; assert.equal(updates, 1); assert.equal(payload.pwdList.length, 1);
    assert.equal(payload.pwdList[0].num, 6); assert.equal(payload.pwdList[0].nickName, 'Test');
    records = payload.pwdList;
  } };
  const result = await correctTestTime(client, { deviceId: 'deck' }, config);
  assert.equal(result.status, 'schedule_saved');
  assert.equal(result.physicalTimingVerified, false);
  await correctTestTime(client, { deviceId: 'deck' }, config);
  assert.equal(updates, 1);
  assert.equal(saves, 1);
});

test('time correction refuses to edit an unrelated code', async () => {
  await assert.rejects(correctTestTime({ listKeys: async () => ({ pwdList: [{ num: 6, startTime: 1, endTime: 2 }] }),
    updateKey: async () => assert.fail('must not edit') }, { deviceId: 'deck' }, {
    startsAt: '2026-09-08T03:11:00Z', endsAt: '2026-09-08T03:56:00Z', code: '388387',
  }), /uniquely identify/);
});
