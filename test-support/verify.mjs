import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {DEFAULT_TURNOVER_CHECKLIST,normalizeTurnoverChecklist} from '../_lib/checklist-defaults.js';
const html=fs.readFileSync(new URL('../cleaner.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new Function(script);
for(const path of ['api/cleaner-hub.js','api/cleaner-photo.js','_lib/cleaner-store.js','_lib/checklist-defaults.js']){
const source=fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');new Function(source.replace(/^import .*;$/gm,'').replace(/export default /g,'').replace(/export /g,''));
}
const prefix=script.slice(0,script.indexOf('const emailTemplates='));
const helpers=script.slice(script.indexOf('function photoSection'),script.indexOf('function checkoutReportBox'));
const checklist=script.slice(script.indexOf('function turnoverChecklist'),script.indexOf('function guestReport'));
const special=script.slice(script.indexOf('function specialRequestSection'),script.indexOf("document.addEventListener('submit',async event=>"));
const simple=special+script.slice(script.indexOf('function simpleAssignmentCard'),script.indexOf('function simplifyCleanerView'));
const context=vm.createContext({document:{getElementById:()=>({})},sessionStorage:{getItem:()=>''},Intl,Date});
vm.runInContext(prefix+helpers+checklist+simple+`;state={isOwner:false,turnoverChecklistMaster:${JSON.stringify(DEFAULT_TURNOVER_CHECKLIST)}};function guestReport(){return ''}function checkoutReportBox(){return ''}function photoWhen(){return ''}function assignmentCard(item){return simpleAssignmentCard(item)}`,context);
const render=item=>vm.runInContext(`simpleAssignmentCard(${JSON.stringify(item)})`,context);
const item={bookingId:'test',cleanDate:'2026-10-21',guests:6,basePayCents:20000,extraPayCents:0,photos:[],status:'scheduled',ownerNote:'<script>bad</script>'};
let markup=render(item);assert.match(markup,/Accept job/);assert.match(markup,/Can't take it/);assert.doesNotMatch(markup,/turnover-checklist-form/);assert.match(markup,/&lt;script&gt;/);
markup=render({...item,status:'accepted'});assert.match(markup,/Start \/ continue cleaning/);assert.match(markup,/Getting the Haven Guest-Ready/);assert.match(markup,/60-75/);assert.match(markup,/5th level/);assert.match(markup,/trails down to the fire pit and creek/);assert.match(markup,/Finish cleaning/);
assert.match(render({...item,status:'declined'}),/You cannot take this job/);
assert.doesNotMatch(render({...item,status:'completed'}),/Finish cleaning/);
vm.runInContext(script.slice(script.indexOf('async function request('),script.indexOf('function notify('))+';cleanerPreview=true;',context);
await assert.rejects(()=>vm.runInContext("request('/api/cleaner-hub',{method:'POST'})",context),/read-only cleaner preview/);
const custom=normalizeTurnoverChecklist([{id:'custom',name:'Custom owner group',tasks:[{id:'linens_wash',title:'Our laundry',detail:'Keep this custom instruction.'}]}]);assert.equal(custom[0].tasks[0].title,'Our laundry');assert.match(custom[0].tasks[0].detail,/Keep this custom instruction/);assert.match(custom[0].tasks[0].detail,/5th level/);
// Execute the real upload callback with a simulated failure after the 40th save.
const uploadSource=script.slice(script.indexOf("document.addEventListener('submit',async e=>{\n const form=e.target.closest('.photo-upload-form')"),script.indexOf("window.addEventListener('beforeunload'"));
let callback,attempts=0,failOnce=true;const received=[];
const form={dataset:{booking:'test'},_photoFiles:Array.from({length:75},(_,i)=>({name:`photo-${i}`,lastModified:1})),_uploadIds:Array.from({length:75},(_,i)=>`id-${i}`),elements:{},querySelector:selector=>selector==='[data-preview]'?null:selector.startsWith('[data-preview=')?null:controls[selector]};
const controls={'.photo-submit':{},'.photo-files':{},'.upload-status':{}};
let loaded=0;const uploadContext=vm.createContext({document:{addEventListener:(type,fn)=>callback=fn},uploadInProgress:false,preparePhoto:async()=>({}),dataUrl:async()=>'',request:async(url,options)=>{attempts++;if(attempts===41&&failOnce){failOnce=false;throw Error('Connection lost');}received.push(JSON.parse(options.body).uploadId)},clearDraft:()=>{},notify:()=>{},load:async()=>loaded++});
vm.runInContext(uploadSource,uploadContext);await callback({target:{closest:()=>form},preventDefault(){}});assert.equal(form._uploaded.size,40);assert.equal(loaded,0);assert.match(controls['.photo-submit'].textContent,/Retry/);
await callback({target:{closest:()=>form},preventDefault(){}});assert.equal(form._uploaded.size,75);assert.equal(new Set(received).size,75);assert.equal(received.length,75);assert.equal(loaded,1);
// Execute photo API against isolated in-memory dependencies.
const photo=fs.readFileSync(new URL('../api/cleaner-photo.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace('export default async function handler','async function handler');
const photoContext=vm.createContext({Buffer,Response,console,requireAdmin:()=>false,requireCleaner:()=>({}),cleanerForSession:()=>({cleanerName:'Test'}),sameOriginRequest:()=>true,enforceRateLimit:(r,k,max)=>{assert.equal(max,250);return{allowed:true}},getBookingRequests:async()=>[{id:'test'}],getCleanerState:async()=>({assignments:[],cleaningPhotos:Array.from({length:75},(_,i)=>({id:`photo-${i}`,bookingId:'test',uploadId:`old-${i}`}))}),uploadCleanerPhoto:async()=>({id:'new'}),json:(r,status,body)=>({status,body})});
vm.runInContext(photo+';globalThis.handler=handler',photoContext);
const body={bookingId:'test',contentType:'image/webp',data:'data:image/webp;base64,YQ==',uploadId:'new-id'};let result=await photoContext.handler({method:'POST',body},{});assert.equal(result.status,201);
result=await photoContext.handler({method:'POST',body:{...body,uploadId:'old-1'}},{});assert.equal(result.status,200);assert.equal(result.body.photo.id,'photo-1');
console.log('Passed: syntax, job stages, escaping, checklist instructions, custom master preservation, 75-photo batch failure/retry without repeat uploads, API capacity and retry deduplication.');

