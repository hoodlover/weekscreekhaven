import { createKKHomeClient } from '../_lib/kkhome-client.js';
import { json, requireAdmin } from '../_lib/security.js';

// Deliberately only authenticates and lists devices, even when automation is off.
export function createLockStatusHandler({ env = process.env, clientFactory = createKKHomeClient, fetchImpl = globalThis.fetch } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (!requireAdmin(request)) return json(response, 401, { error: 'Owner sign-in required.' });
    if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { error: 'Use GET or POST.' }, { Allow: 'GET, POST' });
    const required = ['KKHOME_EMAIL', 'KKHOME_PASSWORD', 'KKHOME_APP_PRIVATE_KEY', 'LOCK_DOORS_JSON'];
    const missing = required.filter(name => !env[name]?.trim());
    if (missing.length) return json(response, 200, { connected: false, missing });
    const requests = [];
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
          if (!['/v3/user/login/get-user-by-mail', '/v3/user/device/list'].includes(path)) {
            throw new Error('Only login and device listing are allowed.');
          }
          const result = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
          requests.push({ operation: path.endsWith('/list') ? 'listDevices' : 'login', status: result.status });
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
      const results = doors.map(door => {
        const matches = devices.filter(device => identifiers.some(key => String(device[key] ?? '') === String(door.deviceId))).length;
        return { id: door.id, name: door.name, found: matches === 1, matches };
      });
      return json(response, 200, { connected: true, allDoorsFound: results.every(door => door.found), doors: results, requests });
    } catch (error) {
      // Never expose provider responses, account details, tokens, or key material.
      const failure = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'connection_failed';
      return json(response, 200, { connected: false, failure, requests });
    }
  };
}

export default createLockStatusHandler();
