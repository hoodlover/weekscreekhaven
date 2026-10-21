import test from 'node:test';
import assert from 'node:assert/strict';
import {hub,login,photo,seedCleaner,adminCookie,call,appendCleanerRecord,getCleanerState} from '../test-support/cleaner-fixture.js';
async function setup(){
 await seedCleaner();
 const added=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'save-cleaner-profile',cleanerName:'Test Cleaner',cleanerEmail:'test@example.test',standardPay:175,passcode:'test-cleaner-code'}});
 const id=added.body.profileId;
 const signed=await call(login,{method:'POST',body:{passcode:'test-cleaner-code'}});
 await appendCleanerRecord({type:'assignment',bookingId:'saved-history',createdAt:new Date().toISOString(),changes:{cleanerId:id,customSession:true,cleanDate:'2099-10-29',basePayCents:20000}});
 return {id,cookie:signed.headers['Set-Cookie'].split(';')[0]};
}
test('owner deletes a primary cleaner without losing records, and stale sessions stop working',async()=>{
 const {id,cookie}=await setup();
 assert.equal((await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'primary-cleaner',profileId:id}})).code,200);
 assert.equal((await call(hub,{method:'POST',cookie,body:{action:'delete-cleaner-profile',profileId:id}})).code,403);
 assert.equal((await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'delete-cleaner-profile',profileId:id}})).code,200);
 const state=await getCleanerState(),removed=state.cleanerProfiles.find(p=>p.id===id);
 assert.equal(state.settings.primaryCleanerId,'legacy-cleaner');assert.ok(removed.deletedAt);assert.equal(removed.enabled,false);assert.equal(removed.passcodeHash,'');assert.deepEqual(removed.keypadPlan.dates,[]);
 assert.equal(state.assignments.find(a=>a.bookingId==='saved-history').basePayCents,20000);
 assert.equal((await call(hub,{cookie})).code,401);assert.equal((await call(photo,{cookie,query:{photoId:'missing'}})).code,401);
 const view=await call(hub,{cookie:adminCookie(),query:{readOnly:'1',profileId:id}});
 assert.equal(view.code,200);assert.equal(view.body.selectedCleanerId,'legacy-cleaner');assert.ok(!view.body.cleanerProfiles.some(p=>p.id===id));assert.ok(view.body.deletedCleanerProfiles.some(p=>p.id===id));
 assert.equal((await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'setup-access',profileId:id,passcode:'new-test-code'}})).code,404);
});
test('deleted history can be restored but old credentials stay invalid; last primary requires a replacement',async()=>{
 const {id,cookie}=await setup();
 await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'delete-cleaner-profile',profileId:id}});
 const restored=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'restore-cleaner-profile',profileId:id}});
 assert.equal(restored.code,200);assert.equal((await call(hub,{cookie})).code,401);
 const state=await getCleanerState();assert.equal(state.cleanerProfiles.find(p=>p.id===id).enabled,false);
 assert.equal((await call(hub,{cookie:adminCookie(),query:{readOnly:'1',profileId:id}})).body.upcoming.length,1);
 assert.equal((await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'delete-cleaner-profile',profileId:'legacy-cleaner'}})).code,400);
});
