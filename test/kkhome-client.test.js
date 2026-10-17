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
