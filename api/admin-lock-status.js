import { createKKHomeClient } from '../_lib/kkhome-client.js';
import { json, requireAdmin } from '../_lib/security.js';

// Read-only checks, even when automation is off. Never sends a lock command.
function keyInventory(payload) {
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.pwdList) || Array.isArray(payload?.timePwdList)
      ? [...(payload.pwdList || []), ...(payload.timePwdList || [])]
      : [payload?.list, payload?.records, payload?.items].find(Array.isArray);
  if (!rows || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    return { readable: false, format: 'unrecognized' };
  }
  return { readable: true, count: rows.length, entries: rows.map(row => {
    const entry = {};
    for (const key of ['num', 'keyNum', 'attribute', 'type', 'pwdType', 'startTime', 'endTime']) {
      const value = row[key];
      if ((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^-?\d{1,13}$/.test(value))) entry[key] = Number(value);
    }
    const code = row.key ?? row.pwdValue;
    entry.pinRecorded = typeof code === 'string' ? code.length > 0 : typeof code === 'number';
    entry.nameRecorded = typeof row.nickName === 'string' && row.nickName.length > 0;
    return entry;
  }) };
}

function deviceStatus(device) {
  // Report only explicit boolean/numeric status fields, never raw device data.
  const status = {};
  for (const key of ['online', 'isOnline', 'onLine', 'onlineStatus', 'status', 'wifiStatus', 'netStatus', 'deviceStatus', 'isConnected', 'connectState']) {
    const value = device[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || ['online', 'offline', 'true', 'false', '0', '1'].includes(value)) status[key] = value;
  }
  return status;
}
export function createLockStatusHandler({ env = process.env, clientFactory = createKKHomeClient, fetchImpl = globalThis.fetch } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (!requireAdmin(request)) return json(response, 401, { error: 'Owner sign-in required.' });
    if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    const required = ['KKHOME_EMAIL', 'KKHOME_PASSWORD', 'KKHOME_APP_PRIVATE_KEY', 'LOCK_DOORS_JSON'];
    const missing = required.filter(name => !env[name]?.trim());
    if (missing.length) return json(response, 200, { connected: false, missing });
    const requests = [];
    const diagnostics = new URL(request.url || '/', 'https://owner.weekscreekhaven.com').searchParams.get('diagnostics') === '1';
    try {
      const doors = JSON.parse(env.LOCK_DOORS_JSON);
      if (!Array.isArray(doors) || !doors.length || doors.some(door => !door.deviceId)
        || new Set(doors.map(door => door.deviceId)).size !== doors.length) {
        return json(response, 200, { connected: false, error: 'Invalid door configuration.' });
      }
      const client = clientFactory({ email: env.KKHOME_EMAIL.trim(), password: env.KKHOME_PASSWORD,
        appPrivateKey: env.KKHOME_APP_PRIVATE_KEY.trim(),
        fetchImpl: async (url, options) => {
          const path = new URL(url).pathname;
          if (!['/v3/user/login/get-user-by-mail', '/v3/user/device/list', ...(diagnostics ? ['/v3/device/key-list'] : [])].includes(path)) {
            throw new Error('Only login and device listing are allowed.');
          }
          const result = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
          requests.push({ operation: path.endsWith('/key-list') ? 'listKeys' : path.endsWith('/list') ? 'listDevices' : 'login', status: result.status });
          return result;
        },
      });
      const payload = await client.listDevices();
      const devices = [];
      function visit(value) {
        if (!value || typeof value !== 'object') return;
        if (!Array.isArray(value)) devices.push(value);
        for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
      }
      visit(payload);
      const identifiers = ['_id', 'deviceId', 'id', 'did', 'deviceNo', 'wifiSN', 'esn', 'deviceSn', 'sn'];
      const results = [];
      for (const door of doors) {
        const matches = devices.filter(device => identifiers.some(key => String(device[key] ?? '') === String(door.deviceId)));
        const result = { id: door.id, name: door.name, found: matches.length === 1, matches: matches.length };
        if (diagnostics && matches.length === 1) {
          const device = matches[0];
          result.deviceStatus = deviceStatus(device);
          const esn = ['wifiSN', 'esn', 'deviceSn', 'sn'].map(key => device[key]).find(value => value !== undefined && value !== null && value !== '');
          if (!esn) result.keyInventory = { readable: false, failure: 'missing_device_serial' };
          else {
            try { result.keyInventory = keyInventory(await client.listKeys(String(esn))); }
            catch { result.keyInventory = { readable: false, failure: 'key_list_failed' }; }
          }
        }
        results.push(result);
      }
      return json(response, 200, { connected: true, allDoorsFound: results.every(door => door.found), doors: results, requests,
        provider: String(env.LOCK_PROVIDER || 'manual').trim(),
        automationEnabled: String(env.LOCK_PROVIDER || '').trim() === 'kkhome' && env.KKHOME_LIVE_ENABLED === 'true',
        temporaryTestConfigured: Boolean(env.KKHOME_TEST_JSON || env.KKHOME_BOOKING_TEST_JSON) });
    } catch (error) {
      // Never expose provider responses, account details, tokens, or key material.
      const failure = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'connection_failed';
      return json(response, 200, { connected: false, failure, requests });
    }
  };
}

export default createLockStatusHandler();

