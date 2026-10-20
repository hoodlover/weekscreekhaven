import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let rows=[],emails=0,asOwner=true;
const state={settings:{},assignments:rows,emailHistory:[],cleanerProfiles:[]};
const context=vm.createContext({console,Buffer,Date,Intl,crypto:{randomUUID:()=>String(rows.length)},requireAdmin:()=>asOwner,requireCleaner:()=>({}),cleanerForSession:()=>({cleanerName:'Test'}),cleanerEmailSendAt:local=>local,sameOriginRequest:()=>true,getCleanerState:async()=>state,appendCleanerRecord:async record=>{let row=rows.find(x=>x.bookingId===record.bookingId);if(!row){row={bookingId:record.bookingId};rows.push(row);}Object.assign(row,record.changes);},syncCleanerLocks:async()=>({status:'ok'}),json:(response,status,body)=>({status,body}),getBookingRequests:async()=>[],requireCleanerProfile:()=>({cleanerEmail:'test@example.com',cleanerName:'Test'}),normalizeEmailCc:()=>[],escapeEmailHtml:x=>x,sendEmail:async()=>{emails++;return{provider:'test'}}});
const source=fs.readFileSync(new URL('../api/cleaner-hub.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace('export default async function handler','async function handler').replace('export const config','const config');
vm.runInContext(source+';globalThis.handler=handler;',context);
const post=body=>context.handler({method:'POST',body},{});
let response=await post({action:'create-cleaning-session',operationId:'same-request',cleanDate:'2026-10-23',sessionLabel:'Test job',basePay:200,guests:5,ownerNote:'N'.repeat(4000)});assert.equal(response.status,200);assert.equal(rows.length,1);assert.equal(rows[0].ownerNote.length,4000);assert.equal(emails,0);
response=await post({action:'create-cleaning-session',operationId:'same-request',cleanDate:'2026-10-23',sessionLabel:'Test job',basePay:200,guests:5});assert.equal(rows.length,1);assert.equal(response.body.alreadyCreated,true);
response=await post({action:'assignment',bookingId:rows[0].bookingId,cleanDate:'2026-10-24',sessionLabel:'Edited job',basePay:225,extraPay:0,guests:6,ownerNote:'A'.repeat(5000),status:'scheduled'});assert.equal(response.status,200);assert.equal(rows[0].cleanDate,'2026-10-24');assert.equal(rows[0].ownerNote.length,5000);assert.equal(rows[0].basePayCents,22500);assert.equal(emails,0);
response=await post({action:'archive-cleaning-session',bookingId:rows[0].bookingId});assert.equal(response.status,200);assert.equal(rows[0].status,'cancelled');assert.ok(rows[0].archivedAt);
response=await post({action:'archive-cleaning-session',bookingId:rows[0].bookingId,restore:true});assert.equal(response.status,200);assert.equal(rows[0].status,'scheduled');assert.equal(rows[0].archivedAt,'');
response=await post({action:'send-email',profileId:'test',bookingId:rows[0].bookingId,subject:'Reviewed test cleaning',body:'This is an isolated test email, not a live message.',operationId:'email-1',confirmed:true});assert.equal(response.status,200);assert.equal(emails,1);
response=await post({action:'send-email',profileId:'test',subject:'Must review',body:'This message must not be sent without review.',operationId:'email-2'});assert.equal(response.status,400);assert.equal(emails,1);
response=await post({action:'special-request',bookingId:rows[0].bookingId,description:'Flowers for Abby',proposedAmount:'25',reminderEnabled:true,reminderLocal:'2026-10-22T16:00'});assert.equal(response.status,200);assert.equal(rows[0].specialRequest.proposedAmountCents,2500);assert.equal(rows[0].specialRequest.reminderLocal,'2026-10-22T16:00');
asOwner=false;response=await post({action:'special-request',bookingId:rows[0].bookingId,actualCost:'35'});assert.equal(response.status,409);rows[0].status='completed';response=await post({action:'special-request',bookingId:rows[0].bookingId,description:'Attempted override',proposedAmount:'1',actualCost:'35',cleanerNote:'Includes the card'});assert.equal(response.status,200);assert.equal(rows[0].specialRequest.description,'Flowers for Abby');assert.equal(rows[0].specialRequest.proposedAmountCents,2500);assert.equal(rows[0].specialRequest.actualCostCents,3500);assert.equal(rows[0].extraPayCents,0);
response=await post({action:'guest-feedback',bookingId:rows[0].bookingId,note:'Unauthorized edit'});assert.equal(response.status,403);
asOwner=true;response=await post({action:'special-request',bookingId:rows[0].bookingId,actualCost:'999',description:'Flowers for Abby',proposedAmount:'25',reminderEnabled:false});assert.equal(rows[0].specialRequest.actualCostCents,3500);response=await post({action:'guest-feedback',bookingId:rows[0].bookingId,note:'Please check under the beds.'});assert.equal(response.status,200);assert.equal(rows[0].guestFeedbackNote,'Please check under the beds.');
response=await post({action:'special-request',bookingId:rows[0].bookingId,description:'Updated flowers request',proposedAmount:'30',reminderEnabled:false});assert.equal(rows[0].specialRequest.actualCostCents,3500);assert.equal(rows[0].specialRequest.proposedAmountCents,3000);assert.equal(rows[0].specialRequest.reminderLocal,'');
response=await post({action:'special-request',bookingId:rows[0].bookingId,description:'Invalid fee',proposedAmount:'-1'});assert.equal(response.status,400);

response=await post({action:'assignment',bookingId:rows[0].bookingId,basePay:225,extraPay:0,status:'scheduled',cleanStartTime:'11:00',cleanEndTime:'15:00'});assert.equal(response.status,200);assert.equal(rows[0].cleanStartTime,'11:00');assert.equal(rows[0].cleanEndTime,'15:00');
response=await post({action:'assignment',bookingId:rows[0].bookingId,basePay:225,extraPay:0,ownerNote:'Preserve window'});assert.equal(rows[0].cleanStartTime,'11:00');
response=await post({action:'assignment',bookingId:rows[0].bookingId,basePay:225,extraPay:0,cleanStartTime:'15:00',cleanEndTime:'11:00'});assert.equal(response.status,400);assert.equal(rows[0].cleanStartTime,'11:00');
response=await post({action:'assignment',bookingId:rows[0].bookingId,basePay:225,extraPay:0,cleanStartTime:'25:00',cleanEndTime:'26:00'});assert.equal(response.status,400);
asOwner=false;response=await post({action:'assignment',bookingId:rows[0].bookingId,status:'accepted',cleanStartTime:'09:00',cleanEndTime:'17:00'});assert.equal(response.status,200);assert.equal(rows[0].cleanStartTime,'11:00');asOwner=true;

rows[0].paidAt='2026-10-01';response=await post({action:'archive-cleaning-session',bookingId:rows[0].bookingId});assert.equal(response.status,409);
console.log('Passed: duplicate request prevention, 5,000-character notes, custom date/title/pay editing, no email on save, recoverable remove/restore, reviewed custom-job email, review requirement and paid-record protection.');



