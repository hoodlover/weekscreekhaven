import { createHash } from 'node:crypto';
import { createManualLockProvider } from './lock-providers/manual.js';
import { createSimulatedLockProvider } from './lock-providers/simulated.js';

const DEFAULT_DOORS = [
  { id: 'front', name: 'Front door' },
  { id: 'side', name: 'Side door' },
  { id: 'back', name: 'Back door' },
];

function cleanDoor(value, index) {
  const id = String(value?.id || `door-${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const name = String(value?.name || `Door ${index + 1}`).trim().slice(0, 80);
  const deviceId = String(value?.deviceId || '').trim();
  return { id, name, ...(deviceId ? { deviceId } : {}) };
}

export function configuredDoors(env = process.env) {
  if (!env.LOCK_DOORS_JSON) return DEFAULT_DOORS.map((door) => ({ ...door }));
  try {
    const parsed = JSON.parse(env.LOCK_DOORS_JSON);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('At least one door is required.');
    const doors = parsed.map(cleanDoor);
    if (new Set(doors.map((door) => door.id)).size !== doors.length) throw new Error('Door IDs must be unique.');
    return doors;
  } catch (error) {
    throw new Error(`LOCK_DOORS_JSON is invalid: ${error.message}`);
  }
}

export function lockProviderName(env = process.env) {
  return String(env.LOCK_PROVIDER || 'manual').trim().toLowerCase();
}

export function createLockProvider(env = process.env) {
  const name = lockProviderName(env);
  if (name === 'manual') return createManualLockProvider();
  if (name === 'simulated') {
    if (env.VERCEL_ENV === 'production') {
      const blocked = async () => { throw new Error('The simulated lock provider is disabled in production.'); };
      return { id:'simulated-blocked', installCode:blocked, removeCode:blocked };
    }
    return createSimulatedLockProvider(env);
  }
  throw new Error(`Unsupported LOCK_PROVIDER "${name}". Keep LOCK_PROVIDER=manual until an adapter has passed cabin testing.`);
}

function selectedStay(booking) {
  return booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || {};
}

function easternOffset(dateKey) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'longOffset', hour: '2-digit',
  }).formatToParts(new Date(`${dateKey}T12:00:00Z`));
  const label = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT-05:00';
  const match = label.match(/GMT([+-]\d{2}:\d{2})/);
  return match?.[1] || '-05:00';
}

function easternTimestamp(dateKey, hour, minute = 0) {
  return `${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${easternOffset(dateKey)}`;
}

export function bookingAccessWindow(booking, env = process.env) {
  const stay = selectedStay(booking);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stay.arrival || '') || !/^\d{4}-\d{2}-\d{2}$/.test(stay.departure || '')) {
    throw new Error('Arrival and departure dates are required before a lock code can be installed.');
  }
  const noSetCheckout = Boolean(booking.friendsAndFamilyDiscount) && booking.friendsAndFamilyDiscount.chargeCleaning !== true;
  const endHour = noSetCheckout
    ? Number(env.LOCK_FLEXIBLE_CHECKOUT_HOUR || 23)
    : booking.lateCheckout ? 12 : 11;
  if (!Number.isInteger(endHour) || endHour < 0 || endHour > 23) throw new Error('LOCK_FLEXIBLE_CHECKOUT_HOUR must be an hour from 0 through 23.');
  return {
    startsAt: easternTimestamp(stay.arrival, 15, 45),
    endsAt: easternTimestamp(stay.departure, endHour, noSetCheckout ? 45 : 15),
    timezone: 'America/New_York',
  };
}

async function runForEveryDoor({ booking, action, env, now }) {
  if (!booking?.id || !booking?.doorCode) throw new Error('A booking ID and door code are required.');
  let provider;
  let doors;
  let window;
  try {
    provider = createLockProvider(env);
    doors = configuredDoors(env);
    window = bookingAccessWindow(booking, env);
  } catch (error) {
    return {
      provider:lockProviderName(env), action, status:'failed', attemptedAt:now,
      message:error.message || 'Lock provider configuration failed.', doors:[],
    };
  }
  const revision = String(booking.doorCodeGeneratedAt || booking.doorCodeReplacedAt || booking.doorCode);
  const attempts = await Promise.all(doors.map(async (door) => {
    const idempotencyKey = createHash('sha256').update(JSON.stringify([booking.id,revision,window.startsAt,window.endsAt,action,door.id])).digest('hex');
    const previousProviderCodeId=booking.doorCodeProvisioning?.doors?.find((item) => item.doorId === door.id)?.providerCodeId;
    try {
      const value = action === 'install'
        ? await provider.installCode({ door, code:String(booking.doorCode), name:`${booking.name || 'Guest'} · ${window.startsAt.slice(0, 10)}`, providerCodeId:previousProviderCodeId, ...window, idempotencyKey })
        : await provider.removeCode({ door, code:String(booking.doorCode), providerCodeId:previousProviderCodeId, ...window, idempotencyKey });
      return { ...value, doorId:door.id, doorName:door.name, providerCodeId:value.providerCodeId || previousProviderCodeId };
    } catch (error) {
      return { doorId:door.id, doorName:door.name, status:'failed', message:error.message || `${action} failed.`, ...(previousProviderCodeId?{providerCodeId:previousProviderCodeId}:{}) };
    }
  }));
  const successStatus = action === 'install' ? 'installed' : 'removed';
  const succeeded = attempts.filter((item) => item.status === successStatus).length;
  const manual = attempts.filter((item) => item.status === 'manual').length;
  const status = succeeded === doors.length ? successStatus
    : manual === doors.length ? 'manual'
      : succeeded > 0 ? 'partial'
        : 'failed';
  return { provider:provider.id, action, status, attemptedAt:now, window, doors:attempts };
}

export function provisionDoorCode(booking, { env = process.env, now = new Date().toISOString() } = {}) {
  return runForEveryDoor({ booking, action:'install', env, now });
}

export function removeDoorCode(booking, { env = process.env, now = new Date().toISOString() } = {}) {
  return runForEveryDoor({ booking, action:'remove', env, now });
}

export function provisioningChanges(result) {
  return {
    doorCodeProvisioning: result,
    doorCodeInstalledAt: result.status === 'installed' ? result.attemptedAt : null,
    doorCodeRemovedAt: null,
  };
}

export function removalChanges(result) {
  return {
    doorCodeRemoval: result,
    ...(result.status === 'removed' ? { doorCodeRemovedAt:result.attemptedAt } : {}),
  };
}

export function manualConfirmation(booking, action, now = new Date().toISOString()) {
  const status = action === 'install' ? 'installed' : 'removed';
  const source = action === 'install' ? booking.doorCodeProvisioning : booking.doorCodeRemoval;
  const doors = (source?.doors?.length ? source.doors : DEFAULT_DOORS).map((door) => ({
    doorId:door.doorId || door.id,
    doorName:door.doorName || door.name,
    status,
    message:'Confirmed manually by an owner.',
  }));
  return { provider:'manual', action, status, attemptedAt:now, ...(source?.window ? { window:source.window } : {}), doors };
}
