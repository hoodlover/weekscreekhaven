import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlobRecordReader } from '../_lib/blob-record-cache.js';

const prefix = 'secure-cleaner/records/';
function fixture(count = 0) {
  const originals = new Map();
  let snapshot = null, downloads = 0, writes = 0, failPage = false;
  function add(id, createdAt = id) { originals.set(`${prefix}${id}.json.enc`, { type:'assignment', createdAt, bookingId:id, changes:{ note:'Original history must remain intact.' } }); }
  for (let i = 0; i < count; i++) add(String(i).padStart(6, '0'));
  const reader = () => createBlobRecordReader({ prefix,
    readSnapshot: async () => structuredClone(snapshot),
    writeSnapshot: async value => { snapshot = structuredClone(value); writes++; },
    listPage: async cursor => {
      if (failPage && cursor) throw new Error('listing failed');
      const paths = [...originals.keys()].sort(), start = Number(cursor || 0), end = start + 1000;
      return { blobs:paths.slice(start, end).map(pathname => ({pathname})), hasMore:end < paths.length, cursor:String(end) };
    },
    readRecord: async blob => { downloads++; return structuredClone(originals.get(blob.pathname)); },
  });
  return { originals, reader, add, get downloads(){return downloads;}, get writes(){return writes;}, get snapshot(){return snapshot;}, set snapshot(value){snapshot=value;}, set failPage(value){failPage=value;} };
}

test('15,000 historical events survive cold starts without repeated downloads', async () => {
  const f = fixture(15000), initial = await f.reader()();
  assert.equal(initial.length, 15000);
  assert.equal(f.downloads, 15000);
  const checkpoint = JSON.stringify(f.snapshot);
  assert.ok(checkpoint.length < 2_000_000, 'checkpoint must stay compact');
  for (let i=0; i<3; i++) assert.deepEqual(await f.reader()(), initial);
  assert.equal(f.downloads, 15000, 'new server instances must not download old event files');
  assert.equal(f.writes, 1, 'unchanged history does not rewrite the checkpoint');
  assert.equal(f.originals.size, 15000, 'original history is never removed');
});

test('new and backdated events are found; stale concurrent checkpoint cannot lose history', async () => {
  const f = fixture(1001);
  const before = await f.reader()();
  const stale = structuredClone(f.snapshot);
  f.add('late-write', '000000');
  const after = await f.reader()();
  assert.equal(after.length, 1002);
  assert.equal(f.downloads, 1002);
  assert.equal(after.filter(x=>x.bookingId==='late-write').length, 1);
  f.snapshot = stale; // A slower concurrent writer replaces the checkpoint.
  assert.deepEqual(await f.reader()(), after);
  assert.equal(f.originals.size, before.length + 1);
});

test('parallel readers share bootstrap and do not share mutable state', async () => {
  const f = fixture(20), read = f.reader();
  const [a,b] = await Promise.all([read(), read()]);
  assert.equal(f.downloads, 20);
  a[0].changes.note = 'changed by caller';
  assert.notEqual(a[0].changes.note, b[0].changes.note);
  f.add('new');
  assert.equal((await read()).length, 21, 'sequential reads see new writes immediately');
});

test('failed pagination never publishes a partial checkpoint and can recover', async () => {
  const f = fixture(1001), read = f.reader();
  f.failPage = true;
  await assert.rejects(read(), /listing failed/);
  assert.equal(f.writes, 0);
  f.failPage = false;
  assert.equal((await read()).length, 1001);
});

test('corrupt checkpoint fails closed instead of repeatedly downloading the archive', async () => {
  const f = fixture(100);
  f.snapshot = {version:1, encoding:'gzip-base64', data:'invalid'};
  await assert.rejects(f.reader()());
  assert.equal(f.downloads, 0);
});
