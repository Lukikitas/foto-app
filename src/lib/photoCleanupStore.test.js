import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as retention from './photoRetention.js';
import * as cleanup from './photoCleanup.js';

// Inject a database double without loading the browser's Supabase credentials.
function store(supabase) {
  const source = readFileSync(new URL('./photoCleanupStore.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
    .replace(/export /g, '');
  const bindings = { supabase, ...retention, ...cleanup };
  const createStore = new Function(...Object.keys(bindings), `${source}\nreturn {loadCleanupRefs,previewPhotoCleanup,removePhotoFiles};`);
  return createStore(...Object.values(bindings));
}

test('cleanup reads the protected history through RPC, not the restricted documents table or cache', async () => {
  const calls = [];
  const api = store({
    async rpc(name) {
      calls.push(name);
      return { data: name === 'foto_document_read'
        ? { data: { items: { a: { photoId: 'protected' } } } }
        : { data: { pickedPhotoIds: { b: 'draft-photo' } } } };
    },
    from() { throw new Error('Direct table access is forbidden'); },
  });
  const refs = await api.loadCleanupRefs();
  assert.ok(refs.photoIds.has('protected'));
  assert.ok(refs.photoIds.has('draft-photo'));
  assert.deepEqual(calls, ['foto_document_read', 'foto_draft_action']);
});

test('history or active-draft read errors abort the preview', async () => {
  for (const failing of ['foto_document_read', 'foto_draft_action']) {
    const api = store({ async rpc(name) {
      return name === failing ? { error: new Error('Read failed') } : { data: { data: { items: {} } } };
    } });
    await assert.rejects(api.previewPhotoCleanup(), /Read failed/);
  }
});

test('calendar preview uses an inclusive date and retains the chosen date for confirmation', async () => {
  const rows = [
    { id: 1, created_at: '2026-10-11T02:59:59.999Z' },
    { id: 2, created_at: '2026-10-11T03:00:00.000Z' },
  ].map(row => ({ ...row, name: `PEYA${row.id}`, file_path: `orders/${row.id}.jpg`, public_url: 'https://example.com/a.jpg' }));
  const cutoffs = [];
  const api = store({
    async rpc() { return { data: { data: { items: {} } } }; },
    from() {
      let cursor = 0;
      let cutoff;
      return {
        select() { return this; }, like() { return this; }, not() { return this; },
        order() { return this; }, limit() { return this; },
        lt(key, value) { assert.equal(key, 'created_at'); cutoff = value; cutoffs.push(value); return this; },
        gt(key, value) { assert.equal(key, 'id'); cursor = value; return this; },
        then(resolve) { return Promise.resolve({ data: rows.filter(p => p.id > cursor && (!cutoff || p.created_at < cutoff)) }).then(resolve); },
      };
    },
  });
  const preview = await api.previewPhotoCleanup({ dateTo: '2026-10-10' });
  assert.equal(preview.dateTo, '2026-10-10');
  assert.equal(preview.cutoffIso, '2026-10-11T03:00:00.000Z');
  assert.deepEqual(preview.photos.map(p => p.id), [1]);
  assert.equal(cutoffs.length,0,'el barrido conserva filas recientes para proteger rutas compartidas');
});

test('an empty calendar selection never falls back to automatic retention', async () => {
  let reads = 0;
  const api = store({ async rpc() { reads++; throw new Error('Unexpected read'); } });
  await assert.rejects(api.previewPhotoCleanup({ dateTo: '' }), /calendario/);
  assert.equal(reads, 0);
});

test('preview traverses all pages even when the server maximum is below the requested limit', async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => ({ id: i + 1,
    name: `PEYA${i + 1}`, created_at: '2026-08-01T12:00:00Z',
    file_path: `orders/${i + 1}.jpg`, public_url: 'https://example.com/a.jpg' }));
  let requests = 0;
  const api = store({
    async rpc() { return { data: { data: { items: {} } } }; },
    from(table) {
      assert.equal(table, 'photos');
      let cursor = 0;
      const query = {
        select() { return this; }, like() { return this; }, not() { return this; },
        order() { return this; }, limit() { return this; }, lt() { return this; },
        gt(key, value) { assert.equal(key, 'id'); cursor = value; return this; },
        then(resolve) { requests++; return Promise.resolve({ data: rows.filter(p => p.id > cursor).slice(0, 200) }).then(resolve); },
      };
      return query;
    },
  });
  const preview = await api.previewPhotoCleanup({ days: 30, now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(preview.photos.length, 1205);
  assert.equal(requests, 8);
});
