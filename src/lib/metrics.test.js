import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  complaintRate,
  compareSummaries,
  copyDayStats,
  DEFAULT_COMPLAINT_TARGET_PCT,
  emptyStore,
  endOfMonth,
  endOfWeek,
  enumerateDays,
  formatPct,
  groupPhotoFlags,
  isOutOfTarget,
  parseStore,
  previousPeriod,
  resolveDayAggregator,
  resolvePeriod,
  startOfMonth,
  startOfWeek,
  summarizeRange,
  toArgentinaDate,
  upsertDayStats,
} from './metrics.js';

test('complaint rate and target use 2.4% by default', () => {
  assert.equal(DEFAULT_COMPLAINT_TARGET_PCT, 2.4);
  assert.equal(complaintRate(100, 2), 2);
  assert.equal(complaintRate(100, 3), 3);
  assert.equal(complaintRate(0, 1), null);
  assert.equal(isOutOfTarget(2.4, 2.4), false);
  assert.equal(isOutOfTarget(2.41, 2.4), true);
  assert.equal(formatPct(2.4), '2,4%');
});

test('weeks start on Monday and periods cover today to custom ranges', () => {
  assert.equal(startOfWeek('2026-09-17'), '2026-09-14');
  assert.equal(endOfWeek('2026-09-17'), '2026-09-20');
  assert.equal(startOfMonth('2026-09-17'), '2026-09-01');
  assert.equal(endOfMonth('2026-09-17'), '2026-09-30');
  assert.deepEqual(resolvePeriod('today', '2026-09-17'), { from: '2026-09-17', to: '2026-09-17' });
  assert.deepEqual(resolvePeriod('yesterday', '2026-09-17'), { from: '2026-09-16', to: '2026-09-16' });
  assert.deepEqual(resolvePeriod('days7', '2026-09-17'), { from: '2026-09-11', to: '2026-09-17' });
  assert.deepEqual(resolvePeriod('week', '2026-09-17'), { from: '2026-09-14', to: '2026-09-20' });
  assert.deepEqual(resolvePeriod('month', '2026-09-17'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(resolvePeriod('custom', '2026-09-17', '2026-09-20', '2026-09-10'), {
    from: '2026-09-10',
    to: '2026-09-20',
  });
  assert.deepEqual(enumerateDays('2026-09-16', '2026-09-18'), [
    '2026-09-16',
    '2026-09-17',
    '2026-09-18',
  ]);
  assert.deepEqual(previousPeriod('2026-09-15', '2026-09-17'), {
    from: '2026-09-12',
    to: '2026-09-14',
  });
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
});

test('stores keep valid day rows and drop empty aggregator slots', () => {
  let store = upsertDayStats(emptyStore(), '2026-09-17', 'pedidosya', {
    orders: 120,
    complaints: 4,
  });
  store = upsertDayStats(store, '2026-09-17', 'rappi', { orders: 0, complaints: 0 });
  assert.equal(store.days['2026-09-17'].pedidosya.orders, 120);
  assert.equal(store.days['2026-09-17'].rappi, undefined);

  const copied = copyDayStats(store, '2026-09-17', '2026-09-18');
  assert.equal(copied.days['2026-09-18'].pedidosya.complaints, 4);

  const parsed = parseStore({
    targetComplaintPct: '3',
    days: { 'nope': { pedidosya: { orders: 1 } }, '2026-09-17': { pedidosya: { orders: 10, complaints: 1 } } },
  });
  assert.equal(parsed.targetComplaintPct, 3);
  assert.equal(parsed.days.nope, undefined);
  assert.equal(parsed.days['2026-09-17'].pedidosya.orders, 10);
});

test('auto-fills refuted from photos and accepted from leftover complaints', () => {
  const photos = groupPhotoFlags([
    {
      file_path: 'orders/pedidosya/1.jpg',
      created_at: '2026-09-17T18:00:00.000-03:00',
      has_complaint: true,
      is_refutado: true,
    },
    {
      file_path: 'orders/pedidosya/2.jpg',
      created_at: '2026-09-17T19:00:00.000-03:00',
      has_complaint: true,
      is_refutado: false,
    },
  ]);
  const store = upsertDayStats(emptyStore(), '2026-09-17', 'pedidosya', {
    orders: 100,
    complaints: 3,
  });
  const row = resolveDayAggregator(store, photos, '2026-09-17', 'pedidosya');
  assert.equal(row.refuted, 1);
  assert.equal(row.accepted, 2);
  assert.equal(row.complaintPct, 3);
  assert.equal(row.usedPhotoRefuted, true);
});

test('dashboard rolls up a range and flags the target', () => {
  let store = emptyStore();
  store = upsertDayStats(store, '2026-09-16', 'pedidosya', { orders: 100, complaints: 1 });
  store = upsertDayStats(store, '2026-09-17', 'pedidosya', { orders: 100, complaints: 5 });
  store = upsertDayStats(store, '2026-09-17', 'rappi', { orders: 50, complaints: 0 });
  const summary = summarizeRange(store, {}, '2026-09-16', '2026-09-17');
  assert.equal(summary.overall.orders, 250);
  assert.equal(summary.overall.complaints, 6);
  assert.equal(summary.overall.complaintPct, 2.4);
  assert.equal(isOutOfTarget(summary.overall.complaintPct, 2.4), false);
  const peya = summary.aggregators.find((item) => item.id === 'pedidosya');
  assert.equal(peya.orders, 200);
  assert.equal(peya.complaints, 6);
  assert.equal(isOutOfTarget(peya.complaintPct, 2.4), true);

  const previous = summarizeRange(store, {}, '2026-09-14', '2026-09-15');
  const compared = compareSummaries(summary.overall, previous.overall, 2.4);
  assert.equal(compared.orders, 250);
  assert.equal(compared.outOfTarget, false);
});

test('converts photo timestamps to Argentina calendar days', () => {
  assert.equal(toArgentinaDate('2026-09-17T02:30:00.000Z'), '2026-09-16');
  assert.equal(toArgentinaDate('2026-09-17T03:30:00.000Z'), '2026-09-17');
});
