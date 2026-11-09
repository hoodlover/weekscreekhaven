import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarWeeks,turnoverDates} from '../calendar-layout.js';
const stay=(arrival,departure,extra={})=>({arrival,departure,type:'booked',...extra});
test('a Friday-to-Sunday stay covers Friday afternoon through Sunday morning across weeks',()=>{
 const events=[stay('2026-11-27','2026-11-29')];
 const before=JSON.stringify(events), weeks=calendarWeeks(events,'2026-11-22');
 assert.deepEqual([weeks[0].segments[0].left,weeks[0].segments[0].right],[11,14]);
 assert.deepEqual([weeks[1].segments[0].left,weeks[1].segments[0].right],[0,1]);
 assert.equal(weeks[0].segments[0].ends,false); assert.equal(weeks[1].segments[0].starts,false);
 assert.equal(JSON.stringify(events),before);
});
test('same-day turns touch at mid-day in one lane; a free night remains visibly empty',()=>{
 const events=[stay('2026-12-24','2026-12-26'),stay('2026-12-26','2026-12-27'),stay('2026-12-28','2026-12-30')];
 const weeks=calendarWeeks(events,'2026-12-20');
 assert.equal(weeks[0].segments[0].right,weeks[0].segments[1].left);
 assert.equal(weeks[0].laneCount,1);
 assert.deepEqual([...turnoverDates(events)],['2026-12-26']);
 assert.equal(weeks[1].segments[1].left-weeks[1].segments[0].right,2);
});
test('Airbnb checkout stays on its actual DTEND day and matches direct stays',()=>{
 const events=[stay('2026-12-19','2026-12-22',{type:'external'}),stay('2026-12-22','2026-12-24')];
 const segments=calendarWeeks(events,'2026-12-20')[0].segments;
 assert.equal(segments[0].right,5); assert.equal(segments[1].left,5);
 assert.deepEqual([...turnoverDates(events)],['2026-12-22']);
});
test('owner holds stay full-day, hidden entries stay hidden, overlapping requests get separate lanes',()=>{
 const events=[stay('2026-12-21','2026-12-21',{type:'blocked'}),stay('2026-12-21','2026-12-23',{type:'request'}),stay('2026-12-22','2026-12-24',{hiddenFromCalendar:true})];
 const week=calendarWeeks(events,'2026-12-20')[0];
 assert.equal(week.segments.length,2); assert.equal(week.laneCount,2);
 assert.deepEqual([week.segments[0].left,week.segments[0].right],[2,4]);
 assert.equal(turnoverDates(events).size,0);
});
test('year boundaries, leap days and DST use calendar dates without shifting',()=>{
 for(const [arrival,departure,first] of [['2026-12-31','2027-01-03','2026-12-27'],['2028-02-28','2028-03-01','2028-02-27'],['2026-03-07','2026-03-09','2026-03-01']]){
  const weeks=calendarWeeks([stay(arrival,departure)],first);
  const width=weeks.flatMap(w=>w.segments).reduce((sum,s)=>sum+s.right-s.left,0);
  assert.equal(width,(Date.parse(departure)-Date.parse(arrival))/86400000*2);
 }
});
