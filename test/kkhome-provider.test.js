import test from 'node:test';
import assert from 'node:assert/strict';
import { createKKHomeLockProvider } from '../_lib/lock-providers/kkhome.js';

const door = { id:'front', name:'Front door', deviceId:'lock-1' };
const request = { door, code:'482963', startsAt:'2026-11-06T15:45:00-05:00', endsAt:'2026-11-09T11:15:00-05:00' };

test('installs a scheduled code and verifies it before reporting success', async () => {
  const calls=[];
  let keys=[];
  const client = {
    async listDevices() { return [{ id:'lock-1', esn:'LOCK-ESN' }]; },
    async listKeys(esn) { assert.equal(esn,'LOCK-ESN'); return { pwdList:keys }; },
    async insertKey(payload) { calls.push(payload); keys=[{ num:'7', key:'482963', startTime:1793997900, endTime:1794240900 }]; },
  };
  const result = await createKKHomeLockProvider({}, { client }).installCode(request);
  assert.equal(result.status,'installed');
  assert.equal(calls[0].attribute,1);
  assert.equal(calls[0].esn,'LOCK-ESN');
  assert.ok(result.providerCodeId);
});

test('does not insert a duplicate matching scheduled code', async () => {
  let inserts=0;
  const client = {
    async listDevices() { return [{ deviceId:'lock-1', wifiSN:'LOCK-ESN' }]; },
    async listKeys() { return { pwdList:[{ num:'8', pwdValue:'482963', startTime:1793997900, endTime:1794240900 }] }; },
    async insertKey() { inserts+=1; },
  };
  const result = await createKKHomeLockProvider({}, { client }).installCode(request);
  assert.equal(result.status,'installed');
  assert.equal(inserts,0);
});

test('removes the exact saved key and verifies it is absent', async () => {
  let keys=[{ num:'7', key:'482963' }];
  let removed;
  const client = {
    async listDevices() { return [{ id:'lock-1', esn:'LOCK-ESN' }]; },
    async listKeys() { return { pwdList:keys }; },
    async insertKey() { keys=[{ num:'7', key:'482963', startTime:1793997900, endTime:1794240900 }]; },
    async removeKey(payload) { removed=payload; keys=[]; },
  };
  const provider=createKKHomeLockProvider({}, { client });
  const installed=await provider.installCode(request);
  const result=await provider.removeCode({ door, providerCodeId:installed.providerCodeId });
  assert.equal(result.status,'removed');
  assert.equal(removed.params.keyNum,7);
  assert.equal(removed.esn,'LOCK-ESN');
});

test('fails closed when the configured lock cannot be identified', async () => {
  const client={ async listDevices(){ return [{ id:'another-lock', esn:'OTHER' }]; } };
  await assert.rejects(() => createKKHomeLockProvider({}, { client }).installCode(request), /was not found/);
});

test('resolves a lock nested under its Wi-Fi parent', async () => {
  let inserted;
  const client={
    async listDevices(){ return [{ wifiSN:'GATEWAY', subDevices:[{ _id:'lock-1', wifiSN:'LOCK-ESN', mac:'AA', deviceType:'K1' }] }]; },
    async listKeys(){ return { pwdList:inserted ? [{ num:'3', key:'482963', startTime:1793997900, endTime:1794240900 }] : [] }; },
    async insertKey(payload){ inserted=payload; },
  };
  await createKKHomeLockProvider({}, { client, wait:async()=>{} }).installCode(request);
  assert.equal(inserted.esn,'GATEWAY');
  assert.equal(inserted.partSn,'LOCK-ESN');
  assert.equal(inserted.partMac,'AA');
});

test('does not claim removal without a saved provider reference', async () => {
  const provider=createKKHomeLockProvider({}, { client:{} });
  await assert.rejects(() => provider.removeCode({ door }), /reference is missing or invalid/);
});
