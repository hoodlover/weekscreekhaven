import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanerAccessDates, cleanerAccessWindow, reconcileCleanerLocks } from '../_lib/cleaner-locks.js';

const state = dates => ({ settings: { doorCode: '593827', cleanerAccessDates: dates }, assignments: [] });
const now = new Date('2026-09-08T16:00:00Z');
const doors = ['front', 'deck', 'basement'].map(id => ({ id, name: id }));
test('irregular dates never grant access across gaps; adjacent days merge', () => {
  const s=state(['2026-09-10','2026-09-11','2026-09-15']);
  assert.deepEqual(cleanerAccessWindow(s,now),{startsAt:'2026-09-10T00:00:00-04:00',endsAt:'2026-09-11T23:59:59-04:00',timezone:'America/New_York'});
  assert.equal(cleanerAccessWindow(s,new Date('2026-09-12T04:00:00Z')).startsAt,'2026-09-15T00:00:00-04:00');
  assert.equal(cleanerAccessWindow(s,new Date('2026-09-16T04:00:00Z')),null);
});
test('midnight cutoff follows Eastern time through both DST transitions', () => {
  for (const [date,start,end] of [['2026-11-01','-04:00','-05:00'],['2027-03-14','-05:00','-04:00']]) {
    const window=cleanerAccessWindow(state([date]),new Date(`${date}T05:00:00Z`));
    assert.equal(window.startsAt,`${date}T00:00:00${start}`);
    assert.equal(window.endsAt,`${date}T23:59:59${end}`);
  }
});
test('only explicit dates and noncancelled custom sessions grant access', () => {
  const s=state(['2026-09-10','2026-02-30']);s.settings.cleanerAccessExcludedDates=['2026-09-12'];
  s.assignments=[{cleanDate:'2026-09-09'}, {customSession:true,cleanDate:'2026-09-11',status:'cancelled'}, {customSession:true,cleanDate:'2026-09-12'}, {customSession:true,cleanDate:'2026-09-13',status:'completed'}];
  assert.deepEqual(cleanerAccessDates(s),['2026-09-10','2026-09-13']);
});
test('adopts the existing cleaner PIN and edits its window on all three doors', async () => {
  let installs=0;const saved=[];
  const result=await reconcileCleanerLocks({state:state(['2026-09-10']),bookings:[],doors,now,save:async value=>saved.push(structuredClone(value)),provider:{
    findCode:async ({door})=>({providerCodeId:door.id}),
    installCode:async input=>{assert.equal(input.providerCodeId,input.door.id);assert.equal(input.code,'593827');installs++;return {status:'installed',providerCodeId:input.providerCodeId};},
  }});
  assert.equal(installs,3);assert.equal(result.status,'scheduled');assert.ok(saved.length>=6);
});
test('no dates removes an old always-active cleaner PIN', async () => {
  const removed=[];
  const result=await reconcileCleanerLocks({state:state([]),bookings:[],doors,now,save:async()=>{},provider:{
    findCode:async ({door})=>({providerCodeId:door.id}),
    removeCode:async input=>removed.push(input.door.id),installCode:()=>assert.fail(),
  }});
  assert.deepEqual(removed,['front','deck','basement']);assert.equal(result.status,'inactive');
});
test('a changed PIN removes old references first and failures retain cleanup references', async () => {
  const s=state(['2026-09-10']);s.settings.cleanerLockState={doors:{front:{code:'781259',providerCodeId:'old'}}};
  const events=[];
  const result=await reconcileCleanerLocks({state:s,bookings:[],doors:[doors[0]],now,save:async()=>{},provider:{
    findCode:async()=>null,removeCode:async input=>events.push(input.code),
    installCode:async()=>{events.push('install');throw Object.assign(new Error('metadata failure'),{providerCodeId:'new'});},
  }});
  assert.deepEqual(events,['781259','install']);assert.equal(result.status,'needs-attention');assert.equal(result.doors.front.providerCodeId,'new');assert.equal(result.doors.front.code,s.settings.doorCode);
});
test('a guest PIN collision blocks all cleaner lock operations', async () => {
  await assert.rejects(()=>reconcileCleanerLocks({state:state(['2026-09-10']),bookings:[{doorCode:'593827'}],doors,now,save:()=>assert.fail(),provider:{findCode:()=>assert.fail()}}),/separate/);
});

test('unchanged confirmed schedules do not rewrite records or contact locks every five minutes', async () => {
  const s=state(['2026-09-10']);s.settings.cleanerLockState={status:'scheduled',code:s.settings.doorCode,window:cleanerAccessWindow(s,now),checkedAt:now.toISOString(),doors:Object.fromEntries(doors.map(door=>[door.id,{status:'installed',code:s.settings.doorCode,providerCodeId:door.id}]))};
  const result=await reconcileCleanerLocks({state:s,bookings:[],doors,now:new Date(now.getTime()+300000),save:()=>assert.fail(),provider:{findCode:()=>assert.fail(),installCode:()=>assert.fail()}});
  assert.equal(result.status,'scheduled');
});
