import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hub, seedCleaner, adminCookie, call, blobs, storageFaults, createSession, appendCleanerRecord } from '../test-support/cleaner-fixture.js';
const { cleanerEmailSendAt, scheduleCleanerEmail, cancelCleanerEmail, listCleanerEmailJobs, processScheduledCleanerEmails } = await import('../_lib/cleaner-email-jobs.js');
const { normalizeEmailCc, sendEmail } = await import('../_lib/email.js');
const { decryptRecord } = await import('../_lib/security.js');
const { default: scheduler } = await import('../api/cleaner-email-scheduler.js');

const now = new Date('2026-10-20T12:00:00Z'), due = new Date('2026-10-22T20:00:00Z');
const base = { operationId: 'scheduled-email-test-001', profileId: 'legacy-cleaner', to: 'original@example.test', toName: 'Original Cleaner',
  cc: 'copy@example.test', subject: 'Cabin care reminder', body: 'Please check the supplies during your next visit. Thank you!',
  sendLocal: '2026-10-22T16:00', timeZone: 'America/New_York', templateId: 'custom' };
let deliveries;
async function setup() {
  await seedCleaner(); deliveries=[];
  process.env.RESEND_API_KEY='test-only';process.env.RESEND_FROM_EMAIL='owner@example.test';
  process.env.CRON_SECRET='test-cron-secret';
  delete process.env.SENDER_API_TOKEN;delete process.env.SENDER_FROM_EMAIL;
  globalThis.fetch=async(url, options)=>{deliveries.push({url,options,body:JSON.parse(options.body)});return new Response(JSON.stringify(String(url).includes('sender.net')?{success:true,emailId:'sender-test-id'}:{id:'provider-test-id'}),{status:200});};
}

test('Eastern schedules are independent of the device zone, with DST gaps, overlaps, invalid dates and zones rejected',()=>{
  assert.equal(cleanerEmailSendAt('2026-10-22T16:00'),'2026-10-22T20:00:00.000Z');
  assert.equal(cleanerEmailSendAt('2026-12-22T16:00'),'2026-12-22T21:00:00.000Z');
  assert.throws(()=>cleanerEmailSendAt('2027-03-14T02:30'),/does not exist/);
  assert.throws(()=>cleanerEmailSendAt('2026-11-01T01:30'),/happens twice/);
  assert.throws(()=>cleanerEmailSendAt('2026-02-30T12:00'),/does not exist/);
  assert.throws(()=>cleanerEmailSendAt('2026-10-22T16:00','UTC'),/Eastern/);
  assert.throws(()=>cleanerEmailSendAt('2026-10-22'),/complete/);
});

test('CC is validated, deduplicated, excludes To, and is transmitted as real Resend CC',async()=>{
  await setup();
  assert.deepEqual(normalizeEmailCc('ONE@example.test; one@example.test, original@example.test','ORIGINAL@example.test'),['ONE@example.test']);
  for(const cc of ['broken','x@example.test\r\nBcc: bad@example.test','x@example.test,',null,Array(11).fill('x@example.test')])assert.throws(()=>normalizeEmailCc(cc));
  await sendEmail({to:base.to,cc:base.cc,subject:base.subject,text:base.body,idempotencyKey:'same-id'});
  assert.deepEqual(deliveries[0].body.cc,['copy@example.test']);assert.deepEqual(deliveries[0].body.to,[base.to]);
  assert.equal(deliveries[0].options.headers['Idempotency-Key'],'same-id');
  delete process.env.RESEND_API_KEY;process.env.SENDER_API_TOKEN='test-only';process.env.SENDER_FROM_EMAIL='owner@example.test';
  await assert.rejects(sendEmail({to:base.to,cc:base.cc,subject:base.subject,text:base.body}),/CC requires/);
  assert.equal(deliveries.length,1);
  await sendEmail({to:base.to,subject:base.subject,text:base.body});assert.equal(deliveries.length,2);
});

test('scheduled jobs are encrypted, immutable snapshots, idempotently created and never sent early',async()=>{
  await setup();
  const results=await Promise.all(Array.from({length:8},()=>scheduleCleanerEmail(base,now)));
  assert.ok(results.every(job=>job.id===base.operationId));assert.equal((await listCleanerEmailJobs()).length,1);
  assert.ok([...blobs.values()].every(blob=>!String(blob.data).includes(base.body)));
  await assert.rejects(scheduleCleanerEmail({...base,body:'Different reviewed content altogether.'},now),/different email/);
  assert.equal((await processScheduledCleanerEmails(new Date('2026-10-22T19:59:59Z'))).sent,0);assert.equal(deliveries.length,0);
  const job=(await listCleanerEmailJobs())[0];assert.deepEqual(job.cc,['copy@example.test']);assert.equal(job.fingerprint,undefined);assert.equal(job.attemptId,undefined);
});

