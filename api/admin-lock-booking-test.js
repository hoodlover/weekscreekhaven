import { provisionDoorCode, removeDoorCode, provisioningChanges, removalChanges, bookingAccessWindow } from '../_lib/lock-service.js';
import { json, requireAdmin } from '../_lib/security.js';

// Exercises the real booking lock service with an in-memory fixture only.
// No booking storage, scheduler, or guest communication is involved.
export function createBookingLockTestHandler({ env = process.env, now = Date.now, install = provisionDoorCode, remove = removeDoorCode } = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!requireAdmin(request)) return json(response, 401, { error: 'Owner sign-in required.' });
    if (request.method !== 'POST') return json(response, 405, { error: 'Use POST.' });
    const action = request.body?.action;
    let booking;
    try {
      const config = JSON.parse(env.KKHOME_BOOKING_TEST_JSON || 'null');
      const expires = Date.parse(config?.expiresAt);
      if (!['install', 'remove'].includes(action) || !config?.id || request.body?.testId !== config.id
        || !/^\d{6}$/.test(config.code) || !Number.isFinite(expires)
        || expires > now() + 3600000 || expires + (action === 'remove' ? 86400000 : 0) <= now()) throw new Error();
      booking = { id: `lock-test-${config.id}`, name: 'WCH automation test', doorCode: config.code,
        dateChoices: [{ arrival: config.arrival, departure: config.departure }],
        doorCodeProvisioning: { doors: (request.body?.references || []).map(item => ({ doorId: item.doorId, providerCodeId: item.providerCodeId })) } };
      const window = bookingAccessWindow(booking, env);
      const start = Date.parse(window.startsAt), end = Date.parse(window.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 172800000
        || (action === 'install' && (start <= now() || end > now() + 259200000))) throw new Error();
      if (env.LOCK_PROVIDER !== 'kkhome' || env.KKHOME_LIVE_ENABLED !== 'true') throw new Error();
    } catch {
      return json(response, 409, { error: 'No matching owner-configured booking test.' });
    }
    try {
      const result = await (action === 'install' ? install : remove)(booking, { env, now: new Date(now()).toISOString() });
      const changes = action === 'install' ? provisioningChanges(result) : removalChanges(result);
      return json(response, 200, { status: result.status, window: result.window,
        completionRecorded: Boolean(action === 'install' ? changes.doorCodeInstalledAt : changes.doorCodeRemovedAt),
        doors: result.doors.map(({ doorId, doorName, status, providerCodeId, verification }) => ({ doorId, doorName, status, providerCodeId, verification })),
        physicalTimingVerified: false });
    } catch {
      return json(response, 500, { error: 'Booking lock test did not complete.' });
    }
  };
}

export default createBookingLockTestHandler();
