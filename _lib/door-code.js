import { randomInt } from 'node:crypto';

const unsafe = (code) => /^(\d)\1+$/.test(code) || '0123456789'.includes(code) || '9876543210'.includes(code);

export function generateDoorCode(bookings = []) {
  const used = new Set(bookings.flatMap(item => [item.doorCode, ...(Array.isArray(item.retiredDoorCodes) ? item.retiredDoorCodes : [])]).map(String).filter(Boolean));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = String(randomInt(100000, 1000000));
    if (!used.has(code) && !unsafe(code)) return code;
  }
  throw new Error('A unique door code could not be generated.');
}

export function selectedStay(booking) {
  return booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || {};
}

export function doorCodeTask(booking, today) {
  const stay = selectedStay(booking);
  if (!booking.doorCode && booking.status === 'booked') return { type:'setup', bookingId:booking.id, guestName:booking.name, arrival:stay.arrival, departure:stay.departure, label:'Generate and install a door code' };
  if (booking.doorCode && !booking.doorCodeInstalledAt && booking.status === 'booked') return { type:'setup', bookingId:booking.id, guestName:booking.name, arrival:stay.arrival, departure:stay.departure, code:booking.doorCode, label:'Install guest door code' };
  if (booking.doorCode && booking.doorCodeInstalledAt && !booking.doorCodeRemovedAt && (['cancelled','completed'].includes(booking.status) || (stay.departure && today > stay.departure))) return { type:'remove', bookingId:booking.id, guestName:booking.name, arrival:stay.arrival, departure:stay.departure, code:booking.doorCode, label:booking.status==='cancelled'?'Remove cancelled guest door code':'Remove expired guest door code' };
  return null;
}
