import { registerHooks } from 'node:module';
import crypto from 'node:crypto';

// In-memory Blob transport: exercise real encryption, storage replay, and API handlers.
// No production credentials or external services are used by these tests.
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.INVITE_BLOB_READ_WRITE_TOKEN = 'test-only-in-memory';
globalThis.fetch = async () => { throw new Error('Unexpected external request in cleaner test'); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@vercel/blob' || specifier === 'test:cleaner-blob') return { url: 'test:cleaner-blob', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== 'test:cleaner-blob') return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export const blobs = new Map();
      export async function put(pathname, data, options) { blobs.set(pathname, { data, ...options }); return { pathname }; }
      export async function get(pathname) { const blob=blobs.get(pathname);return blob?{statusCode:200,blob,stream:new Response(blob.data).body}:null; }
      export async function list({prefix}) { return {blobs:[...blobs.keys()].filter(pathname=>pathname.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false}; }
      export async function del(pathname) { blobs.delete(pathname); }
    ` };
  },
});

export const { default: hub } = await import('../api/cleaner-hub.js');
export const { default: login } = await import('../api/cleaner-login.js');
export const { default: photo } = await import('../api/cleaner-photo.js');
export const { appendCleanerRecord, getCleanerState } = await import('../_lib/cleaner-store.js');
export const { createSession, hashPasscode } = await import('../_lib/security.js');
export const { blobs } = await import('test:cleaner-blob');

export async function seedCleaner() {
  blobs.clear();
  const access = hashPasscode('original-test-code');
  await appendCleanerRecord({ type: 'settings', createdAt: '2026-01-01T00:00:00.000Z', changes: { cleanerName: 'Original Cleaner', cleanerEmail: 'original@example.test', passcodeHash: access.hash, passcodeSalt: access.salt, cleanerAuthVersion: 'original-version', doorCode: '739426', closetCode: '412' } });
}

export function adminCookie() { return `wch_admin=${createSession({ role: 'admin' }, 3600)}`; }
export async function call(handler, { method = 'GET', cookie = '', body = {}, query = { readOnly: '1' }, origin = 'https://cleaner.example.test' } = {}) {
  const response = { code: 0, headers: {}, body: null, status(code) { this.code=code;return this; }, setHeader(key,value) { this.headers[key]=value; }, json(body) { this.body=body;return this; }, end(body) { this.body=body;return this; } };
  await handler({ method, body, query, headers: { host: 'cleaner.example.test', origin, cookie, 'x-forwarded-for': '127.0.0.1' } }, response);
  return response;
}
