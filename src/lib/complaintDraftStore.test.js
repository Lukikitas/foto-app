import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as history from './complaintHistory.js';
import * as metrics from './metrics.js';
import * as draft from './complaintDraft.js';
import * as changes from './documentChanges.js';
import { matchComplaintsToPhotos } from './complaintMatch.js';

function moduleWith(path, bindings, names) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '').replace(/export /g, '');
  const create = new Function(...Object.keys(bindings), `${source}\nreturn {${names.join(',')}};`);
  return create(...Object.values(bindings));
}

function setup({ source = 'peya', alreadySaved = false, reloadFails = false, commitFails = false } = {}) {
  let announced;
  let saved;
  let writes = 0;
  const complaint = { id: 'PEYA123456|2026-09-17', orderCode: 'PEYA123456', day: '2026-09-17',
    aggregator: source === 'rappi' ? 'rappi' : 'pedidosya', amount: 100 };
  const input = { id: 'draft', revision: 1, data: { source, complaints: [complaint],
    ...(source !== 'manual' ? { report: { daily: [{ day: '2026-09-17', orders: 100, complaints: 10, awt: 2 }] } } : {}) } };
  const api = moduleWith('./complaintDraftStore.js', {
    ...history, ...metrics, ...draft,
    navigator: { onLine: true }, localStorage: { setItem() {} }, supabase: {},
    sharedError: error => error, matchComplaintsToPhotos,
    async readDocument(key) { return { revision: 1, data: key === 'history' ? history.emptyHistory() : metrics.emptyStore() }; },
    async commitDocuments(documents, options) {
      writes++;
      if (commitFails) throw new Error('No se pudo guardar');
      saved = documents;
      return alreadySaved ? { alreadySaved: true, result: options.commit_result }
        : { documents, result: options.commit_result };
    },
    async fetchPhotosForComplaints() { return []; }, async fetchPhotosByIds() { return []; },
    async loadComplaintHistory() { return history.emptyHistory(); },
    async recordManualCruzar() {},
    acceptCommittedMetrics: doc => metrics.parseStore(doc.data),
    async loadMetricsStore() {
      if (reloadFails) throw new Error('Sin conexión');
      return metrics.parseStore(saved.find(doc => doc.key === 'metrics').data);
    },
    announceWorkbookImport: result => { announced = result; },
  }, ['confirmDraft']);
  return { input, api, event: () => announced, writes: () => writes, saved: () => saved };
}

for (const source of ['peya', 'rappi']) {
  test(`${source}: saving an Excel draft announces the committed metrics snapshot`, async () => {
    const fixture = setup({ source });
    const result = await fixture.api.confirmDraft(fixture.input);
    assert.equal(result.added, 1);
    assert.equal(fixture.writes(), 1);
    const event = fixture.event();
    assert.equal(event.historySaved, true);
    assert.equal(event.metricsSaved, true);
    assert.ok(event.metrics.days);
    assert.deepEqual(event.metrics, metrics.parseStore(fixture.saved().find(doc => doc.key === 'metrics').data));
    assert.doesNotThrow(() => Object.keys(event.metrics.days || {}));
  });
}

test('manual complaints save history without replacing metrics', async () => {
  const fixture = setup({ source: 'manual' });
  await fixture.api.confirmDraft(fixture.input);
  assert.equal(fixture.event().metricsSaved, false);
  assert.equal(fixture.event().metrics, null);
  assert.equal(fixture.saved().length, 1);
});

test('an already-saved response reloads metrics when it has no documents', async () => {
  const fixture = setup({ alreadySaved: true });
  await fixture.api.confirmDraft(fixture.input);
  assert.ok(fixture.event().metrics.days);
  assert.equal(fixture.writes(), 1);
});

test('a post-commit refresh failure stays a saved import with a warning', async () => {
  const fixture = setup({ alreadySaved: true, reloadFails: true });
  const result = await fixture.api.confirmDraft(fixture.input);
  assert.equal(result.added, 1);
  assert.match(result.warning, /datos se guardaron/);
  assert.equal(fixture.event().metrics, null);
  assert.equal(fixture.writes(), 1);
});

test('a real commit failure does not announce a saved import', async () => {
  const fixture = setup({ commitFails: true });
  await assert.rejects(fixture.api.confirmDraft(fixture.input), /No se pudo guardar/);
  assert.equal(fixture.event(), undefined);
});

test('committed metrics become an editable baseline without requiring a reload', async () => {
  let current = { ...metrics.emptyStore(), updatedAt: '2026-10-10T12:00:00Z' };
  const api = moduleWith('./metricsStore.js', {
    ...metrics, ...changes, localStorage: { setItem() {} },
    async mutateDocument(key, empty, parse, mutate) { current = mutate(current); return current; },
  }, ['acceptCommittedMetrics', 'saveMetricsStore']);
  const accepted = api.acceptCommittedMetrics({ data: current });
  const saved = await api.saveMetricsStore({ ...accepted, targetComplaintPct: 3 });
  assert.equal(saved.targetComplaintPct, 3);
});
