import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';

test('photo uploads reconcile uncertain inserts and scoped clients do not accumulate browser listeners', async t => {
  const server = await createServer({ configFile: false, envDir: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-only') },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  const { supabase, supabaseForSignal } = await server.ssrLoadModule('/src/lib/supabase.js');
  const { uploadFile } = await server.ssrLoadModule('/src/lib/photos.js');
  const file = new File(['original bytes'], 'photo.jpg', { type: 'image/jpeg' });
  try {
    function fixture(child, lookups, insertResult) {
      let uploads = 0;
      let removed = 0;
      let inserted;
      const filters = [];
      child.mock.method(supabase.storage, 'from', () => ({
        upload: async () => { uploads++; return { error: null }; },
        getPublicUrl: () => ({ data: { publicUrl: 'https://fixture.test/photo' } }),
        remove: async () => { removed++; return { error: null }; },
      }));
      child.mock.method(supabase, 'from', () => {
        const builder = { select: () => builder, eq: (key, value) => { filters.push([key, value]); return builder; },
          maybeSingle: async () => lookups.shift(), insert: payload => { inserted = payload; return builder; }, single: async () => insertResult };
        return builder;
      });
      return { uploads: () => uploads, removed: () => removed, inserted: () => inserted, filters };
    }
    await t.test('an uncertain insert and failed reconciliation never delete the stored evidence', async child => {
      const failure = { message: 'connection lost after commit', status: 503 };
      const state = fixture(child, [{ data: null }, { data: null, error: failure }], { data: null, error: failure });
      await assert.rejects(uploadFile(file, 'test', {}, 'files/stable.jpg'), { message: 'connection lost after commit', status: 503 });
      assert.equal(state.uploads(), 1);
      assert.equal(state.removed(), 0);
    });
    await t.test('a committed insert with a lost response returns its existing row and stable capture identity', async child => {
      const captureId = '11111111-1111-4111-8111-111111111111';
      const photo = { id: 'existing-photo', capture_id: captureId };
      const state = fixture(child, [{ data: null }, { data: null }, { data: photo }], { error: { message: 'timeout', status: 503 } });
      assert.equal(await uploadFile(file, 'test', {}, 'files/stable.jpg', null, { captureId }), photo);
      assert.equal(state.inserted().capture_id, captureId);
      assert.deepEqual(state.filters, [['capture_id', captureId], ['file_path', 'files/stable.jpg'], ['capture_id', captureId]]);
      assert.equal(state.removed(), 0);
    });
    await t.test('legacy pending captures reconcile a committed path that predates capture IDs', async child => {
      const legacy = { id: 'legacy-photo', file_path: 'files/stable.jpg', capture_id: null };
      const state = fixture(child, [{ data: null }, { data: legacy }], {});
      assert.equal(await uploadFile(file, 'test', {}, 'files/stable.jpg', null, { captureId: '11111111-1111-4111-8111-111111111111' }), legacy);
      assert.equal(state.uploads(), 0);
      assert.equal(state.inserted(), undefined);
      assert.equal(state.removed(), 0);
    });
    await t.test('a failed existence query stops the upload without guessing that the row is absent', async child => {
      const state = fixture(child, [{ data: null, error: new Error('network offline') }], {});
      await assert.rejects(uploadFile(file, 'test'), /network offline/);
      assert.equal(state.uploads(), 0);
    });
    await t.test('hundreds of request clients install no additional visibility handlers', async () => {
      await supabase.auth.getSession();
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      const dom = new JSDOM('', { url: 'https://fixture.test' });
      let listeners = 0;
      const original = dom.window.addEventListener.bind(dom.window);
      dom.window.addEventListener = (...args) => { if (args[0] === 'visibilitychange') listeners++; return original(...args); };
      globalThis.window = dom.window; globalThis.document = dom.window.document;
      try {
        for (let index = 0; index < 250; index++) {
          const controller = new AbortController();
          const client = supabaseForSignal(controller.signal);
          assert.equal(supabaseForSignal(controller.signal), client);
          client.storage.from('photos').getPublicUrl('fixture.jpg');
        }
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(listeners, 0);
      } finally { dom.window.close(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
    });
  } finally { await supabase.auth.stopAutoRefresh(); await server.close(); }
});
