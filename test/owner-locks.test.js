import test from 'node:test';
import assert from 'node:assert/strict';
import { newOwnerLock, easternInput, applyOwnerLock } from '../_lib/owner-locks.js';
import { createKKHomeLockProvider } from '../_lib/lock-providers/kkhome.js';

const doors=[{id:'deck',name:'Deck',deviceId:'D'},{id:'front',name:'Front',deviceId:'F'}];
const options={doors,usedCodes:new Set(['123789']),now:new Date('2026-09-08T12:00:00Z')};
test('named permanent and scheduled entries enforce PIN uniqueness and selected doors',()=>{
  const entry=newOwnerLock({name:'Kids',mode:'permanent',doorIds:['deck','front'],code:'592718'},options);
  assert.equal(entry.endsAt,null);assert.equal(entry.name,'Kids');
  assert.throws(()=>newOwnerLock({name:'Kids',mode:'permanent',doorIds:['deck'],code:'123789'},options),/reserved/);
  assert.throws(()=>newOwnerLock({name:'Kids',mode:'permanent',doorIds:['other']},options),/valid cabin/);
  assert.throws(()=>newOwnerLock({name:'Visitor',mode:'once',doorIds:['deck','front']},options),/exactly one/);
});
test('scheduled input is Eastern on any device and rejects DST gaps and ambiguous times',()=>{
  assert.equal(easternInput('2026-10-17T15:00'),'2026-10-17T19:00:00.000Z');
  assert.equal(easternInput('2026-12-17T15:00'),'2026-12-17T20:00:00.000Z');
  assert.throws(()=>easternInput('2027-03-14T02:30'),/ambiguous/);
  assert.throws(()=>easternInput('2026-11-01T01:30'),/ambiguous/);
});
test('one-time command is attempted once even after a timeout or an explicit retry',async()=>{
  const entry=newOwnerLock({name:'Visitor',mode:'once',doorIds:['deck']},options);let calls=0;const writes=[];
  const deps={doors,save:async e=>writes.push(structuredClone(e)),provider:{installOneTime:async()=>{calls++;throw new Error('timeout');}}};
  await applyOwnerLock(entry,deps);await applyOwnerLock(entry,deps);
  assert.equal(calls,1);assert.ok(writes[0].attemptedAt);assert.equal(entry.status,'unconfirmed');
});
test('partial installation retains exact references and revocation removes every selected door',async()=>{
  const entry=newOwnerLock({name:'Kids',mode:'permanent',doorIds:['deck','front']},options);
  const removed=[];const provider={installCode:async({door})=>{if(door.id==='front')throw Object.assign(new Error('metadata'),{providerCodeId:'F-ref'});return{status:'installed',providerCodeId:'D-ref'};},removeCode:async({providerCodeId})=>removed.push(providerCodeId)};
  await applyOwnerLock(entry,{doors,provider,save:async()=>{}});assert.equal(entry.status,'needs-attention');
  await applyOwnerLock(entry,{doors,provider,save:async()=>{},revoke:true});assert.equal(entry.status,'revoked');assert.deepEqual(removed,['D-ref','F-ref']);
  await assert.rejects(()=>applyOwnerLock(entry,{doors,provider,save:async()=>{}}),/revoked/);
});
test('unreferenced uncertain installation cannot claim successful revocation',async()=>{
  const entry=newOwnerLock({name:'Kids',mode:'permanent',doorIds:['deck']},options);entry.doors.deck={status:'failed'};
  await applyOwnerLock(entry,{doors,provider:{findCode:async()=>null},save:async()=>{},revoke:true});assert.equal(entry.status,'revoking');
});
test('permanent access uses native attribute zero rather than a distant expiry',async()=>{
  let keys=[],payload;
  const client={listDevices:async()=>[{id:'D',esn:'D'}],listKeys:async()=>keys,insertKey:async p=>{payload=p;keys=[{num:4,startTime:0,endTime:0}];},saveKeyMetadata:async p=>{keys=p.pwdList;}};
  const result=await createKKHomeLockProvider({}, {client,wait:async()=>{}}).installCode({door:doors[0],code:'592718',name:'Kids',accessType:'permanent'});
  assert.equal(result.status,'installed');assert.equal(payload.attribute,0);assert.equal(payload.startTime,0);assert.equal(payload.endTime,0);assert.equal(keys[0].type,0);
});
test('single-use PIN uses the dedicated native temporary command and refuses an occupied slot',async()=>{
  let key='',calls=0;
  const client={listDevices:async()=>[{id:'D',esn:'D'}],getTemporaryKey:async()=>({key}),insertTemporaryKey:async p=>{calls++;key=p.tempPwd;}};
  const provider=createKKHomeLockProvider({}, {client,wait:async()=>{}});
  assert.equal((await provider.installOneTime({door:doors[0],code:'592718'})).status,'installed');
  await assert.rejects(()=>provider.installOneTime({door:doors[0],code:'785219'}),/already has/);assert.equal(calls,1);
});
