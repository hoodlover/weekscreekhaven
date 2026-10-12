import test from 'node:test';
import assert from 'node:assert/strict';
import { hub, login, seedCleaner, adminCookie, call, getCleanerState, appendCleanerRecord, lockCalls, lockEntries, lockFailures } from '../test-support/cleaner-fixture.js';
const { syncCleanerLocks } = await import('../_lib/cleaner-locks.js');
const { saveOwnerLock } = await import('../_lib/owner-lock-store.js');

const future='2099-10-11', later='2099-10-15';
async function setup(){
  await seedCleaner();const cookie=adminCookie();
  const created=await call(hub,{method:'POST',cookie,body:{action:'save-cleaner-profile',cleanerName:'Delilah Test',standardPay:200,passcode:'delilah-test-password'}});
  const profileId=created.body.profileId;
  const post=body=>call(hub,{method:'POST',cookie,body:{profileId,...body}});
  const view=()=>call(hub,{cookie,query:{readOnly:'1',profileId}});
  return {cookie,profileId,post,view};
}
const enable=()=>{process.env.LOCK_PROVIDER='kkhome';process.env.KKHOME_LIVE_ENABLED='true';};

test('saved access is private to the selected or signed-in cleaner; saves never program doors',async()=>{
  const {cookie,profileId,post,view}=await setup();enable();
  assert.equal((await post({action:'save-cleaner-access',doorCode:'038572',closetCode:'064',accessNotes:'Small linen lock: 098'})).code,200);
  assert.equal((await post({action:'cleaner-access-date',date:future})).code,200);
  assert.equal(lockCalls.length,0);
  const own=(await view()).body;
  assert.equal(own.cleanerName,'Delilah Test');assert.equal(own.doorCode,'038572');assert.equal(own.closetCode,'064');assert.equal(own.cleanerAccess.needsApply,true);
  assert.equal(own.cleanerAccess.status,'not-applied');assert.equal(own.cleanerAccess.appliedCode,'');
  const signed=await call(login,{method:'POST',body:{passcode:'delilah-test-password'}});
  const cleanerCookie=signed.headers['Set-Cookie'].split(';')[0];
  const visible=await call(hub,{cookie:cleanerCookie,query:{readOnly:'1',profileId:'legacy-cleaner'}});
  assert.equal(visible.body.selectedCleanerId,profileId);assert.equal(visible.body.doorCode,'038572');
  assert.ok(!JSON.stringify(visible.body).includes('739426'));assert.ok(!JSON.stringify(visible.body).includes('original@example.test'));
  for(const action of ['save-cleaner-access','cleaner-access-date','apply-cleaner-keypad','revoke-cleaner-keypad']){
    assert.equal((await call(hub,{method:'POST',cookie:cleanerCookie,body:{action,profileId}})).code,403);
  }
  assert.equal((await call(hub,{method:'POST',cookie,origin:'https://unrelated.test',body:{action:'apply-cleaner-keypad',profileId}})).code,403);
  const original=await call(hub,{cookie,query:{readOnly:'1',profileId:'legacy-cleaner'}});
  assert.equal(original.body.doorCode,'739426');assert.deepEqual(original.body.cleanerAccess.dates,[]);
  assert.equal(lockCalls.length,0);
});

test('Apply installs only this cleaner on three doors; later draft saves and primary changes do not alter the applied plan',async()=>{
  const {profileId,post,view}=await setup();
  await post({action:'save-cleaner-access',doorCode:'038572',closetCode:'064'});
  await post({action:'cleaner-access-date',date:future});await post({action:'cleaner-access-date',date:later});
  let result=await post({action:'apply-cleaner-keypad',revision:(await view()).body.cleanerAccess.revision});
  assert.equal(result.code,409);assert.equal(lockCalls.length,0);enable();
  result=await post({action:'apply-cleaner-keypad',revision:'stale'});assert.equal(result.code,409);assert.equal(lockCalls.length,0);
  result=await post({action:'apply-cleaner-keypad',revision:(await view()).body.cleanerAccess.revision});
  assert.equal(result.code,200);assert.equal(result.body.accessStatus,'scheduled');
  const installs=lockCalls.filter(item=>item.action==='install');assert.equal(installs.length,3);
  assert.ok(installs.every(item=>item.code==='038572'&&item.endsAt.startsWith(future)));assert.equal(lockEntries.size,3);
  const initialLedger=(await getCleanerState()).cleanerProfiles.find(p=>p.id===profileId).cleanerLockState;
  lockCalls.length=0;
  await post({action:'save-cleaner-access',doorCode:'025864',closetCode:'065'});
  await post({action:'cleaner-access-date',date:later,remove:true});await post({action:'primary-cleaner'});
  assert.equal(lockCalls.length,0);
  let state=await getCleanerState(),profile=state.cleanerProfiles.find(p=>p.id===profileId);
  assert.equal(profile.keypadPlan.code,'038572');assert.deepEqual(profile.keypadPlan.dates,[future,later]);assert.deepEqual(profile.cleanerLockState,initialLedger);
  assert.equal((await view()).body.cleanerAccess.needsApply,true);
  await syncCleanerLocks();
  assert.ok(lockCalls.every(item=>item.code!=='025864'));assert.equal(lockEntries.size,3);
  lockCalls.length=0;
  result=await post({action:'apply-cleaner-keypad',revision:(await view()).body.cleanerAccess.revision});
  assert.equal(result.body.accessStatus,'scheduled');
  assert.equal(lockCalls.filter(item=>item.action==='remove'&&item.code==='038572').length,3);
  assert.equal(lockCalls.filter(item=>item.action==='install'&&item.code==='025864').length,3);
});

