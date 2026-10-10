import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAirbnbCalendar, validateAirbnbFeed } from '../_lib/calendar-sync.js';
import { unavailableRanges } from '../_lib/booking-store.js';

const calendar = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const event = (extra='') => `BEGIN:VEVENT\r\nUID:booking-1\r\nDTSTART;VALUE=DATE:20261023\r\nDTEND;VALUE=DATE:20261025\r\nSUMMARY:Reserved\r\n${extra}\r\nEND:VEVENT`;

test('imports occupied nights without guest details and permits checkout-day turnover',()=>{
  const entries=parseAirbnbCalendar(calendar(event('DESCRIPTION:Guest private information')));
  assert.equal(entries.length,1);
  assert.equal(entries[0].arrival,'2026-10-23');
  assert.equal(entries[0].departure,'2026-10-25');
  assert.equal(JSON.stringify(entries).includes('private information'),false);
  const ranges=unavailableRanges({bookings:[],blocks:[],externalEntries:entries});
  assert.equal(ranges.some(range => range.arrival < '2026-10-26' && '2026-10-25' < range.departure),false);
});
test('canceled, transparent, and returned WCH events do not create blocks',()=>{
  assert.deepEqual(parseAirbnbCalendar(calendar(event('STATUS:CANCELLED'))),[]);
  assert.deepEqual(parseAirbnbCalendar(calendar(event('TRANSP:TRANSPARENT'))),[]);
  assert.deepEqual(parseAirbnbCalendar(calendar(event('UID:block-123@weekscreekhaven.com'))),[]);
  assert.deepEqual(parseAirbnbCalendar(calendar(event('SUMMARY:WCH — Unavailable'))),[]);
});
test('valid empty calendars reopen imported dates; malformed calendars cannot wipe them',()=>{
  assert.deepEqual(parseAirbnbCalendar(calendar('')),[]);
  assert.throws(()=>parseAirbnbCalendar('<html>Unavailable</html>'));
  assert.throws(()=>parseAirbnbCalendar(calendar('BEGIN:VEVENT\r\nUID:broken')));
  assert.throws(()=>parseAirbnbCalendar(calendar(event().replace('20261023','20260230'))));
});
test('feed fetches are restricted to official Airbnb HTTPS iCal exports',()=>{
  assert.equal(validateAirbnbFeed('https://www.airbnb.com/calendar/ical/123.ics?s=test'),'https://www.airbnb.com/calendar/ical/123.ics?s=test');
  for(const url of ['http://www.airbnb.com/calendar/ical/123.ics','https://localhost/calendar/ical/123.ics','https://www.airbnb.com.evil.test/calendar/ical/123.ics','https://user:pass@www.airbnb.com/calendar/ical/123.ics','https://www.airbnb.com/help']) assert.throws(()=>validateAirbnbFeed(url));
});
