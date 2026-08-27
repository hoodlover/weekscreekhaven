import { get, list, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';

const PREFIX = 'secure-property/records/';

function token() {
  return process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
}

function ensureConfigured() {
  if (!token()) throw new Error('Private property storage is not configured.');
}

async function readBlob(blob) {
  const result = await get(blob.pathname, { access: 'private', token: token() });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

export async function appendPropertyRecord(record) {
  ensureConfigured();
  const timestamp = new Date(record.createdAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  await put(`${PREFIX}${timestamp}-${crypto.randomUUID()}.json.enc`, encryptRecord(record), {
    access: 'private', token: token(), contentType: 'text/plain; charset=utf-8',
    addRandomSuffix: false, cacheControlMaxAge: 60,
  });
  return record;
}

export async function getContractors() {
  ensureConfigured();
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000, token: token() });
    const values = await Promise.all(page.blobs.map(async (blob) => {
      try { return decryptRecord(await readBlob(blob)); } catch { return null; }
    }));
    records.push(...values.filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  records.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const contractors = new Map();
  for (const record of records) {
    if (record.type === 'contractor_created') contractors.set(record.contractor.id, record.contractor);
    if (record.type === 'contractor_updated' && contractors.has(record.contractor.id)) contractors.set(record.contractor.id, record.contractor);
    if (record.type === 'contractor_removed') contractors.delete(record.contractorId);
  }
  return [...contractors.values()].sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
}
