import { get, list, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';

const INVITE_PREFIX = 'secure-invites/records/';
const ACCESS_PREFIX = 'secure-invites/access/';

function token() {
  return process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
}

function access() {
  return process.env.INVITE_BLOB_ACCESS === 'private' ? 'private' : 'public';
}

function ensureConfigured() {
  if (!token()) throw new Error('Invite storage is not configured.');
}

async function readBlob(blob) {
  if (access() === 'private') {
    const result = await get(blob.pathname, { access: 'private', token: token() });
    if (!result || result.statusCode !== 200) return null;
    return new Response(result.stream).text();
  }
  const response = await fetch(blob.url, { cache: 'no-store' });
  if (!response.ok) return null;
  return response.text();
}

async function readRecords(prefix) {
  ensureConfigured();
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000, token: token() });
    const pageRecords = await Promise.all(page.blobs.map(async (blob) => {
      try {
        const encrypted = await readBlob(blob);
        return encrypted ? decryptRecord(encrypted) : null;
      } catch {
        return null;
      }
    }));
    records.push(...pageRecords.filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return records;
}

async function append(prefix, record) {
  ensureConfigured();
  const sortableTime = new Date(record.createdAt || record.accessedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  const pathname = `${prefix}${sortableTime}-${crypto.randomUUID()}.json.enc`;
  await put(pathname, encryptRecord(record), {
    access: access(),
    token: token(),
    contentType: 'text/plain; charset=utf-8',
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  return record;
}

export async function appendInviteRecord(record) {
  return append(INVITE_PREFIX, record);
}

export async function appendAccessRecord(record) {
  return append(ACCESS_PREFIX, record);
}

export async function getInvites() {
  const records = await readRecords(INVITE_PREFIX);
  records.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const invites = new Map();
  for (const record of records) {
    if (record.type === 'created') invites.set(record.invite.id, record.invite);
    if (record.type === 'revoked' && invites.has(record.inviteId)) {
      invites.get(record.inviteId).revokedAt = record.createdAt;
    }
  }
  return [...invites.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAccessRecords() {
  const records = await readRecords(ACCESS_PREFIX);
  return records.sort((a, b) => b.accessedAt.localeCompare(a.accessedAt));
}
