import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {isIP} from 'node:net';
import assert from 'node:assert/strict';
let fallbackCalls=0,dnsCalls=0,payload='',capturedOptions,status=200,body={id:'email-test'},dnsError=true,refused=false;
const source=fs.readFileSync(new URL('../_lib/email.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
const context=vm.createContext({URL,Response,Buffer,AbortSignal,isIP,console,process:{env:{RESEND_API_KEY:'test-key',RESEND_FROM_EMAIL:'test@example.com'}},resolve4:async()=>{if(refused)throw Object.assign(Error('DNS refused'),{code:'ECONNREFUSED'});return ['203.0.113.10'];},resolve6:async()=>['2001:db8::1'],fetch:async()=>{if(dnsError)throw Object.assign(new TypeError('fetch failed'),{cause:{code:'EBUSY'}});throw Error('Connection reset after send');},httpsRequest:(url,options,callback)=>{
const isDns=url.hostname==='cloudflare-dns.com';if(isDns){dnsCalls++;assert.equal(options.headers.Authorization,undefined);assert.equal(url.searchParams.get('name'),'api.resend.com');}else{fallbackCalls++;capturedOptions=options;}
const req=new EventEmitter();req.write=value=>{payload=value;};req.end=()=>{options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.ifError(error);assert.equal(addresses[0].family,4);assert.equal(addresses[0].address,isDns?'1.1.1.1':'203.0.113.10');const response=new EventEmitter();response.statusCode=isDns?200:status;response.headers={};callback(response);response.emit('data',Buffer.from(JSON.stringify(isDns?{Status:0,Answer:[{type:1,data:'203.0.113.10'}]}:body)));response.emit('end');});};return req;}});
vm.runInContext(source+';globalThis.send=sendEmail;globalThis.check=checkResendConnection;',context);
const message={to:'cleaner@example.com',cc:['owner@example.com'],subject:'Test only',text:'This runs against an isolated mock.',idempotencyKey:'same-reviewed-request'};
let result=await context.send(message);assert.equal(result.provider,'resend');assert.equal(fallbackCalls,1);assert.equal(capturedOptions.headers['Idempotency-Key'],'same-reviewed-request');assert.deepEqual(JSON.parse(payload).cc,['owner@example.com']);assert.deepEqual(JSON.parse(payload).to,['cleaner@example.com']);assert.equal(capturedOptions.rejectUnauthorized,undefined);
refused=true;result=await context.send(message);assert.equal(result.provider,'resend');assert.equal(dnsCalls,1);assert.equal(capturedOptions.headers['Idempotency-Key'],'same-reviewed-request');
body={data:[]};const healthy=await context.check();assert.equal(healthy.authenticated,true);assert.equal(healthy.dnsMode,'encrypted');assert.equal(dnsCalls,2);
status=401;assert.equal((await context.check()).authenticated,false);status=403;const limited=await context.check();assert.equal(limited.permissionLimited,true);assert.equal(limited.authenticated,null);
dnsError=false;const before=fallbackCalls;await assert.rejects(()=>context.send({to:'cleaner@example.com',subject:'Test',text:'No resend after uncertain connection.'}),/Connection reset/);assert.equal(fallbackCalls,before);
console.log('Passed: EBUSY plus refused DNS recovery via encrypted lookup, TLS-preserving connection, unchanged CC/idempotency, forced fallback health check, and no retry on ambiguous send failure. No real email sent by tests.');

