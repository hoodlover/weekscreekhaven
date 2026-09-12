import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerCalendar } from '../_lib/ical.js';

test('builds a subscribable calendar with booked stays and owner holds', () => {
  const output = buildOwnerCalendar({
    bookings: [
      { id:'booked-1', name:'Abby, Family', status:'booked', createdAt:'2026-09-01T12:00:00Z', bookedAt:'2026-09-02T12:00:00Z', approvedChoice:0, dateChoices:[{ arrival:'2026-10-02', departure:'2026-10-05' }] },
      { id:'pending-1', name:'Not confirmed', status:'pending', createdAt:'2026-09-01T12:00:00Z', dateChoices:[{ arrival:'2026-11-01', departure:'2026-11-03' }] },
      { id:'reserved-1', name:'Reserved guest', status:'reserved', createdAt:'2026-09-01T12:00:00Z', approvedChoice:0, dateChoices:[{ arrival:'2026-11-10', departure:'2026-11-12' }] },
      { id:'hidden-1', name:'Hidden request', status:'pending', hiddenFromCalendar:true, createdAt:'2026-09-01T12:00:00Z', dateChoices:[{ arrival:'2026-11-20', departure:'2026-11-22' }] },
    ],
    blocks: [
      { id:'hold-1', label:'Family; time', holdType:'flexible', arrival:'2026-12-10', departure:'2026-12-13', createdAt:'2026-09-03T12:00:00Z' },
    ],
  }, '2026-09-08T12:00:00Z');

  assert.match(output, /BEGIN:VCALENDAR\r\n/);
  assert.match(output, /SUMMARY:WCH — Abby\\, Family/);
  assert.match(output, /DTSTART;VALUE=DATE:20261002/);
  assert.match(output, /DTEND;VALUE=DATE:20261005/);
  assert.match(output, /SUMMARY:WCH — Family\\; time/);
  assert.match(output, /STATUS:TENTATIVE/);
  assert.match(output, /SUMMARY:WCH — Not confirmed/);
  assert.match(output, /STATUS:TENTATIVE/);
  assert.match(output, /SUMMARY:WCH — Reserved guest/);
  assert.doesNotMatch(output, /Hidden request/);
  assert.match(output, /END:VCALENDAR\r\n$/);
});

test('folds long iCalendar lines at 75 bytes or fewer', () => {
  const output = buildOwnerCalendar({
    bookings: [{ id:'long', name:'A very long guest name that keeps going well beyond a normal calendar line length', status:'completed', createdAt:'2026-01-01T12:00:00Z', dateChoices:[{ arrival:'2026-01-02', departure:'2026-01-04' }] }],
    blocks: [],
  });
  for (const line of output.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line exceeded 75 bytes: ${line}`);
});
