import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { detectAggregator } from './aggregators.js';

const source = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/order-code-recovery/index.ts', import.meta.url), 'utf8').replace(/^import[^\n]+\n/gm, ''));
const scheduledSource = source.slice(source.indexOf('async function analyzeScheduled('), source.indexOf('async function scheduledRecovery('));

async function cachedReading(cached, name = 'Código no encontrado') {
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: cached }; } };
  const analyze = new Function('getPhoto', 'db', 'NO_CODE', 'detectAggregator', `${scheduledSource}; return analyzeScheduled;`)(
    async () => ({ name, file_path: 'orders/no_code/test.jpg' }), { from: () => query }, 'Código no encontrado', detectAggregator);
  return analyze('test-photo');
}

test('scheduled Edge recovery accepts recent cached OCR without a code and does not confirm it', async () => {
  const result = await cachedReading({ status: 'done', code: null, aggregator: null, created_at: new Date().toISOString() });
  assert.equal(result.status, 'no_code');
  assert.equal(result.code, null);
  assert.equal(result.aggregator, null);
  assert.equal(result.reliable, false);
  assert.deepEqual(result.details, { cached: true });
});

test('cached no-code reading cannot keep an invented aggregator', async () => {
  const result = await cachedReading({ status: 'done', code: null, aggregator: 'pedidosya', created_at: new Date().toISOString() });
  assert.equal(result.aggregator, null);
});

test('cached valid codes stay proposals and manual correction wins over cached OCR', async () => {
  const cached = { status: 'done', code: 'PEYA1234567890', aggregator: null, source: 'ticket', created_at: new Date().toISOString() };
  const result = await cachedReading(cached);
  assert.equal(result.status, 'proposed');
  assert.equal(result.aggregator, 'pedidosya');
  assert.equal(result.reliable, false);
  assert.equal((await cachedReading(cached, 'RAPPI123456789')).status, 'manual_override');
});
