import { createKKHomeClient } from '../kkhome-client.js';
import { kkhomeLocalTimestamp } from '../kkhome-time.js';
import { createHash } from 'node:crypto';

const first = (value, ...keys) => keys.map((key) => value?.[key]).find((item) => item !== undefined && item !== null && item !== '');

function deviceArray(payload) {
  if (Array.isArray(payload)) return payload.flatMap((device) => {
    if (!device || typeof device !== 'object') return [];
    const parentEsn = first(device, 'wifiSN','esn','deviceSn','sn');
    const children = Array.isArray(device.subDevices)
      ? device.subDevices.map((child) => ({ ...child, __parentEsn:parentEsn })) : [];
    return [device, ...deviceArray(children)];
  });
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['records','rows','list','devices','deviceList','items','data']) {
    if (Array.isArray(payload[key])) return deviceArray(payload[key]);
  }
  if (payload.page) return deviceArray(payload.page);
  return [payload];
}

function resolveDevice(payload, deviceId) {
  const matches = deviceArray(payload).filter((device) => [
    '_id','deviceId','id','did','deviceNo','wifiSN','esn','deviceSn','sn',
  ].some((key) => String(device?.[key] ?? '') === deviceId));
  if (matches.length !== 1) throw new Error(matches.length ? `KK Home device ID "${deviceId}" is not unique.` : `KK Home device ID "${deviceId}" was not found.`);
  const raw = matches[0];
  const lockEsn = String(first(raw, 'wifiSN','esn','deviceSn','sn') || '');
  if (!lockEsn) throw new Error(`KK Home device "${deviceId}" has no ESN.`);
  const parentEsn = String(first(raw, 'masterEsn','masterSn','gatewayEsn','parentEsn','__parentEsn') || '');
  return {
    esn:parentEsn || lockEsn,
    partSn:parentEsn ? lockEsn : '',
    partMac:parentEsn ? String(first(raw, 'mac','bleMac') || '') : '',
    partMode:parentEsn ? String(first(raw, 'deviceType','model') || '') : '',
  };
}

function keysFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.pwdList) || Array.isArray(payload?.timePwdList)) return [...(payload.pwdList || []), ...(payload.timePwdList || [])];
  for (const key of ['list','records','items']) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function matchingKey(keys, code, startTime, endTime) {
  return keys.find((item) => String(first(item, 'key','pwdValue') || '') === code
    && Number(item.startTime) === startTime && Number(item.endTime) === endTime);
}

const codeHash = code => createHash('sha256').update(String(code)).digest('hex');
const keyNumber = item => Number(first(item, 'num', 'keyNum'));
const keyCode = item => String(first(item, 'key', 'pwdValue') || '');
const sameWindow = (item, start, end) => Number(item.startTime) === start && Number(item.endTime) === end;

function encodeReference(device, keyNum, code) {
  return Buffer.from(JSON.stringify({ v:2, ...device, keyNum:Number(keyNum), codeHash:codeHash(code) })).toString('base64url');
}

function decodeReference(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (parsed?.v === 2 && Number.isInteger(parsed.keyNum) && parsed.codeHash) return parsed;
  } catch {}
  throw new Error('The saved KK Home code reference is missing or invalid; removal was not attempted.');
}

