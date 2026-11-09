import test from 'node:test';
import assert from 'node:assert/strict';
import { createLockStatusHandler } from '../api/admin-lock-status.js';
import { createSession } from '../_lib/security.js';

process.env.SESSION_SECRET = 'lock-status-test-secret-with-at-least-32-characters';
const env = { KKHOME_EMAIL: 'owner@example.com', KKHOME_PASSWORD: 'private-password', KKHOME_APP_PRIVATE_KEY: 'private-key',
  LOCK_DOORS_JSON: JSON.stringify([{ id: 'front', name: 'Front door', deviceId: 'front-123' }]) };
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; }, json(v) { this.body = v; } };
}
function request() { return { method: 'POST', headers: { cookie: `wch_admin=${createSession({ role: 'admin' }, 60)}` } }; }

test('connection check rejects unauthenticated requests without contacting KK Home', async () => {
  const res = response();
  await createLockStatusHandler({ env, clientFactory() { assert.fail('must not contact provider'); } })({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('connection check only returns configured door matches and no raw device details', async () => {
  const res = response();
  await createLockStatusHandler({ env, clientFactory: () => ({ listDevices: async () => ({ data: [{ esn: 'front-123', token: 'secret-token', pwd: '123456' }] }) }) })(request(), res);
  assert.equal(res.body.allDoorsFound, true);
  assert.deepEqual(res.body.doors, [{ id: 'front', name: 'Front door', found: true, matches: 1 }]);
  assert.doesNotMatch(JSON.stringify(res.body), /secret-token|123456|private-password/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('connection check hides provider errors that might contain credentials', async () => {
  const res = response();
  await createLockStatusHandler({ env, clientFactory: () => ({ listDevices: async () => { throw new Error('private-password'); } }) })(request(), res);
  assert.equal(res.body.connected, false);
  assert.doesNotMatch(JSON.stringify(res.body), /private-password/);
});

test('connection check blocks requests that could change a lock', async () => {
  const res = response();
  await createLockStatusHandler({ env, fetchImpl: () => assert.fail('must not send request'), clientFactory: ({ fetchImpl }) => ({
    listDevices: () => fetchImpl('https://api.kksecurityhome.com/v3/device/insert-pwd', {}),
  }) })(request(), res);
  assert.equal(res.body.connected, false);
});


test('opt-in diagnostics return only status fields and inventory count', async () => {
  const res = response();
  const req = { ...request(), url: '/api/admin-lock-status?diagnostics=1' };
  await createLockStatusHandler({ env, clientFactory: () => ({
    listDevices: async () => [{ esn:'front-123', online:true, status:1, token:'secret-token', battery:99 }],
    listKeys: async esn => { assert.equal(esn,'front-123'); return {pwdList:[{num:1,pwdValue:'secret-pin',nickName:'Private name'}]}; },
  }) })(req,res);
  assert.deepEqual(res.body.doors[0].deviceStatus,{online:true,status:1});
  assert.deepEqual(res.body.doors[0].keyInventory,{readable:true,count:1,entries:[{num:1,pinRecorded:true,nameRecorded:true}]});
  assert.doesNotMatch(JSON.stringify(res.body),/secret-token|secret-pin|Private name|front-123|battery/);
});

test('diagnostics distinguish unknown list format from an empty inventory', async () => {
  for (const [payload, expected] of [[{}, {readable:false,format:'unrecognized'}], [[], {readable:true,count:0,entries:[]}]]) {
    const res=response();
    await createLockStatusHandler({ env,clientFactory:()=>({listDevices:async()=>[{esn:'front-123'}],listKeys:async()=>payload}) })({...request(),url:'/?diagnostics=1'},res);
    assert.deepEqual(res.body.doors[0].keyInventory,expected);
  }
});

test('diagnostics hide key-list errors and retain device results', async () => {
  const res=response();
  await createLockStatusHandler({env,clientFactory:()=>({listDevices:async()=>[{esn:'front-123'}],listKeys:async()=>{throw Error('secret-pin');}})})({...request(),url:'/?diagnostics=1'},res);
  assert.equal(res.body.connected,true);
  assert.deepEqual(res.body.doors[0].keyInventory,{readable:false,failure:'key_list_failed'});
  assert.doesNotMatch(JSON.stringify(res.body),/secret-pin/);
});

test('diagnostics cannot send physical commands through the guarded fetch', async () => {
  const res=response();
  await createLockStatusHandler({ env, fetchImpl:()=>assert.fail('must not contact provider'), clientFactory:({fetchImpl})=>({
    listDevices:()=>fetchImpl('https://api.kksecurityhome.com/v3/device/insert-pwd',{}),
  }) })({...request(),url:'/?diagnostics=1'},res);
  assert.equal(res.body.connected,false);
});

test('default status check never requests keys', async () => {
  const res=response();
  await createLockStatusHandler({env,clientFactory:()=>({listDevices:async()=>[{esn:'front-123'}],listKeys:()=>assert.fail('not opted in')})})(request(),res);
  assert.equal(res.body.connected,true);
});
