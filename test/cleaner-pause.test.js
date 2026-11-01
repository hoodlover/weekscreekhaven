import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.TEST_CLEANER_REAL_PAUSE='true';
const {hub,login,photo,seedCleaner,adminCookie,call,blobs,storageFaults,createSession,lockCalls}=await import('../test-support/cleaner-fixture.js');
const policy=await import('../_lib/cleaner-pause.js');
const {default:middleware}=await import('../middleware.js');
const {processScheduledCleanerEmails,scheduleCleanerEmail}=await import('../_lib/cleaner-email-jobs.js');
const {processCleanerReminders}=await import('../_lib/cleaner-reminders.js');
const ownerHost='owner.weekscreekhaven.com',cleanerHost='cleaner.weekscreekhaven.com';

test('real deployed pause denies old cleaner sessions and every host before storage or side effects',async()=>{
 await seedCleaner(); storageFaults.reads=0;storageFaults.failReads=true;const before=[...blobs];
 const oldCookie=`wch_cleaner=${createSession({role:'cleaner',cleanerId:'legacy-cleaner',authVersion:'original-version'},3600)}`;
 for(const host of [cleanerHost,ownerHost,'weekscreekhaven.com','preview.vercel.app'])for(const handler of [hub,photo,login])for(const method of ['GET','POST']){
  const result=await call(handler,{host,origin:`https://${host}`,cookie:oldCookie,method});
  assert.equal(result.code,503);assert.equal(result.body.paused,true);assert.equal(result.headers['Cache-Control'],'no-store');
 }
 for(const host of [cleanerHost,'weekscreekhaven.com','preview.vercel.app']){
  const result=await call(hub,{host,origin:`https://${host}`,cookie:adminCookie()});assert.equal(result.code,503);
 }
 assert.equal(storageFaults.reads,0);assert.deepEqual([...blobs],before);assert.equal(lockCalls.length,0);storageFaults.failReads=false;
});

test('owner controls remain available only on owner host and announce reminder pause',async()=>{
 await seedCleaner();const result=await call(hub,{host:ownerHost,origin:`https://${ownerHost}`,cookie:adminCookie()});
 assert.equal(result.code,200);assert.equal(result.body.isOwner,true);assert.equal(result.body.cleanerAppPaused,true);assert.equal(result.body.cleanerRemindersPaused,true);assert.equal(result.body.emailCapabilities.scheduling,false);
});

test('HTML routes are paused across alternate hosts, with owner-authenticated exception',async()=>{
 const cookie=adminCookie();
 for(const host of [cleanerHost,ownerHost,'weekscreekhaven.com','preview.vercel.app'])for(const path of ['/cleaner','/cleaner.html']){
  const result=await middleware(new Request(`https://${host}${path}`));assert.equal(result.status,200);assert.match(await result.text(),/temporarily offline/);assert.equal(result.headers.get('cache-control'),'no-store');
 }
 const result=await middleware(new Request(`https://${cleanerHost}/`,{headers:{cookie}}));assert.match(await result.text(),/temporarily offline/);
 const allowed=await middleware(new Request(`https://${ownerHost}/cleaner.html`,{headers:{cookie}}));assert.equal(allowed.headers.get('x-middleware-next'),'1');
 const duplicate=await middleware(new Request(`https://${ownerHost}/cleaner.html`,{headers:{cookie:`wch_admin=%E0%A4%A; wch_admin=stale; ${cookie}`}}));assert.equal(duplicate.headers.get('x-middleware-next'),'1');
 const publicHome=await middleware(new Request('https://weekscreekhaven.com/'));assert.equal(publicHome.headers.get('x-middleware-next'),'1');
 const ownerHome=await middleware(new Request(`https://${ownerHost}/`));assert.match(ownerHome.headers.get('x-middleware-rewrite'),/admin.html/);
 const guestHome=await middleware(new Request('https://guestguide.weekscreekhaven.com/'));assert.equal(guestHome.status,307);
});

test('paused reminders do no storage, emails, claims or backlog mutations',async()=>{
 await seedCleaner();storageFaults.reads=0;storageFaults.failReads=true;const before=[...blobs];
 assert.deepEqual(await processScheduledCleanerEmails(new Date('2030-01-01')), {checked:0,sent:0,attention:0,paused:true});
 assert.equal(await processCleanerReminders(new Date('2030-01-01')),0);
 await assert.rejects(scheduleCleanerEmail({}),/paused/);
 assert.equal(storageFaults.reads,0);assert.deepEqual([...blobs],before);assert.equal(lockCalls.length,0);storageFaults.failReads=false;
});

test('reopening app alone never resumes reminders; explicit cutoff excludes overdue backlog',()=>{
 assert.equal(policy.cleanerRemindersPaused(false,null),true);
 assert.equal(policy.cleanerReminderEligible('2026-12-01T00:00:00Z',false,null),false);
 const cutoff='2026-12-01T00:00:00Z';
 assert.equal(policy.cleanerReminderEligible('2026-11-30T23:59:59Z',false,cutoff),false);
 assert.equal(policy.cleanerReminderEligible(cutoff,false,cutoff),true);
 assert.equal(policy.cleanerReminderEligible('invalid',false,cutoff),false);
 assert.equal(policy.cleanerReminderEligible(cutoff,true,cutoff),false);
});

test('only cleaner email cron stops, physical access/calendar/guest schedule unchanged',async()=>{
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(config.crons,[{path:'/api/admin-calendar-sync',schedule:'*/5 * * * *'},{path:'/api/email-scheduler',schedule:'0 * * * *'},{path:'/api/cleaner-lock-scheduler',schedule:'*/5 * * * *'}]);
 const admin=await readFile(new URL('../admin.html',import.meta.url),'utf8');assert.match(admin,/https:\/\/owner.weekscreekhaven.com\/cleaner.html/);
});
