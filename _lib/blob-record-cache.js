import { gzipSync, gunzipSync } from 'node:zlib';

// A lossless, encrypted-at-rest checkpoint of immutable events. Originals remain
// authoritative: list every page, but download only events absent from the cache.
// Exact paths (not timestamps) also catch backdated and concurrent writes.
export function createBlobRecordReader({ prefix, listPage, readRecord, readSnapshot, writeSnapshot }) {
  let pending;
  async function refresh() {
    const snapshot = await readSnapshot();
    let entries = [];
    if (snapshot) {
      if (snapshot.version !== 1 || snapshot.encoding !== 'gzip-base64') throw new Error('Unsupported cleaner record checkpoint.');
      entries = JSON.parse(gunzipSync(Buffer.from(snapshot.data, 'base64')).toString('utf8'));
      if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0].startsWith(prefix) || !entry[1] || typeof entry[1] !== 'object')) throw new Error('Invalid cleaner record checkpoint.');
    }
    const known = new Map(entries);
    const live = new Map();
    let cursor;
    let added = 0;
    do {
      const page = await listPage(cursor);
      // Reserve insertion order before concurrent I/O, matching list/Promise.all
      // replay semantics even when events share the same createdAt timestamp.
      for (const blob of page.blobs) live.set(blob.pathname, undefined);
      // Bound concurrent downloads during the one-time checkpoint bootstrap.
      for (let offset = 0; offset < page.blobs.length; offset += 32) {
        await Promise.all(page.blobs.slice(offset, offset + 32).map(async blob => {
          if (known.has(blob.pathname)) {
            live.set(blob.pathname, known.get(blob.pathname));
          } else {
            const record = await readRecord(blob);
            if (!record || typeof record !== 'object') throw new Error('A cleaner history record could not be loaded.');
            live.set(blob.pathname, record);
            added++;
          }
        }));
      }
      if (page.hasMore && (!page.cursor || page.cursor === cursor)) throw new Error('Cleaner history pagination did not advance.');
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    // Preserve the old stable event ordering for records with equal timestamps.
    const ordered = [...live];
    if (!snapshot || added || live.size !== known.size) {
      await writeSnapshot({ version: 1, encoding: 'gzip-base64', data: gzipSync(JSON.stringify(ordered)).toString('base64') });
      console.info('Cleaner history checkpoint refreshed', { records: live.size, downloaded: added });
    }
    return ordered.map(([, record]) => record).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  async function readRecords() {
    // Concurrent callers share work, but sequential reads always check new writes.
    if (!pending) {
      const task = refresh().finally(() => { if (pending === task) pending = undefined; });
      pending = task;
    }
    return structuredClone(await pending);
  }
  readRecords.invalidate = () => { pending = undefined; };
  return readRecords;
}
