import { createKKHomeClient } from '../kkhome-client.js';

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
    if (Array.isArray(payload[key])) return payload[key];
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
  for (const key of ['pwdList','list','records','items']) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function matchingKey(keys, code, startTime, endTime) {
  return keys.find((item) => String(first(item, 'key','pwdValue') || '') === code
    && Number(item.startTime) === startTime && Number(item.endTime) === endTime);
}

function encodeReference(device, keyNum) {
  return Buffer.from(JSON.stringify({ v:1, ...device, keyNum:Number(keyNum) })).toString('base64url');
}

function decodeReference(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (parsed?.v === 1 && Number.isInteger(parsed.keyNum)) return parsed;
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
    async installCode({ door, code, startsAt, endsAt }) {
      const device = await selectedDevice(door);
      const startTime = Math.floor(new Date(startsAt).getTime()/1000);
      const endTime = Math.floor(new Date(endsAt).getTime()/1000);
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) throw new Error('The guest-code access window is invalid.');
      let match = matchingKey(keysFrom(await client.listKeys(device.partSn || device.esn)), code, startTime, endTime);
      if (!match) {
        await client.insertKey({ attribute:1, key:code, keyType:0, week:0, startTime, endTime, esn:device.esn,
          ...(device.partSn ? { partSn:device.partSn, partMac:device.partMac, partMode:device.partMode } : {}) });
        match = await verify(device, (keys) => matchingKey(keys, code, startTime, endTime));
      }
      const keyNum = Number(first(match, 'num','keyNum'));
      if (!match || !Number.isInteger(keyNum)) throw new Error(`KK Home did not verify the scheduled code on ${door.name}.`);
      return { status:'installed', providerCodeId:encodeReference(device,keyNum), message:'Scheduled code installed and verified in KK Home.' };
    },
    async removeCode({ door, providerCodeId }) {
      const saved = decodeReference(providerCodeId);
      const current = keysFrom(await client.listKeys(saved.partSn || saved.esn));
      if (!current.some((item) => Number(first(item,'num','keyNum')) === saved.keyNum)) {
        return { status:'removed', providerCodeId, message:'Code was already absent from KK Home.' };
      }
      await client.removeKey({ esn:saved.esn, params:{ keyNum:saved.keyNum, keyType:0, partsSn:saved.partSn || '', partsMac:saved.partMac || '' } });
      const absent = await verify(saved, (keys) => !keys.some((item) => Number(first(item,'num','keyNum')) === saved.keyNum));
      const remains = !absent;
      if (remains) throw new Error(`KK Home did not verify code removal from ${door.name}.`);
      return { status:'removed', providerCodeId, message:'Code removed and verified in KK Home.' };
    },
  };
}
