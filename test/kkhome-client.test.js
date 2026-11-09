import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createKKHomeClient } from '../_lib/kkhome-client.js';

test('KK Home primitive and non-JSON replies become actionable provider errors', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const appPrivateKey = privateKey.export({ format:'der', type:'pkcs1' }).toString('base64');
  const replies = [
    { ok:true, status:200, json:async () => ({ data:{ accessToken:'test-token' } }) },
    { ok:true, status:200, json:async () => 'unexpected server response' },
  ];
  const client = createKKHomeClient({
    email:'owner@example.test', password:'test-password', appPrivateKey,
    fetchImpl:async () => replies.shift(),
  });

  await assert.rejects(client.listDevices(), error => {
    assert.equal(error.message, 'KK Home returned an unexpected response.');
    assert.equal(error.operation, 'list');
    return true;
  });
});


test('command response summary redacts all payload values and free text', async () => {
  const { summarizeCommandResponse } = await import('../_lib/kkhome-client.js');
  const summary=summarizeCommandResponse({ code:200, success:true, message:'secret message', token:'secret token', key:'1234', data:{ code:1234, status:'secret status', result:{success:false,errCode:17, pwdValue:'1234'}, keyNum:1234, num:5678, pwdList:[{key:'1234'}] } });
  assert.deepEqual(summary,{kind:'object',success:true,code:200,data:{kind:'object',code:'redacted',status:'redacted',result:{kind:'object',success:false,errCode:17},keyNumPresent:true,numPresent:true,pwdListPresent:true}});
  assert.doesNotMatch(JSON.stringify(summary),/1234|5678|secret/);
  assert.deepEqual(summarizeCommandResponse('secret'),{kind:'string'});
  assert.deepEqual(summarizeCommandResponse([{key:'secret'}]),{kind:'array'});
});

test('response capture observes a caller insert without adding requests or capturing login secrets', async () => {
  const { privateKey } = generateKeyPairSync('rsa', {modulusLength:1024});
  const appPrivateKey=privateKey.export({format:'der',type:'pkcs1'}).toString('base64');
  const responses=[{code:200,data:{accessToken:'secret-token'}},{code:200,data:{success:false,errCode:17,message:'secret error',pwdValue:'1234'}}];
  const captures=[], paths=[];
  const client=createKKHomeClient({email:'owner@example.test',password:'secret-password',appPrivateKey,onCommandResponse:s=>captures.push(s),fetchImpl:async url=>{paths.push(new URL(url).pathname);return {ok:true,status:200,json:async()=>responses.shift()};}});
  const result=await client.insertKey({key:'1234'});
  assert.equal(result.success,false); // Capture must not reinterpret provider semantics.
  assert.equal(paths.length,2);
  assert.equal(captures.length,1);
  assert.equal(captures[0].response.data.errCode,17);
  assert.doesNotMatch(JSON.stringify(captures),/secret|1234|owner@example/);
});
