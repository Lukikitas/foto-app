import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

function edge(rows) {
  let handler;
  let savedCursor = null;
  const db = {
    storage: { from() { return {
      async download() { return { error: { message: 'not found' } }; },
      async upload(path, body) { savedCursor = JSON.parse(body); return {}; },
      async remove(paths) { assert.ok(paths.every(p => p.startsWith('orders/'))); return {}; },
    }; } },
    async rpc() { return { data: null }; },
    from(table) {
      let cursor = null;
      let ids = null;
      let paths = null;
      let pathCursor = null;
      let update = null;
      let id = null;
      let limit = Infinity;
      const query = {
        select() { return this; },
        eq(key, value) { if (key === 'id' && table === 'photos') id = value; return this; },
        maybeSingle() { return this; }, lt() { return this; }, not() { return this; },
        like() { return this; }, order() { return this; },
        in(key, value) { if(key==='file_path')paths=value;else ids = value; return this; },
        gt(key,value) { if(key==='id')pathCursor=value;return this; },
        limit(value) { limit = value; return this; },
        or(filter) { cursor = filter.match(/id\.gt\.([^)]*)/)[1]; return this; },
        update(value) { update = value; return this; },
        then(resolve) {
          if (table === 'photo_cleanup_settings') return Promise.resolve({ data: { enabled: true, retention_days: 30 } }).then(resolve);
          if (table === 'foto_app_documents') return Promise.resolve({ data: { data: { items: {} } } }).then(resolve);
          if (update) {
            const row = rows.find(p => p.id === id);
            if (row) Object.assign(row, update);
            return Promise.resolve({ data: row ? [{ id }] : [] }).then(resolve);
          }
          const data = rows.filter(p => paths ? paths.includes(p.file_path) && (!pathCursor || p.id>pathCursor) : ids ? ids.includes(p.id) :
            p.public_url && !p.has_complaint && !p.is_refutado && (!cursor || p.id > cursor))
            .slice(0, limit).map(p => ({ ...p }));
          return Promise.resolve({ data }).then(resolve);
        },
      };
      return query;
    },
  };
  const source = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/cleanup-photo-retention/index.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]+\n/, '').replace(/export /g, ''));
  new Function('createClient', 'Deno', source)(() => db, {
    env: { get: name => name === 'PHOTO_CLEANUP_SECRET' ? 'test-secret' : 'test-only' },
    serve: next => { handler = next; },
  });
  return {
    async run(action) {
      const response = await handler(new Request('https://example.com/cleanup', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cleanup-secret': 'test-secret' },
        body: JSON.stringify({ action }) }));
      assert.equal(response.status, 200);
      return response.json();
    },
    cursor: () => savedCursor,
  };
}

function rows(count) {
  return Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(5, '0'),
    name: `PEYA${i}`, created_at: '2020-01-01T12:00:00Z',
    file_path: `orders/${i}.jpg`, public_url: `https://example.com/${i}.jpg`,
    has_complaint: false, is_refutado: false }));
}

test('edge dry-run counts equal-date pages once without writing a cursor or modifying photos', async () => {
  const photos = rows(400);
  const before = structuredClone(photos);
  const api = edge(photos);
  const result = await api.run('dry-run');
  assert.equal(result.candidates, 400);
  assert.equal(result.hasMore, false);
  assert.equal(api.cursor(), null);
  assert.deepEqual(photos, before);
});

test('automatic cleanup preserves rows and drains photos with equal timestamps', async () => {
  const photos = rows(405);
  const api = edge(photos);
  const result = await api.run('cleanup');
  assert.equal(result.removed, 405);
  assert.equal(result.failed, 0);
  assert.equal(result.hasMore, false);
  assert.equal(photos.length, 405);
  assert.ok(photos.every(p => p.public_url === null));
  assert.equal(api.cursor().id, undefined);
});

test('automatic cleanup protects shared image paths referenced by another row',async()=>{
 const photos=rows(2);photos[1].file_path=photos[0].file_path;photos[1].has_complaint=true;
 const result=await edge(photos).run('cleanup');
 assert.equal(result.removed,0);assert.ok(photos.every(photo=>photo.public_url));
});
