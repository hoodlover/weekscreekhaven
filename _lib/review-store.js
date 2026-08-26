import { get, list, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';

const PREFIX = 'secure-reviews/records/';

function token() {
  return process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
}

function ensureConfigured() {
  if (!token()) throw new Error('Review storage is not configured.');
}

async function readBlob(blob) {
  const result = await get(blob.pathname, { access: 'private', token: token() });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

export async function appendReview(review) {
  ensureConfigured();
  const timestamp = new Date(review.createdAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  await put(`${PREFIX}${timestamp}-${crypto.randomUUID()}.json.enc`, encryptRecord(review), {
    access: 'private', token: token(), contentType: 'text/plain; charset=utf-8',
    addRandomSuffix: false, cacheControlMaxAge: 60,
  });
  return review;
}

export async function getReviews() {
  ensureConfigured();
  const reviews = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000, token: token() });
    const values = await Promise.all(page.blobs.map(async (blob) => {
      try { return decryptRecord(await readBlob(blob)); } catch { return null; }
    }));
    reviews.push(...values.filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return reviews.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
