import { selectedStay } from './door-code.js';

export const DOOR_CODE_RELEASE_TEXT = 'Available at 9:00 AM Eastern the day before check-in';

export function doorCodeReleaseDate(arrival) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival || '')) return '';
  const date = new Date(`${arrival}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== arrival) return '';
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function doorCodeAvailable(booking, now = new Date()) {
  const stay = selectedStay(booking);
  const releaseDate = doorCodeReleaseDate(stay.arrival);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Boolean(booking.status === 'booked' && booking.doorCode && booking.doorCodeInstalledAt
    && !booking.doorCodeRemovedAt && releaseDate && stay.departure && today <= stay.departure
    && (today > releaseDate || (today === releaseDate && Number(parts.hour) >= 9)));
}

export function doorCodeEmailDue(booking, now = new Date()) {
  return !booking.doorCodeGuestSentAt && doorCodeAvailable(booking, now);
}