test('concurrent cron invocations send exactly one provider request and never resend after 24 hours',async()=>{
  await setup();await scheduleCleanerEmail(base,now);
  await Promise.all(Array.from({length:12},()=>processScheduledCleanerEmails(due)));
  assert.equal(deliveries.length,1);assert.equal(deliveries[0].options.headers['Idempotency-Key'],`cleaner-scheduled-${base.operationId}`);
  const job=(await listCleanerEmailJobs())[0];assert.equal(job.status,'sent');assert.equal(job.providerMessageId,'provider-test-id');
  await processScheduledCleanerEmails(new Date('2026-11-22T20:00:00Z'));assert.equal(deliveries.length,1);
  assert.equal((await scheduleCleanerEmail(base,new Date('2026-11-22T20:00:00Z'))).status,'sent');
});

test('cancellation races safely with dispatch; a cancelled email never sends and started emails cannot be cancelled',async()=>{
  await setup();await scheduleCleanerEmail(base,now);
  await Promise.allSettled([cancelCleanerEmail(base.operationId,due),processScheduledCleanerEmails(due)]);
  const job=(await listCleanerEmailJobs())[0];assert.ok(['cancelled','sent'].includes(job.status));
  assert.equal(deliveries.length,job.status==='cancelled'?0:1);
  await processScheduledCleanerEmails(due);assert.ok(deliveries.length<=1);
  if(job.status==='sent')await assert.rejects(cancelCleanerEmail(base.operationId,due),/already started/);
  else assert.equal((await cancelCleanerEmail(base.operationId,due)).status,'cancelled');
});

test('ambiguous create is reconciled using the same immutable job ID',async()=>{
  await setup();storageFaults.afterPut=(path,data)=>{if(path.includes('/email-jobs/')&&decryptRecord(data).status==='queued')throw new Error('Response lost after commit');};
  assert.equal((await scheduleCleanerEmail(base,now)).status,'queued');storageFaults.afterPut=null;
  assert.equal((await listCleanerEmailJobs()).length,1);assert.equal(deliveries.length,0);
});

test('an unreadable historical record is visible as attention but does not block a due email',async()=>{
  await setup();await scheduleCleanerEmail(base,now);
  blobs.set('secure-cleaner/email-jobs/damaged-record-001.enc',{data:'not-valid-encrypted-data',etag:'broken'});
  const jobs=await listCleanerEmailJobs();assert.equal(jobs.length,2);assert.equal(jobs.find(job=>job.id==='damaged-record-001').status,'attention');
  await processScheduledCleanerEmails(due);assert.equal(deliveries.length,1);
});

test('lost claim response/crash before send never reclaims or sends, even after the provider idempotency window',async()=>{
  await setup();await scheduleCleanerEmail(base,now);
  storageFaults.afterPut=(path,data)=>{if(path.includes('/email-jobs/')&&decryptRecord(data).status==='sending')throw new Error('Response lost after claim');};
  await processScheduledCleanerEmails(due);storageFaults.afterPut=null;
  await processScheduledCleanerEmails(new Date('2026-11-22T20:00:00Z'));assert.equal(deliveries.length,0);
  assert.equal((await listCleanerEmailJobs(new Date('2026-10-22T20:11:00Z')))[0].status,'attention');
  await assert.rejects(cancelCleanerEmail(base.operationId),/already started/);
});

test('provider acceptance followed by lost response is attention, not a retryable failure',async()=>{
  await setup();await scheduleCleanerEmail(base,now);
  globalThis.fetch=async()=>{deliveries.push({accepted:true});throw new Error('Response lost');};
  await processScheduledCleanerEmails(due);assert.equal((await listCleanerEmailJobs())[0].status,'attention');
  await processScheduledCleanerEmails(new Date('2026-10-24T20:00:00Z'));assert.equal(deliveries.length,1);
});

test('final status persistence failure never duplicates a provider-accepted email',async()=>{
  await setup();await scheduleCleanerEmail(base,now);
  storageFaults.beforePut=(path,data)=>{if(path.includes('/email-jobs/')&&decryptRecord(data).status==='sent')throw new Error('Storage unavailable after send');};
  await processScheduledCleanerEmails(due);storageFaults.beforePut=null;
  await processScheduledCleanerEmails(new Date('2026-10-24T20:00:00Z'));assert.equal(deliveries.length,1);
  assert.equal((await listCleanerEmailJobs(new Date('2026-10-24T20:00:00Z')))[0].status,'attention');
});

test('malformed provider success is attention; Sender no-CC requires success and emailId',async()=>{
  await setup();await scheduleCleanerEmail(base,now);globalThis.fetch=async()=>new Response('{}',{status:200});
  await processScheduledCleanerEmails(due);assert.equal((await listCleanerEmailJobs())[0].status,'attention');
  await setup();delete process.env.RESEND_API_KEY;process.env.SENDER_API_TOKEN='test';process.env.SENDER_FROM_EMAIL='owner@example.test';
  await assert.rejects(scheduleCleanerEmail(base,now),/CC requires/);
  await scheduleCleanerEmail({...base,cc:[]},now);
  globalThis.fetch=async()=>new Response(JSON.stringify({success:true,emailId:'sender-test-id'}),{status:200});
  await processScheduledCleanerEmails(due);const job=(await listCleanerEmailJobs())[0];assert.equal(job.status,'sent');assert.equal(job.providerMessageId,'sender-test-id');
});

