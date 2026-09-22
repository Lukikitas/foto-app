import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  complaintRate,
  compareSummaries,
  copyDayStats,
  DEFAULT_COMPLAINT_TARGET_PCT,
  DEFAULT_AWT_TARGET_PCT,
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
  aggregatorDailySeries,
  setTargetAwtPct,
  summarizeRange,
  toArgentinaDate,
  upsertDayStats,
} from './metrics.js';

test('complaint rate and target use 2.4% by default', () => {
  assert.equal(DEFAULT_COMPLAINT_TARGET_PCT, 2.4);
  assert.equal(DEFAULT_AWT_TARGET_PCT, 11);
  assert.equal(complaintRate(100, 2), 2);
  assert.equal(complaintRate(100, 3), 3);
  assert.equal(complaintRate(0, 1), null);
  assert.equal(isOutOfTarget(2.4, 2.4), false);
  assert.equal(isOutOfTarget(2.41, 2.4), true);
  assert.equal(isOutOfTarget(11, 11), false);
  assert.equal(isOutOfTarget(12, 11), true);
  assert.equal(formatPct(2.4), '2,40%');
  assert.equal(formatPct(2.14), '2,14%');
  assert.equal(formatPct(complaintRate(174, 5)), '2,87%');
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
  assert.equal(store.days['2026-09-17'].pedidosya.awt, 0);
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

test('resolution and money come from the complaints history, not typed metrics', () => {
  const photos = groupPhotoFlags([
    {
      file_path: 'orders/pedidosya/1.jpg',
      created_at: '2026-09-17T18:00:00.000-03:00',
      has_complaint: true,
      is_refutado: true,
    },
  ]);
  const store = upsertDayStats(emptyStore(), '2026-09-17', 'pedidosya', {
    orders: 100,
    complaints: 3,
  });
  const historyFlags = {
    '2026-09-17': {
      pedidosya: {
        queja: 1,
        refutado: 1,
        refutadoAceptado: 1,
        refutadoRechazado: 0,
        complaintAmount: 9000,
        recoveredAmount: 4000,
        lostAmount: 2000,
        disputedAmount: 3000,
        undisputedAmount: 2000,
        inProgressAmount: 3000,
        confirmedLostAmount: 0,
      },
    },
  };
  const row = resolveDayAggregator(store, photos, '2026-09-17', 'pedidosya', historyFlags);
  assert.equal(row.complaintPct, 3);
  assert.equal(row.queja, 1);
  assert.equal(row.refutado, 1);
  assert.equal(row.refutadoAceptado, 1);
  assert.equal(row.complaintAmount, 9000);
  assert.equal(row.recoveredAmount, 4000);
  assert.equal(row.disputedAmount, 3000);
  assert.equal(row.lostAmount, 2000);
});

test('period totals include complaint money even without an aggregator prefix', () => {
  const store = upsertDayStats(emptyStore(), '2026-09-17', 'pedidosya', {
    orders: 50,
    complaints: 1,
  });
  const historyFlags = {
    '2026-09-17': {
      sin_agregador: {
        queja: 1,
        refutado: 0,
        refutadoAceptado: 0,
        refutadoRechazado: 0,
        complaintAmount: 1500.5,
        recoveredAmount: 0,
        lostAmount: 1500.5,
        undisputedAmount: 1500.5,
        inProgressAmount: 0,
        confirmedLostAmount: 0,
      },
    },
  };
  const summary = summarizeRange(store, {}, '2026-09-17', '2026-09-17', historyFlags);
  assert.equal(summary.overall.complaintAmount, 1500.5);
  assert.equal(summary.overall.lostAmount, 1500.5);
  assert.equal(summary.daily[0].complaintAmount, 1500.5);
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

test('PedidosYa AWT is a percent of total orders against an 11% target', () => {
  let store = upsertDayStats(emptyStore(), '2026-09-17', 'pedidosya', {
    orders: 100,
    complaints: 2,
    awt: 9,
  });
  assert.equal(store.targetAwtPct, 11);
  const row = resolveDayAggregator(store, {}, '2026-09-17', 'pedidosya');
  assert.equal(row.awt, 9);
  assert.equal(row.awtPct, 9);
  assert.equal(isOutOfTarget(row.awtPct, store.targetAwtPct), false);

  store = upsertDayStats(store, '2026-09-17', 'pedidosya', {
    orders: 100,
    complaints: 2,
    awt: 12,
  });
  const late = resolveDayAggregator(store, {}, '2026-09-17', 'pedidosya');
  assert.equal(late.awtPct, 12);
  assert.equal(isOutOfTarget(late.awtPct, 11), true);

  const parsed = parseStore({ targetAwtPct: '10', days: {} });
  assert.equal(parsed.targetAwtPct, 10);
  assert.equal(setTargetAwtPct(parsed, 8).targetAwtPct, 8);
  assert.equal(setTargetAwtPct(parsed, 'nope').targetAwtPct, DEFAULT_AWT_TARGET_PCT);
});

test('aggregator daily series stays on one partner and ignores the overall mix', () => {
  let store = emptyStore();
  store = upsertDayStats(store, '2026-09-16', 'pedidosya', { orders: 100, complaints: 5, awt: 20 });
  store = upsertDayStats(store, '2026-09-16', 'rappi', { orders: 100, complaints: 0 });
  store = upsertDayStats(store, '2026-09-17', 'pedidosya', { orders: 50, complaints: 0, awt: 2 });
  const summary = summarizeRange(store, {}, '2026-09-16', '2026-09-17');
  assert.equal(summary.overall.complaintPct, 2);
  const peya = aggregatorDailySeries(summary, 'pedidosya');
  assert.equal(peya[0].complaintPct, 5);
  assert.equal(peya[0].awtPct, 20);
  assert.equal(peya[1].orders, 50);
  const rappi = aggregatorDailySeries(summary, 'rappi');
  assert.equal(rappi[0].complaintPct, 0);
  assert.equal(rappi[1].orders, 0);
});

test('converts photo timestamps to Argentina calendar days', () => {
  assert.equal(toArgentinaDate('2026-09-17T02:30:00.000Z'), '2026-09-16');
  assert.equal(toArgentinaDate('2026-09-17T03:30:00.000Z'), '2026-09-17');
});
