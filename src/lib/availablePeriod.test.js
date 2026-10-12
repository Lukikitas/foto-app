import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyStore, resolveAvailablePeriod, upsertDayStats } from './metrics.js';

const today = '2026-10-12';
const loaded = () => upsertDayStats(emptyStore(), '2026-10-11', 'pedidosya', {
  orders: 100, complaints: 2, awt: 10, reported: { orders: true, complaints: true, awt: true },
});

test('automatic periods end on the last loaded day when today has no data', () => {
  const store = loaded();
  assert.deepEqual(resolveAvailablePeriod('month', store, today), { from: '2026-10-01', to: '2026-10-11' });
  assert.deepEqual(resolveAvailablePeriod('week', store, today), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(resolveAvailablePeriod('days7', store, today), { from: '2026-10-05', to: '2026-10-11' });
});

test('an explicit zero load counts as data and automatic periods expand when today is saved', () => {
  const store = upsertDayStats(loaded(), today, 'rappi', {
    orders: 0, complaints: 0, reported: { orders: true, complaints: true, awt: false },
  });
  assert.deepEqual(resolveAvailablePeriod('month', store, today), { from: '2026-10-01', to: today });
  assert.deepEqual(resolveAvailablePeriod('week', store, today), { from: today, to: today });
});

test('legacy values count as loaded, unavailable fields and future loads do not', () => {
  const store = loaded();
  store.days['2026-10-13'] = { pedidosya: { orders: 100, complaints: 1 } };
  store.days[today] = { rappi: { orders: 0, complaints: 0, reported: { orders: false, complaints: false } } };
  assert.equal(resolveAvailablePeriod('month', store, today).to, '2026-10-11');
  store.days[today] = { rappi: { orders: 20, complaints: 1 } };
  assert.equal(resolveAvailablePeriod('month', store, today).to, today);
});

test('explicit days and custom date selections keep the selected dates', () => {
  const store = loaded();
  assert.deepEqual(resolveAvailablePeriod('today', store, today), { from: today, to: today });
  assert.deepEqual(resolveAvailablePeriod('yesterday', store, today), { from: '2026-10-11', to: '2026-10-11' });
  assert.deepEqual(resolveAvailablePeriod('custom', store, today, '2026-10-01', today), { from: '2026-10-01', to: today });
});

test('periods without any saved loads retain a valid range and month boundaries use the last data', () => {
  assert.deepEqual(resolveAvailablePeriod('week', emptyStore(), today), { from: today, to: today });
  assert.deepEqual(resolveAvailablePeriod('month', loaded(), '2026-11-01'), { from: '2026-10-01', to: '2026-10-11' });
});
