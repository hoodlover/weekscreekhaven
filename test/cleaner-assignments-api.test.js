import test from 'node:test';
import assert from 'node:assert/strict';
import { hub, login, photo, seedCleaner, adminCookie, call, appendCleanerRecord, getCleanerState, blobs } from '../test-support/cleaner-fixture.js';

async function setup(){
 await seedCleaner();
 // Old records retain the original cleaner, including after a primary-contact change.
 await appendCleanerRecord({type:'assignment',bookingId:'custom-heather-23',createdAt:'2026-10-01T00:00:00Z',changes:{customSession:true,cleanDate:'2099-10-23',sessionLabel:'Heather job',status:'scheduled',basePayCents:20000}});
 const added=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'save-cleaner-profile',cleanerName:'Lance Cobb',cleanerEmail:'lance@example.test',standardPay:200,passcode:'lance-test-code'}});
 const lanceId=added.body.profileId;
 const created=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'create-cleaning-session',profileId:lanceId,cleanDate:'2099-10-29',sessionLabel:'Lance job',guests:5,basePay:200}});
 assert.equal(created.code,200);
 const lanceJob=(await getCleanerState()).assignments.find(item=>item.sessionLabel==='Lance job');
 const signed=await call(login,{method:'POST',body:{passcode:'lance-test-code'}});
 return {lanceId,lanceJob,cookie:signed.headers['Set-Cookie'].split(';')[0]};
}
test('cleaner sign-in and owner preview contain only that cleaner’s jobs and cleaning pay',async()=>{
 const {lanceId,lanceJob,cookie}=await setup();
 for(const options of [{cookie},{cookie:adminCookie(),query:{readOnly:'1',profileId:lanceId}}]){
  const result=await call(hub,options);assert.equal(result.code,200);
  assert.deepEqual(result.body.upcoming.map(item=>item.bookingId),[lanceJob.bookingId]);
 }
 await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'primary-cleaner',profileId:lanceId}});
 const original=await call(hub,{cookie:adminCookie(),query:{readOnly:'1',profileId:'legacy-cleaner'}});
 assert.deepEqual(original.body.upcoming.map(item=>item.bookingId),['custom-heather-23']);
 await appendCleanerRecord({type:'assignment',bookingId:'custom-heather-23',createdAt:new Date().toISOString(),changes:{completedAt:new Date().toISOString(),status:'completed'}});
 assert.equal((await call(hub,{cookie})).body.money.owedCents,0);
 assert.equal((await call(hub,{cookie:adminCookie(),query:{readOnly:'1',profileId:'legacy-cleaner'}})).body.money.owedCents,20000);
});
test('guessing another cleaner’s job or photo cannot read or update it',async()=>{
 const {cookie}=await setup();const before=blobs.size;
 for(const action of ['assignment','special-request','guest-review','turnover-checklist']){
  const result=await call(hub,{method:'POST',cookie,body:{action,bookingId:'custom-heather-23',profileId:'legacy-cleaner',status:'completed',rating:5,review:'Great'}});
  assert.equal(result.code,403,action);
 }
 assert.equal(blobs.size,before);
 assert.equal((await call(hub,{method:'POST',cookie,body:{action:'assignment',bookingId:'made-up',status:'completed'}})).code,404);
 assert.equal((await call(photo,{method:'POST',cookie,body:{bookingId:'custom-heather-23'}})).code,403);
 await appendCleanerRecord({type:'cleaning_photo',photo:{id:'other-photo',bookingId:'custom-heather-23',pathname:'missing'}});
 assert.equal((await call(photo,{cookie,query:{photoId:'other-photo'}})).code,403);
});
test('owners can reassign a job and job emails must follow the assigned cleaner',async()=>{
 const {lanceId,cookie}=await setup();
 for(const action of ['send-email','schedule-email'])assert.equal((await call(hub,{method:'POST',cookie:adminCookie(),body:{action,profileId:lanceId,bookingId:'custom-heather-23',confirmed:true,subject:'Test cleaning assignment',body:'Please review this cleaning assignment.',operationId:'assignment-email-test'}})).code,409);
 const saved=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'assignment',bookingId:'custom-heather-23',assignedCleanerId:lanceId,basePay:200,status:'scheduled'}});
 assert.equal(saved.code,200);
 assert.equal((await call(hub,{cookie})).body.upcoming.length,2);
 assert.equal((await call(hub,{cookie:adminCookie(),query:{readOnly:'1',profileId:'legacy-cleaner'}})).body.upcoming.length,0);
 assert.equal((await call(hub,{method:'POST',cookie,body:{action:'assignment',bookingId:'custom-heather-23',status:'accepted'}})).code,200);
});
