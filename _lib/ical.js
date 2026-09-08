const CRLF = '\r\n';

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function dateTime(value) {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? '19700101T000000Z' : parsed.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function date(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value).replace(/-/g, '') : '';
}

function fold(line) {
  const chunks = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let index = 0;
    let bytes = 0;
    for (const character of rest) {
      const size = Buffer.byteLength(character, 'utf8');
      if (bytes + size > 74) break;
      bytes += size;
      index += character.length;
    }
    chunks.push(rest.slice(0, index));
    rest = ` ${rest.slice(index)}`;
  }
  chunks.push(rest);
  return chunks.join(CRLF);
}

function event({ uid, createdAt, updatedAt, arrival, departure, summary, description, status = 'CONFIRMED' }) {
  if (!date(arrival) || !date(departure) || departure <= arrival) return [];
  return [
    'BEGIN:VEVENT',
    `UID:${escapeText(uid)}@weekscreekhaven.com`,
    `DTSTAMP:${dateTime(updatedAt || createdAt)}`,
    `CREATED:${dateTime(createdAt)}`,
    `LAST-MODIFIED:${dateTime(updatedAt || createdAt)}`,
    `DTSTART;VALUE=DATE:${date(arrival)}`,
    `DTEND;VALUE=DATE:${date(departure)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `STATUS:${status}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

function bookingDates(booking) {
  return booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0];
}

function bookingUpdatedAt(booking) {
  const values = [booking.updatedAt, booking.bookedAt, booking.completedAt, booking.createdAt].filter(Boolean).sort();
  return values.at(-1) || new Date(0).toISOString();
}

export function buildOwnerCalendar(calendar) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Weeks Creek Haven//Owner Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Weeks Creek Haven',
    'X-WR-CALDESC:Bookings and owner holds from the Weeks Creek Haven calendar',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const booking of calendar.bookings || []) {
    if (!['booked', 'completed'].includes(booking.status)) continue;
    const dates = bookingDates(booking);
    if (!dates) continue;
    lines.push(...event({
      uid: `booking-${booking.id}`,
      createdAt: booking.createdAt,
      updatedAt: bookingUpdatedAt(booking),
      arrival: dates.arrival,
      departure: dates.departure,
      summary: `WCH — ${booking.name || 'Guest stay'}`,
      description: `Guest stay at Weeks Creek Haven. Check-in: ${dates.arrival}. Checkout: ${dates.departure}. Owner Hub: https://owner.weekscreekhaven.com/`,
    }));
  }

  for (const block of calendar.blocks || []) {
    lines.push(...event({
      uid: `block-${block.id}`,
      createdAt: block.createdAt,
      updatedAt: block.updatedAt || block.createdAt,
      arrival: block.arrival,
      departure: block.departure,
      summary: `WCH — ${block.label || 'Owner hold'}`,
      description: `${block.holdType === 'flexible' ? 'Flexible' : 'Firm'} owner hold at Weeks Creek Haven. Owner Hub: https://owner.weekscreekhaven.com/`,
      status: block.holdType === 'flexible' ? 'TENTATIVE' : 'CONFIRMED',
    }));
  }

  lines.push('X-WR-TIMEZONE:America/New_York', 'X-WR-RELCALID:wch-owner-calendar', 'END:VCALENDAR');
  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}
