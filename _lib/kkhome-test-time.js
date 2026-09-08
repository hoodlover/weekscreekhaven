import { kkhomeLocalTimestamp } from './kkhome-time.js';

function keys(payload) {
  if (Array.isArray(payload)) return payload;
  return ['pwdList', 'timePwdList', 'offlinePwdList'].flatMap(key => Array.isArray(payload?.[key]) ? payload[key] : []);
}

export async function correctTestTime(client, door, config, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  const startTime = kkhomeLocalTimestamp(config.startsAt), endTime = kkhomeLocalTimestamp(config.endsAt);
  const oldStart = Date.parse(config.startsAt) / 1000, oldEnd = Date.parse(config.endsAt) / 1000;
  const matches = keys(await client.listKeys(door.deviceId)).filter(key =>
    (Number(key.startTime) === oldStart && Number(key.endTime) === oldEnd)
    || (Number(key.startTime) === startTime && Number(key.endTime) === endTime));
  if (matches.length !== 1 || matches[0].num === undefined || !Number.isInteger(Number(matches[0].num))) {
    throw new Error('Cannot uniquely identify the existing test code.');
  }
  const existing = matches[0], keyNum = Number(existing.num);
  if (existing.pwdValue !== undefined && String(existing.pwdValue) !== config.code) throw new Error('Test PIN does not match.');
  if (Number(existing.startTime) !== startTime || Number(existing.endTime) !== endTime) {
    await client.updateKey({ esn: door.deviceId, keyNum, keyType: 0, key: config.code, attribute: 1, week: 0, startTime, endTime });
    // The app separately saves its edited code-list entry after sending update-pwd.
    // This confirms cloud metadata only; physical acknowledgement remains separate.
    const metadata = Object.fromEntries(['createTime', 'nickName', 'pwdType', 'type', 'items']
      .filter(key => existing[key] !== undefined).map(key => [key, existing[key]]));
    await client.saveKeyMetadata({ esn: door.deviceId,
      pwdList: [{ ...metadata, num: keyNum, pwdValue: config.code, startTime, endTime }] });
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = keys(await client.listKeys(door.deviceId)).find(key => Number(key.num) === keyNum
      && Number(key.startTime) === startTime && Number(key.endTime) === endTime);
    if (saved) return { status: 'schedule_saved', keyNum, startTime, endTime, timezone: 'America/New_York', physicalTimingVerified: false };
    if (attempt < 3) await wait(1000);
  }
  throw new Error('KK Home did not verify the corrected time.');
}
