import { registerHooks } from 'node:module';
import crypto from 'node:crypto';

// In-memory Blob transport: exercise real encryption, storage replay, and API handlers.
// No production credentials or external services are used by these tests.
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.INVITE_BLOB_READ_WRITE_TOKEN = 'test-only-in-memory';
process.env.LOCK_PROVIDER = 'manual';
process.env.KKHOME_LIVE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('Unexpected external request in cleaner test'); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/lock-providers/kkhome.js') || specifier === 'test:cleaner-lock-provider') return { url: 'test:cleaner-lock-provider', shortCircuit: true };
    if (specifier === '@vercel/blob' || specifier === 'test:cleaner-blob') return { url: 'test:cleaner-blob', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:cleaner-lock-provider') return { format: 'module', shortCircuit: true, source: `
      export const lockCalls = [], lockEntries = new Map(), lockFailures = new Set();
      export function createKKHomeLockProvider() { return {
        async findCode({door,code}) { lockCalls.push({action:'find',door:door.id,code});return lockEntries.get(door.id+':'+code) || null; },
        async installCode(input) { lockCalls.push({action:'install',...input}); if(lockFailures.has(input.door.id)) throw new Error('Simulated door failure');const entry={status:'installed',providerCodeId:input.providerCodeId || input.door.id+':'+input.code};lockEntries.set(input.door.id+':'+input.code,entry);return entry; },
        async removeCode(input) { lockCalls.push({action:'remove',...input});if(lockFailures.has(input.door.id))throw new Error('Simulated door failure');lockEntries.delete(input.door.id+':'+input.code);return {status:'removed'}; }
      }; }
    ` };
    if (url !== 'test:cleaner-blob') return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export const blobs = new Map();
      let serial=0;
      export async function put(pathname, data, options) { if(options.allowOverwrite===false && blobs.has(pathname))throw new Error('Blob already exists');const etag=String(++serial);blobs.set(pathname, { data, ...options, etag }); return { pathname, etag }; }
      export async function get(pathname) { const blob=blobs.get(pathname);return blob?{statusCode:200,blob,stream:new Response(blob.data).body}:null; }
      export async function list({prefix}) { return {blobs:[...blobs.keys()].filter(pathname=>pathname.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false}; }
      export async function del(pathname,options={}) { if(options.ifMatch && options.ifMatch!==blobs.get(pathname)?.etag)throw new Error('Precondition failed');blobs.delete(pathname); }
    ` };
  },
});

export const { default: hub } = await import('../api/cleaner-hub.js');
export const { default: login } = await import('../api/cleaner-login.js');
export const { default: photo } = await import('../api/cleaner-photo.js');
export const { appendCleanerRecord, getCleanerState } = await import('../_lib/cleaner-store.js');
export const { createSession, hashPasscode } = await import('../_lib/security.js');
export const { blobs } = await import('test:cleaner-blob');
export const { lockCalls, lockEntries, lockFailures } = await import('test:cleaner-lock-provider');

export async function seedCleaner() {
  blobs.clear();
  lockCalls.length=0;lockEntries.clear();lockFailures.clear();process.env.LOCK_PROVIDER='manual';process.env.KKHOME_LIVE_ENABLED='false';
  const access = hashPasscode('original-test-code');
  await appendCleanerRecord({ type: 'settings', createdAt: '2026-01-01T00:00:00.000Z', changes: { cleanerName: 'Original Cleaner', cleanerEmail: 'original@example.test', passcodeHash: access.hash, passcodeSalt: access.salt, cleanerAuthVersion: 'original-version', doorCode: '739426', closetCode: '412' } });
}

export function adminCookie() { return `wch_admin=${createSession({ role: 'admin' }, 3600)}`; }
export async function call(handler, { method = 'GET', cookie = '', body = {}, query = { readOnly: '1' }, origin = 'https://cleaner.example.test' } = {}) {
  const response = { code: 0, headers: {}, body: null, status(code) { this.code=code;return this; }, setHeader(key,value) { this.headers[key]=value; }, json(body) { this.body=body;return this; }, end(body) { this.body=body;return this; } };
  await handler({ method, body, query, headers: { host: 'cleaner.example.test', origin, cookie, 'x-forwarded-for': '127.0.0.1' } }, response);
  return response;
}
