import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupCandidates, cleanupDateCutoffIso, executePhotoCleanup } from './photoCleanup.js';
import { collectHistoryPhotoRefs, retentionCutoffIso } from './photoRetention.js';
import { groupPhotoFlags } from './metrics.js';
import { buildStaffReport } from './staffPerformance.js';

const cutoffIso = retentionCutoffIso(30, new Date('2026-10-10T12:00:00Z'));
function photo(id, overrides = {}) {
  return { id, name: `PEYA${id}`, file_path: `orders/${id}.jpg`,
    public_url: `https://example.com/${id}.jpg`, created_at: '2026-08-01T12:00:00Z',
    taken_by: 'Ana', aggregator: 'pedidosya', has_complaint: false, is_refutado: false,
    ...overrides };
}
function adapterFor(rows) {
  const removed = [];
  return {
    removed,
    async loadRefs() { return collectHistoryPhotoRefs([]); },
    async loadPhotos(ids) { return rows.filter(row => ids.includes(row.id)); },
    async removeFiles(paths) { removed.push(...paths); },
    async clearUrls(photos) {
      return photos.map(p => {
        const row = rows.find(row => row.id === p.id);
        row.public_url = null;
        return { ...row };
      });
    },
  };
}

test('calendar cleanup includes the whole selected Argentina day and all earlier days', () => {
  const cutoffIso = cleanupDateCutoffIso('2026-10-10');
  assert.equal(cutoffIso, '2026-10-11T03:00:00.000Z');
  const rows = [photo('earlier'),
    photo('start', { created_at: '2026-10-10T00:00:00-03:00' }),
    photo('end', { created_at: '2026-10-10T23:59:59.999-03:00' }),
    photo('following', { created_at: '2026-10-11T00:00:00-03:00' })];
  assert.deepEqual(cleanupCandidates(rows, { cutoffIso }).map(p => p.id), ['earlier', 'start', 'end']);
});

test('calendar cutoff handles month, leap day and year boundaries', () => {
  assert.equal(cleanupDateCutoffIso('2024-02-29'), '2024-03-01T03:00:00.000Z');
  assert.equal(cleanupDateCutoffIso('2026-12-31'), '2027-01-01T03:00:00.000Z');
});

test('calendar cleanup rejects missing, malformed and nonexistent dates', () => {
  for (const dateTo of ['', undefined, null, '10/10/2026', '2026-02-30', '2026-13-01']) {
    assert.throws(() => cleanupDateCutoffIso(dateTo), /calendario/);
  }
});

test('manual cleanup counts only old unprotected order images with strict cutoff', () => {
  const rows = [photo('old'), photo('boundary', { created_at: cutoffIso }),
    photo('recent', { created_at: '2026-10-09T12:00:00Z' }),
    photo('claim', { has_complaint: true }), photo('refuted', { is_refutado: true }),
    photo('gone', { public_url: null }), photo('file', { file_path: 'files/a.jpg' }),
    photo('unknown', { name: 'Código no encontrado' }), photo('evidence')];
  const refs = collectHistoryPhotoRefs([{ photoId: 'evidence' }]);
  assert.deepEqual(cleanupCandidates(rows, { cutoffIso, refs }).map(p => p.id), ['old']);
});

test('cleanup keeps every order field and preserves metrics and staff reports', async () => {
  const rows = [photo('old'), photo('claim', { has_complaint: true }), photo('refuted', { is_refutado: true })];
  const before = structuredClone(rows);
  const metrics = groupPhotoFlags(rows);
  const staff = buildStaffReport({ photos: rows });
  const adapter = adapterFor(rows);
  const result = await executePhotoCleanup({ photos: cleanupCandidates(rows, { cutoffIso }), cutoffIso }, adapter);
  assert.equal(result.removed, 1);
  assert.deepEqual(adapter.removed, ['orders/old.jpg']);
  assert.deepEqual(rows, before.map(p => p.id === 'old' ? { ...p, public_url: null } : p));
  assert.deepEqual(groupPhotoFlags(rows), metrics);
  assert.deepEqual(buildStaffReport({ photos: rows }), staff);
  assert.equal(cleanupCandidates(rows, { cutoffIso }).length, 0);
});

test('confirmation skips newly protected, replaced, or already cleaned photos and excludes new candidates', async () => {
  const preview = { photos: [photo('claim'), photo('replacement'), photo('gone'), photo('history'), photo('old')], cutoffIso };
  const rows = [photo('claim', { has_complaint: true }), photo('replacement', { file_path: 'orders/new.jpg' }),
    photo('gone', { public_url: null }), photo('history'), photo('old'), photo('new')];
  const adapter = adapterFor(rows);
  adapter.loadRefs = async () => collectHistoryPhotoRefs([{ photoId: 'history' }]);
  const result = await executePhotoCleanup(preview, adapter);
  assert.equal(result.removed, 1);
  assert.equal(result.skipped, 4);
  assert.deepEqual(adapter.removed, ['orders/old.jpg']);
  assert.ok(rows.find(p => p.id === 'new').public_url);
});

test('large galleries are processed beyond 1000 with unique confirmed ids', async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => photo(String(i)));
  const preview = { photos: [...structuredClone(rows), rows[0]], cutoffIso };
  const adapter = adapterFor(rows);
  const result = await executePhotoCleanup(preview, adapter);
  assert.equal(result.removed, 1205);
  assert.equal(new Set(adapter.removed).size, 1205);
  assert.equal(rows.length, 1205);
});

test('protection read errors abort without deleting files or assuming an empty history', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => photo(String(i)));
  const adapter = adapterFor(rows);
  adapter.loadRefs = async () => { throw new Error('Historial no disponible'); };
  const result = await executePhotoCleanup({ photos: rows, cutoffIso }, adapter);
  assert.equal(result.removed, 0);
  assert.equal(result.failed, 100);
  assert.equal(result.pending, 101);
  assert.deepEqual(adapter.removed, []);
});

test('storage errors keep metadata and permit a safe retry', async () => {
  const rows = [photo('old')];
  const adapter = adapterFor(rows);
  adapter.removeFiles = async () => { throw new Error('Storage no disponible'); };
  const preview = { photos: structuredClone(rows), cutoffIso };
  const result = await executePhotoCleanup(preview, adapter);
  assert.equal(result.failed, 1);
  assert.ok(rows[0].public_url);
  assert.equal((await executePhotoCleanup(preview, adapterFor(rows))).removed, 1);
});

test('metadata failures report incomplete work without changing any metric fields', async () => {
  const rows = [photo('old')];
  const adapter = adapterFor(rows);
  adapter.clearUrls = async () => [];
  const result = await executePhotoCleanup({ photos: structuredClone(rows), cutoffIso }, adapter);
  assert.equal(result.removed, 0);
  assert.equal(result.failed, 1);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].public_url);
});

test('shared paths stay protected when another row needs the same image', async()=>{
 const rows=[photo('old'),photo('protected',{file_path:'orders/old.jpg',has_complaint:true})];
 assert.equal(cleanupCandidates(rows,{cutoffIso}).length,0);
 const adapter=adapterFor(rows);adapter.loadRelated=async()=>rows;
 const result=await executePhotoCleanup({photos:[rows[0]],cutoffIso},adapter);
 assert.equal(result.removed,0);assert.deepEqual(adapter.removed,[]);
});
