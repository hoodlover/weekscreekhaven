import { get, list, put, del } from '@vercel/blob';
import { encryptRecord, decryptRecord } from './security.js';
const prefix = 'secure-owner-locks/entries/';
const token = () => process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
export async function ownerLockEntries() {
  const entries = []; let cursor;
  do {
    const page = await list({ token: token(), prefix, cursor, limit: 1000 });
    entries.push(...await Promise.all(page.blobs.map(async blob => {
      const value = await get(blob.pathname, { token: token(), access: 'private', useCache: false });
      if (!value || value.statusCode !== 200) throw new Error('An access record could not be read.');
      return decryptRecord(await new Response(value.stream).text());
    })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return entries.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveOwnerLock(entry) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(entry.id)) throw new Error('Invalid access record.');
  await put(`${prefix}${entry.id}.enc`, encryptRecord(entry), { token: token(), access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' });
}
export async function withOwnerLockLease(work) {
  const path = 'secure-owner-locks/lease.json';
  const existing = await get(path, { token: token(), access: 'private', useCache: false });
  if (existing?.statusCode === 200) {
    if (JSON.parse(await new Response(existing.stream).text()).expiresAt > Date.now()) throw new Error('Another lock update is running. Try again shortly.');
    await del(path, { token: token(), ifMatch: existing.blob.etag });
  }
  const lease = await put(path, JSON.stringify({ expiresAt: Date.now() + 300000 }), { token: token(), access: 'private', addRandomSuffix: false, allowOverwrite: false });
  try { return await work(); } finally { await del(path, { token: token(), ifMatch: lease.etag }).catch(() => {}); }
}
