import test from 'node:test';
import assert from 'node:assert/strict';
import { hub, login, photo, seedCleaner, adminCookie, call, blobs, getCleanerState, createSession } from '../test-support/cleaner-fixture.js';

test('owner adds, edits, and reloads profiles through the actual API and encrypted store', async () => {
  await seedCleaner();const cookie=adminCookie();
  const created=await call(hub,{method:'POST',cookie,body:{action:'save-cleaner-profile',cleanerName:'Backup Cleaner',cleanerEmail:'backup@example.test',cleanerPhone:'555-0100',notes:'Weekend coverage',standardPay:'180',passcode:'backup-test-code'}});
  assert.equal(created.code,200);const profileId=created.body.profileId;
  let result=await call(hub,{cookie});
  assert.equal(result.code,200);assert.equal(result.body.cleanerProfiles.length,2);
  assert.equal(result.body.cleanerName,'Original Cleaner');
  const backup=result.body.cleanerProfiles.find(profile=>profile.id===profileId);
  assert.equal(backup.cleanerPhone,'555-0100');assert.equal(backup.hasAccess,true);
  assert.equal(backup.notes,'Weekend coverage');assert.equal(backup.passcodeHash,undefined);
  assert.ok([...blobs.values()].every(blob=>!String(blob.data).includes('Backup Cleaner')));
  const edited=await call(hub,{method:'POST',cookie,body:{action:'save-cleaner-profile',profileId,cleanerName:'Backup Updated',cleanerEmail:'backup@example.test',standardPay:185,passcode:''}});
  assert.equal(edited.code,200);
  result=await call(hub,{cookie});
  assert.equal(result.body.cleanerProfiles.find(profile=>profile.id===profileId).standardPayCents,18500);
  const primary=await call(hub,{method:'POST',cookie,body:{action:'primary-cleaner',profileId}});
  assert.equal(primary.code,200);result=await call(hub,{cookie});
  assert.equal(result.body.cleanerName,'Backup Updated');assert.equal(result.body.cleanerEmail,'backup@example.test');
  assert.equal(result.body.doorCode,'');assert.equal(result.body.closetCode,'');
  const original=await call(hub,{cookie,query:{readOnly:'1',profileId:'legacy-cleaner'}});
  assert.equal(original.body.doorCode,'739426');assert.equal(original.body.closetCode,'412');
});

test('cleaner sign-in is profile-specific; profile management is owner-only and revoked sessions cannot access photos', async () => {
  await seedCleaner();const owner=adminCookie();
  const added=await call(hub,{method:'POST',cookie:owner,body:{action:'save-cleaner-profile',cleanerName:'Backup Cleaner',cleanerEmail:'backup@example.test',notes:'Private owner note',standardPay:180,passcode:'backup-test-code'}});
  const signed=await call(login,{method:'POST',body:{passcode:'backup-test-code'}});
  assert.equal(signed.code,200);const cookie=signed.headers['Set-Cookie'].split(';')[0];
  const view=await call(hub,{cookie});
  assert.equal(view.code,200);assert.equal(view.body.viewerCleanerName,'Backup Cleaner');
  assert.equal(view.body.cleanerProfiles,undefined);assert.ok(!JSON.stringify(view.body).includes('Private owner note'));
  const before=blobs.size;
  for(const action of ['save-cleaner-profile','primary-cleaner','cleaner-profile-access','setup-access']){
    const denied=await call(hub,{method:'POST',cookie,body:{action,profileId:added.body.profileId,cleanerName:'Unauthorized',standardPay:1,passcode:'not-allowed'}});
    assert.equal(denied.code,403);
  }
  assert.equal(blobs.size,before);
  assert.equal((await call(photo,{cookie,query:{photoId:'missing'}})).code,404);
  assert.equal((await call(hub,{method:'POST',cookie:owner,origin:'https://unrelated.example.test',body:{action:'primary-cleaner',profileId:added.body.profileId}})).code,403);
  const disabled=await call(hub,{method:'POST',cookie:owner,body:{action:'cleaner-profile-access',profileId:added.body.profileId,enabled:false}});
  assert.equal(disabled.code,200);
  assert.equal((await call(hub,{cookie})).code,401);
  assert.equal((await call(photo,{cookie,query:{photoId:'missing'}})).code,401);
  assert.equal((await call(login,{method:'POST',body:{passcode:'backup-test-code'}})).code,401);
  const originalCookie=`wch_cleaner=${createSession({role:'cleaner',authVersion:'original-version'},3600)}`;
  assert.equal((await call(hub,{cookie:originalCookie})).code,200);
  assert.equal((await getCleanerState()).cleanerProfiles.length,2);
});

test('invalid profile data returns a helpful client error without a storage write', async () => {
  await seedCleaner();const before=blobs.size;
  const result=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'save-cleaner-profile',cleanerName:'',standardPay:175}});
  assert.equal(result.code,400);assert.match(result.body.error,/name/);assert.equal(blobs.size,before);
  assert.equal((await call(hub)).code,401);
});


test('four-character cleaner passcodes support leading zeros and letters for create, reset and sign-in',async()=>{
 await seedCleaner();
 const added=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'save-cleaner-profile',cleanerName:'Four Character Cleaner',cleanerEmail:'four@example.test',standardPay:175,passcode:'0042'}});
 assert.equal(added.code,200);
 assert.equal((await call(login,{method:'POST',body:{passcode:'0042'}})).code,200);
 const changed=await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'setup-access',profileId:added.body.profileId,passcode:'A2b3'}});
 assert.equal(changed.code,200);
 assert.equal((await call(login,{method:'POST',body:{passcode:'a2B3'}})).code,200);
 assert.equal((await call(hub,{method:'POST',cookie:adminCookie(),body:{action:'setup-access',profileId:added.body.profileId,passcode:'123'}})).code,400);
});
