import { createKKHomeLockProvider } from '../_lib/lock-providers/kkhome.js';
import { createKKHomeClient } from '../_lib/kkhome-client.js';
import { correctTestTime } from '../_lib/kkhome-test-time.js';
import { kkhomeLocalTimestamp } from '../_lib/kkhome-time.js';
import { json, requireAdmin } from '../_lib/security.js';

// An owner-approved, short-lived test configured on the server. Never uses a booking.
export function createLockTestHandler({ env = process.env, providerFactory = createKKHomeLockProvider, now = Date.now, fetchImpl = globalThis.fetch } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (!requireAdmin(request)) return json(response, 401, { error: 'Owner sign-in required.' });
    if (request.method !== 'POST') return json(response, 405, { error: 'Use POST.' }, { Allow: 'POST' });
    let config, door;
    try {
      config = JSON.parse(env.KKHOME_TEST_JSON || 'null');
      const doors = JSON.parse(env.LOCK_DOORS_JSON || '[]');
      const matches = doors.filter(item => item.id === config?.doorId);
      const start = Date.parse(config?.startsAt), end = Date.parse(config?.endsAt);
      if (!config?.id || request.body?.testId !== config.id || !/^\d{6}$/.test(config.code)
        || matches.length !== 1 || !matches[0].deviceId || !Number.isFinite(start) || !Number.isFinite(end)
        || end <= now() || start > now() + 3600000 || end <= start || end - start > 3600000) throw new Error();
      door = matches[0];
    } catch {
      return json(response, 409, { error: 'No matching, unexpired owner-configured test.' });
    }
    const requests = [];
    try {
      if (request.body?.action === 'correct-time') {
        const client = createKKHomeClient({ email: env.KKHOME_EMAIL, password: env.KKHOME_PASSWORD,
          appPrivateKey: env.KKHOME_APP_PRIVATE_KEY, fetchImpl: (url, options) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) }) });
        const result = await correctTestTime(client, door, config);
        return json(response, 200, { ...result, door: door.name, startsAt: config.startsAt, endsAt: config.endsAt });
      }
      if (request.body?.action === 'inspect') {
        const client = createKKHomeClient({ email: env.KKHOME_EMAIL, password: env.KKHOME_PASSWORD,
          appPrivateKey: env.KKHOME_APP_PRIVATE_KEY, fetchImpl: (url, options) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) }) });
        const payload = await client.listKeys(door.deviceId);
        const shapes = new Set(), matches = [];
        const timingFields = ['startTime', 'endTime', 'beginTime', 'expireTime', 'validStartTime', 'validEndTime', 'num', 'keyNum'];
        function visit(value) {
          if (!value || typeof value !== 'object') return;
          if (!Array.isArray(value)) {
            const fields = Object.keys(value);
            shapes.add(fields.sort().join(','));
            const matchesCode = Object.values(value).some(item => typeof item !== 'object' && String(item) === config.code);
            const matchesTime = ['startTime', 'endTime'].some((key, index) => {
              let time = Number(value[key]);
              if (time > 1e12) time /= 1000;
              const instant = index ? config.endsAt : config.startsAt;
              return Math.abs(time - Date.parse(instant) / 1000) < 120 || Math.abs(time - kkhomeLocalTimestamp(instant)) < 120;
            });
            if (matchesCode || matchesTime) {
              matches.push({ matchesCode, hasPassword: value.pwdValue !== undefined,
                passwordLength: String(value.pwdValue ?? '').length,
                ...Object.fromEntries(timingFields.filter(key => value[key] !== undefined && Number.isFinite(Number(value[key])))
                  .map(key => [key, Number(value[key])])) });
            }
          }
          for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
        }
        visit(payload);
        return json(response, 200, { status: 'inspected', door: door.name, matchingRecords: matches,
          expectedStartTime: Date.parse(config.startsAt) / 1000, expectedEndTime: Date.parse(config.endsAt) / 1000,
          recordFields: [...shapes].slice(0, 12) });
      }
      const provider = providerFactory(env, { fetchImpl: async (url, options) => {
        const path = new URL(url).pathname;
        if (!['/v3/user/login/get-user-by-mail', '/v3/user/device/list', '/v3/device/key-list', '/v3/device/insert-pwd'].includes(path)) {
          throw new Error('Unsupported test operation.');
        }
        const result = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) });
        requests.push({ operation: path.split('/').at(-1), status: result.status });
        return result;
      } });
      const result = await provider.installCode({ door, code: config.code, startsAt: config.startsAt, endsAt: config.endsAt });
      return json(response, 200, { status: result.status, door: door.name, code: config.code,
        startsAt: config.startsAt, endsAt: config.endsAt, requests });
    } catch (error) {
      const message = String(error?.message || '');
      const failure = message.startsWith('KK Home did not verify') ? 'not_verified'
        : message.includes('was not found') ? 'device_not_found'
        : message.startsWith('KK Home request failed') ? 'provider_rejected' : 'test_failed';
      let reason;
      if (failure === 'provider_rejected') {
        reason = message;
        for (const secret of [env.KKHOME_EMAIL, env.KKHOME_PASSWORD, env.KKHOME_APP_PRIVATE_KEY, config.code].filter(Boolean)) reason = reason.split(secret).join('[redacted]');
        reason = reason.replace(/[A-Za-z0-9+/_=-]{24,}/g, '[redacted]').replace(/\d{6,}/g, '[redacted]').slice(0, 160);
      }
      return json(response, 200, { status: 'unconfirmed', door: door.name, failure, operation: error.operation,
        providerCode: error.providerCode, reason, requests });
    }
  };
}

export default createLockTestHandler();