export function createKKHomeLockProvider(env=process.env, options={}) {
  const client = options.client || createKKHomeClient({ email:env.KKHOME_EMAIL, password:env.KKHOME_PASSWORD,
    appPrivateKey:env.KKHOME_APP_PRIVATE_KEY, fetchImpl:options.fetchImpl });
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  async function verify(device, predicate) {
    for (let attempt=0; attempt<4; attempt+=1) {
      const keys = keysFrom(await client.listKeys(device.partSn || device.esn));
      const result = predicate(keys);
      if (result) return result;
      if (attempt<3) await wait(750);
    }
    return null;
  }

  async function selectedDevice(door) {
    if (!door.deviceId) throw new Error(`${door.name} needs an exact KK Home deviceId in LOCK_DOORS_JSON.`);
    return resolveDevice(await client.listDevices(), door.deviceId);
  }

  return {
    id:'kkhome',
    async findCode({ door, code }) {
      const device = await selectedDevice(door);
      const matches = keysFrom(await client.listKeys(device.partSn || device.esn)).filter(item => keyCode(item) === String(code));
      if (matches.length > 1) throw new Error('More than one lock entry uses the cleaner PIN; owner review is required.');
      if (!matches.length) return null;
      if (!Number.isInteger(keyNumber(matches[0]))) throw new Error('The cleaner code has no valid lock reference.');
      return { providerCodeId: encodeReference(device, keyNumber(matches[0]), code) };
    },
    async installCode({ door, code, startsAt, endsAt, name, providerCodeId, timezone = 'America/New_York', accessType = 'scheduled' }) {
      const device = await selectedDevice(door);
      if (!['scheduled', 'permanent'].includes(accessType)) throw new Error('Unsupported access type.');
      const attribute = accessType === 'permanent' ? 0 : 1;
      const startTime = attribute ? kkhomeLocalTimestamp(startsAt, timezone) : 0;
      const endTime = attribute ? kkhomeLocalTimestamp(endsAt, timezone) : 0;
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || (attribute && endTime <= startTime)) throw new Error('The guest-code access window is invalid.');
      const initial = keysFrom(await client.listKeys(device.partSn || device.esn));
      let match = matchingKey(initial, code, startTime, endTime);
      if (providerCodeId) {
        const saved = decodeReference(providerCodeId);
        if (saved.esn !== device.esn || saved.partSn !== device.partSn || saved.codeHash !== codeHash(code)) throw new Error('Saved code reference does not match this door and PIN.');
        const found = initial.filter(item => keyNumber(item) === saved.keyNum);
        if (found.length !== 1 || (keyCode(found[0]) && keyCode(found[0]) !== code)) throw new Error('Saved code entry changed; owner review is required.');
        match = found[0];
        if (!sameWindow(match, startTime, endTime)) {
          await client.updateKey({ esn:device.esn, ...(device.partSn ? { partSn:device.partSn } : {}), keyNum:saved.keyNum, keyType:0, key:code, attribute, week:0, startTime, endTime });
          match = { ...match, startTime, endTime, key:undefined, pwdValue:undefined };
        }
      }
      if (!match) {
        if (initial.some(item => !keyCode(item) && sameWindow(item, startTime, endTime))) throw new Error('An unconfirmed code already uses this window; owner review is required before retrying.');
        if (initial.some(item => keyCode(item) === code)) throw new Error('This PIN already has another access window; owner review is required.');
        const before = new Set(initial.map(keyNumber));
        await client.insertKey({ attribute, key:code, keyType:0, week:0, startTime, endTime, esn:device.esn,
          ...(device.partSn ? { partSn:device.partSn, partMac:device.partMac, partMode:device.partMode } : {}) });
        match = await verify(device, keys => {
          const visible = matchingKey(keys, code, startTime, endTime);
          if (visible) return visible;
          const added = keys.filter(item => !before.has(keyNumber(item)) && sameWindow(item, startTime, endTime) && !keyCode(item));
          return added.length === 1 ? added[0] : null;
        });
      }
      const keyNum = keyNumber(match);
      if (!match || !Number.isInteger(keyNum)) throw new Error(`KK Home did not verify the scheduled code on ${door.name}.`);
      const reference = encodeReference(device, keyNum, code);
      if (keyCode(match) !== code) {
        try {
          await client.saveKeyMetadata({ esn:device.partSn || device.esn, pwdList:[{ num:keyNum, pwdType:1, type:attribute,
            pwdValue:code, startTime, endTime, createTime:kkhomeLocalTimestamp(new Date()), nickName:name || match.nickName || 'WCH guest' }] });
          if (!await verify(device, keys => keys.find(item => keyNumber(item) === keyNum && keyCode(item) === code && sameWindow(item,startTime,endTime)))) {
            throw new Error(`KK Home did not verify the scheduled code on ${door.name}.`);
          }
        } catch (error) { error.providerCodeId = reference; throw error; }
      }
      return { status:'installed', providerCodeId:reference, verification:'cloud-record', message:'Code and local schedule confirmed in KK Home.' };
    },
    async inspectOneTime({ door, code }) {
      const device = await selectedDevice(door);
      const record = await client.getTemporaryKey(device.partSn || device.esn);
      return { matches: String(record?.key || '') === String(code), occupied: Boolean(record?.key), endsAt: record?.endTimeUTC || record?.endTime || null };
    },
    async installOneTime({ door, code }) {
      const device = await selectedDevice(door);
      const esn = device.partSn || device.esn;
      const current = await client.getTemporaryKey(esn);
      if (current?.key) throw new Error('This door already has a one-time code. Use or clear it in KK Home first.');
      // The app uses the dedicated temporary-PIN command, not a reusable scheduled PIN.
      await client.insertTemporaryKey({ esn, msgId: Math.floor(Math.random() * 1000000), tempPwd: String(code) });
      for (let attempt = 0; attempt < 4; attempt++) {
        const saved = await client.getTemporaryKey(esn);
        if (String(saved?.key || '') === String(code)) return { status: 'installed', verification: 'cloud-record', endsAt: saved.endTimeUTC || saved.endTime || null };
        if (attempt < 3) await wait(750);
      }
      return { status: 'unconfirmed', message: 'One-time command sent; check the lock. This code will not be automatically reissued.' };
    },
    async removeCode({ door, code, providerCodeId }) {
      const saved = decodeReference(providerCodeId);
      const device = await selectedDevice(door);
      if (saved.esn !== device.esn || saved.partSn !== device.partSn || saved.codeHash !== codeHash(code)) throw new Error('Saved code reference does not match this door and PIN.');
      const current = keysFrom(await client.listKeys(saved.partSn || saved.esn));
      const matches = current.filter(item => keyNumber(item) === saved.keyNum);
      if (!matches.length) {
        return { status:'removed', providerCodeId, message:'Code was already absent from KK Home.' };
      }
      if (matches.length !== 1 || keyCode(matches[0]) !== code) throw new Error('Saved code entry changed; removal was not attempted.');
      await client.removeKey({ esn:saved.esn, params:{ keyNum:saved.keyNum, keyType:0, partsSn:saved.partSn || '', partsMac:saved.partMac || '' } });
      await client.removeKeyMetadata({ esn:saved.partSn || saved.esn, pwdList:[{ num:saved.keyNum, pwdType:1 }] });
      const absent = await verify(saved, (keys) => !keys.some((item) => Number(first(item,'num','keyNum')) === saved.keyNum));
      const remains = !absent;
      if (remains) throw new Error(`KK Home did not verify code removal from ${door.name}.`);
      return { status:'removed', providerCodeId, verification:'cloud-record', message:'Code removal confirmed in KK Home.' };
    },
  };
}