test('PIN conflicts and unmanaged lock entries cannot be taken over',async()=>{
  const {post,view}=await setup();
  assert.equal((await post({action:'save-cleaner-access',doorCode:'739426'})).code,409);
  await post({action:'save-cleaner-access',doorCode:'038572'});await post({action:'cleaner-access-date',date:future});
  await saveOwnerLock({id:'test-owner-entry',code:'038572',createdAt:new Date().toISOString(),doors:{}});enable();
  const result=await post({action:'apply-cleaner-keypad',revision:(await view()).body.cleanerAccess.revision});
  assert.equal(result.code,409);assert.equal(lockCalls.length,0);
  await post({action:'save-cleaner-access',doorCode:'038573'});
  lockEntries.set('front:038573',{providerCodeId:'unmanaged'});
  const collision=await post({action:'apply-cleaner-keypad',revision:(await view()).body.cleanerAccess.revision});
  assert.equal(collision.body.accessStatus,'needs-attention');
  assert.ok(!lockCalls.some(item=>item.action==='install'&&item.door.id==='front'));
  assert.equal(lockEntries.get('front:038573').providerCodeId,'unmanaged');
});

test('partial updates retain references; revocation and disabling never remove another cleaner PIN',async()=>{
  const {profileId,post,view}=await setup();
  await post({action:'save-cleaner-access',doorCode:'038572'});await post({action:'cleaner-access-date',date:future});enable();
  lockFailures.add('deck');
  const partial=await post({action:'apply-cleaner-keypad',revision:(await view()).body.cleanerAccess.revision});
  assert.equal(partial.body.accessStatus,'needs-attention');
  assert.equal((await view()).body.cleanerAccess.doors.find(d=>d.id==='deck').status,'failed');
  lockFailures.clear();
  assert.equal((await post({action:'apply-cleaner-keypad',revision:(await view()).body.cleanerAccess.revision})).body.accessStatus,'scheduled');
  for(const id of ['front','deck','basement'])lockEntries.set(id+':739426',{providerCodeId:'original-'+id});
  lockCalls.length=0;
  await post({action:'cleaner-profile-access',enabled:false});
  assert.equal(lockEntries.size,3);assert.ok(lockCalls.every(item=>item.code==='038572'));
  const profile=(await getCleanerState()).cleanerProfiles.find(p=>p.id===profileId);
  assert.equal(profile.enabled,false);assert.deepEqual(profile.keypadPlan.dates,[]);assert.equal(profile.cleanerLockState.status,'inactive');
  await post({action:'cleaner-profile-access',enabled:true});
  assert.deepEqual((await getCleanerState()).cleanerProfiles.find(p=>p.id===profileId).keypadPlan.dates,[]);
});

test('editing legacy access freezes the old schedule and preserves existing physical references',async()=>{
  await seedCleaner();
  await appendCleanerRecord({type:'settings',changes:{cleanerAccessDates:[future],cleanerLockState:{code:'739426',doors:{front:{code:'739426',providerCodeId:'original'}}}}});
  await appendCleanerRecord({type:'assignment',bookingId:'custom',changes:{customSession:true,cleanDate:later}});
  const result=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'save-cleaner-access',profileId:'legacy-cleaner',doorCode:'032658',closetCode:'045'}});
  assert.equal(result.code,200);
  const profile=(await getCleanerState()).cleanerProfiles[0];
  assert.deepEqual(profile.keypadPlan,{code:'739426',dates:[future,later]});assert.equal(profile.cleanerLockState.doors.front.providerCodeId,'original');
  assert.equal(lockCalls.length,0);
});