test('owner-only API binds the recipient to the selected profile, hides content from cleaners, preserves immediate CC',async()=>{
  await setup();const cookie=adminCookie();
  const future=new Date(Date.now()+86400000);const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(future).map(p=>[p.type,p.value]));
  const body={...base,action:'schedule-email',confirmed:true,to:'injected@example.test',sendLocal:`${parts.year}-${parts.month}-${parts.day}T16:00`};
  const cleanerCookie=`wch_cleaner=${createSession({role:'cleaner',authVersion:'original-version'},3600)}`;
  assert.equal((await call(hub,{method:'POST',cookie:cleanerCookie,body})).code,403);
  assert.equal((await call(hub,{method:'POST',cookie,origin:'https://evil.example.test',body})).code,403);
  assert.equal((await call(hub,{method:'POST',cookie,body:{...body,confirmed:false}})).code,400);
  const saved=await call(hub,{method:'POST',cookie,body});assert.equal(saved.code,200);assert.equal(saved.body.email.to,base.to);assert.equal(deliveries.length,0);
  await appendCleanerRecord({type:'settings',changes:{cleanerEmail:'changed@example.test'}});
  assert.equal((await listCleanerEmailJobs())[0].to,base.to);
  const view=await call(hub,{cookie:cleanerCookie});assert.equal(view.body.scheduledEmails,undefined);assert.ok(!JSON.stringify(view.body).includes(base.body));
  assert.equal((await call(hub,{cookie})).body.scheduledEmails.length,1);
  assert.equal((await call(hub,{method:'POST',cookie:cleanerCookie,body:{action:'cancel-scheduled-email',emailId:base.operationId}})).code,403);
  assert.equal((await call(hub,{method:'POST',cookie,body:{action:'cancel-scheduled-email',emailId:base.operationId}})).code,200);
  const immediate=await call(hub,{method:'POST',cookie,body:{...base,action:'send-email',confirmed:true}});assert.equal(immediate.code,200);assert.equal(deliveries.length,1);assert.deepEqual(deliveries[0].body.cc,['copy@example.test']);
});

test('scheduler requires its secret and GET; invalid/past/too-far schedules create nothing',async()=>{
  await setup();process.env.CRON_SECRET='test-cron-secret';
  const invoke=async(headers,method='GET')=>{const response={status(code){this.code=code;return this;},setHeader(){},json(body){this.body=body;return this;}};await scheduler({headers,method},response);return response;};
  assert.equal((await invoke({})).code,401);assert.equal((await invoke({authorization:'Bearer test-cron-secret'},'POST')).code,405);
  assert.equal((await invoke({authorization:'Bearer test-cron-secret'})).code,200);
  for(const bad of [{operationId:'bad'},{operationId:12345678},{to:'not-an-email'},{cc:'bad'},{subject:'Hi'},{body:'short'},{sendLocal:'2026-10-19T16:00'},{sendLocal:'2028-10-22T16:00'}])await assert.rejects(scheduleCleanerEmail({...base,...bad},now));
  assert.equal((await listCleanerEmailJobs()).length,0);assert.equal(deliveries.length,0);
  delete process.env.CRON_SECRET;await assert.rejects(scheduleCleanerEmail(base,now),/not configured/);
});

test('new cron is separate from unchanged hourly guest scheduling; UI exposes CC, Eastern schedule and cancellation',async()=>{
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.crons.find(item=>item.path==='/api/email-scheduler').schedule,'0 * * * *');
  assert.equal(config.crons.find(item=>item.path==='/api/cleaner-email-scheduler').schedule,'*/5 * * * *');
  const page=await readFile(new URL('../cleaner.html',import.meta.url),'utf8');
  for(const marker of ['id="email-cc"','id="email-send-at"','America/New_York','data-cancel-email','sessionStorage.setItem(key'])assert.ok(page.includes(marker));
});

test('a queued job email is held for review when the assigned cleaner changes',async()=>{
 await setup();
 await appendCleanerRecord({type:'assignment',bookingId:'custom-reassigned',createdAt:now.toISOString(),changes:{customSession:true,cleanDate:'2026-10-23',cleanerId:'legacy-cleaner'}});
 await scheduleCleanerEmail({...base,bookingId:'custom-reassigned'},now);
 await appendCleanerRecord({type:'assignment',bookingId:'custom-reassigned',createdAt:now.toISOString(),changes:{cleanerId:'another-cleaner'}});
 const summary=await processScheduledCleanerEmails(due);
 assert.equal(summary.sent,0);assert.equal(summary.attention,1);assert.equal(deliveries.length,0);
 assert.match((await listCleanerEmailJobs(due))[0].statusNote,/assigned cleaner changed/);
});
