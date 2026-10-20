import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let owner=true,photos=Array.from({length:100},(_,i)=>({id:String(i),bookingId:'job',purpose:'cleaning'})),uploads=0;
const source=fs.readFileSync(new URL('../api/cleaner-photo.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace('export default async function handler','async function handler');
const context=vm.createContext({Buffer,Response,console,requireAdmin:()=>owner,requireCleaner:()=>({}),cleanerForSession:()=>({cleanerName:'Test'}),sameOriginRequest:()=>true,enforceRateLimit:()=>({allowed:true}),getBookingRequests:async()=>[{id:'job'}],getCleanerState:async()=>({assignments:[],cleaningPhotos:photos}),uploadCleanerPhoto:async(bookingId,b,type,details)=>{const photo={id:'feedback-'+(++uploads),bookingId,...details};photos.push(photo);return photo;},json:(r,status,body)=>({status,body})});
vm.runInContext(source+';globalThis.handler=handler;',context);
const post=purpose=>context.handler({method:'POST',body:{bookingId:'job',purpose,contentType:'image/webp',data:'data:image/webp;base64,YQ=='}},{});
assert.equal((await post('cleaning')).status,400);
for(let n=0;n<5;n++)assert.equal((await post('guest-feedback')).status,201);
assert.equal((await post('guest-feedback')).status,400);
owner=false;assert.equal((await post('guest-feedback')).status,403);
assert.equal(photos.filter(p=>p.purpose==='cleaning').length,100);assert.equal(photos.filter(p=>p.purpose==='guest-feedback').length,5);
console.log('Passed: five optional feedback photos independent of 100 cleaning photos, owner upload permission, and both capacity limits.');

