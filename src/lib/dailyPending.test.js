import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPending, buildPendingManualLoad, dailyLoadState } from './dailyPending.js';
import { argentinaToday, emptyStore, METRIC_AGGREGATORS } from './metrics.js';

const today = '2026-10-11';
const complete = (complaints = 0) => ({ orders: 100, complaints, awt: 0, reported: { orders: true, complaints: true, awt: true } });
const dayStats = () => Object.fromEntries(METRIC_AGGREGATORS.map(id => [id, complete()]));
const item = (id, day, status = 'queja', aggregator = 'pedidosya', extra = {}) => ({ id, day, status, aggregator, orderCode: `PEYA${id}`, ...extra });

test('inline loading affects only the selected day and platform and records manual origin including zero', () => {
  const metrics = { ...emptyStore(), days: { '2026-10-08': { pedidosya: { ...complete(), sources: { orders: 'manual', complaints: 'manual', awt: 'manual' } } } } };
  const before = structuredClone(metrics);
  const saved = buildPendingManualLoad(metrics, '2026-10-08', 'rappi', { orders: '0', complaints: '0' }, today);
  assert.deepEqual(metrics, before);
  assert.deepEqual(saved.days['2026-10-08'].pedidosya, metrics.days['2026-10-08'].pedidosya);
  assert.equal(saved.days['2026-10-08'].rappi.orders, 0);
  assert.equal(saved.days['2026-10-08'].rappi.sources.complaints, 'manual');
  assert.equal(saved.days['2026-10-08'].rappi.reported.orders, true);
  assert.equal(saved.targetComplaintPct, metrics.targetComplaintPct);
});

test('inline loading rejects missing values, invalid dates, future data and impossible totals before saving', () => {
  for (const fields of [{ orders: '10' }, { orders: '10', complaints: '11' }, { orders: '-1', complaints: '0' }, { orders: '10', complaints: '1', awt: '11' }]) {
    assert.throws(() => buildPendingManualLoad(emptyStore(), today, 'pedidosya', fields, today));
  }
  assert.throws(() => buildPendingManualLoad(emptyStore(), '2026-10-12', 'rappi', { orders: '1', complaints: '0' }, today));
  assert.throws(() => buildPendingManualLoad(emptyStore(), today, 'unknown', { orders: '1', complaints: '0' }, today));
});
function report(days, cases = [], options = {}) {
  return buildDailyPending({ metrics: { ...emptyStore(), days }, history: { items: Object.fromEntries(cases.map(row => [row.id, row])) },
    today, from: '2026-10-01', to: today, ...options });
}

test('any saved data is loaded: zeros, old values and partial imports never become pending loads', () => {
  assert.equal(dailyLoadState({ ...complete(), orders: 0 }, 'pedidosya').state, 'complete');
  assert.equal(dailyLoadState(undefined, 'rappi').state, 'missing');
  assert.equal(dailyLoadState({ ...complete(), reported: { orders: true, complaints: false, awt: true } }, 'pedidosya').state, 'complete');
  assert.equal(dailyLoadState({ orders: 10, complaints: 0, awt: 0 }, 'pedidosya').state, 'complete');
  assert.equal(dailyLoadState({ ...complete(), reported: { orders: true, complaints: true, awt: null } }, 'rappi').state, 'complete');
  assert.equal(dailyLoadState({ ...complete(), awt: null }, 'pedidosya').state, 'complete');
});

test('enumerates gaps since first activity, never inventing work before the operation began', () => {
  const result = report({ '2026-10-09': dayStats(), '2026-10-11': dayStats() });
  assert.deepEqual(result.days.map(row => row.day), ['2026-10-09', '2026-10-10', today]);
  assert.equal(result.days[0].hasPending, false);
  assert.equal(result.days[1].hasPending, true);
  assert.equal(result.totals.missingDays, 1);
  assert.equal(report({}, []).days.length, 0);
});

test('counts each open case once by its day and aggregator, excluding all terminal statuses', () => {
  const cases = [item('1', '2026-10-09'), item('2', '2026-10-09', 'refutado', 'rappi'),
    ...['no_refutable', 'refutado_aceptado', 'refutado_rechazado'].map((status, i) => item(`closed${i}`, '2026-10-09', status))];
  const before = structuredClone(cases);
  const result = report({ '2026-10-09': dayStats() }, cases);
  assert.equal(result.totals.unrefuted, 1);
  assert.equal(result.totals.inAnalysis, 1);
  assert.equal(result.days[0].groups.find(group => group.id === 'rappi').inAnalysis[0].id, '2');
  assert.deepEqual(cases, before);
  const filtered = report({ '2026-10-09': dayStats() }, cases, { aggregator: 'rappi' });
  assert.equal(filtered.totals.unrefuted, 0);
  assert.equal(filtered.totals.inAnalysis, 1);
});

test('preserves expired complaints and zero deadlines, ordering urgency before known amounts', () => {
  const metrics = { ...emptyStore(), days: {}, refutadoDays: { default: 0, pedidosya: 2, rappi: 0 } };
  const cases = [item('1', '2026-10-08', 'queja', 'pedidosya'), item('2', '2026-10-09', 'queja', 'pedidosya'), item('3', '2026-10-08', 'queja', 'rappi')];
  const result = report({}, cases, { metrics });
  assert.equal(result.days[0].groups[0].unrefuted[0].daysLeft, -1);
  assert.equal(result.days[1].groups[0].unrefuted[0].daysLeft, 0);
  assert.equal(result.days[0].groups[1].unrefuted[0].daysLeft, null);
  assert.equal(result.totals.unrefuted, 3);
});

test('pending work outside either boundary cannot disappear behind a range filter', () => {
  const result = report({ '2026-10-08': dayStats(), '2026-10-09': dayStats(), '2026-10-10': dayStats(), [today]: dayStats() },
    [item('1', '2026-10-08'), item('2', today, 'refutado')], { from: '2026-10-09', to: '2026-10-10' });
  assert.deepEqual(result.outside.map(row => row.day), ['2026-10-08', today]);
  assert.equal(result.outsideTotals.unrefuted, 1);
  assert.equal(result.outsideTotals.inAnalysis, 1);
});

test('saved loads stay complete but reported complaints absent from history create pending work, including today', () => {
  const result = report({ '2026-10-10': { ...dayStats(), rappi: { orders: 10, complaints: 0, awt: 0 } } });
  assert.equal(result.days[0].hasPending, false);
  assert.equal(result.totals.missingDays, 1); // only today has no saved rows
  assert.equal(result.days[1].inProgress, true);
  assert.equal(result.days[1].hasPending, false);
  const difference = report({ [today]: { ...dayStats(), pedidosya: complete(2) } }, [item('1', today)]);
  assert.equal(difference.days[0].groups[0].discrepancy, true);
  assert.equal(difference.days[0].groups[0].load.state, 'complete');
  assert.equal(difference.days[0].missingHistory, 1);
  assert.equal(difference.days[0].hasPending, true);
  const onlyDifference = report({ '2026-10-10': { ...dayStats(), pedidosya: complete(2) } });
  assert.equal(onlyDifference.days[0].hasPending, true);
  assert.equal(onlyDifference.days[0].needsData, false);
  assert.equal(onlyDifference.totals.missingHistory, 2);
});

test('history gaps count resolved and marked cases, stay isolated by day and platform, and close when registered', () => {
  const days = { '2026-10-10': { ...dayStats(), pedidosya: complete(5) }, [today]: dayStats() };
  const cases = [item('1', '2026-10-10', 'no_refutable'), item('2', '2026-10-10', 'refutado_aceptado'),
    item('3', '2026-10-10', 'refutado_rechazado', 'pedidosya', { reason: 'Pendiente de cargar detalles del reclamo' }),
    item('4', '2026-10-10', 'no_refutable', 'rappi'), item('5', today, 'no_refutable')];
  const result = report(days, cases, { from: today, to: today });
  assert.equal(result.outsideTotals.missingHistory, 2);
  assert.equal(result.outside[0].missingHistory, 2);
  assert.equal(result.outside[0].hasPending, true);
  assert.equal(result.outsideTotals.unrefuted, 0);
  assert.equal(report(days, cases, { aggregator: 'rappi' }).totals.missingHistory, 0);
  const closed = report(days, [...cases, item('6', '2026-10-10', 'refutado_aceptado'), item('7', '2026-10-10', 'no_refutable')]);
  assert.equal(closed.totals.missingHistory, 0);
  assert.equal(closed.days[0].hasPending, false);
  assert.equal(closed.days[0].groups[0].load.state, 'complete');
});

test('unreported counts, zeros and more history than reported do not create missing history tasks', () => {
  for (const stats of [complete(0), { ...complete(5), reported: { complaints: false } }, { orders: 10 }, { ...complete(), complaints: null }]) {
    const result = report({ [today]: { ...dayStats(), pedidosya: stats } }, [item('1', today, 'no_refutable')]);
    assert.equal(result.totals.missingHistory, 0);
    assert.equal(result.days[0].hasPending, false);
  }
});

test('unassigned and undated open cases remain visible, using Argentina rather than UTC for timestamps', () => {
  const result = report({}, [item('1', '', 'queja', null), item('2', today, 'refutado', null),
    item('3', '', 'queja', 'pedidosya', { orderAtIso: '2026-10-11T01:30:00Z' })]);
  assert.equal(result.undated.length, 1);
  assert.equal(result.days[0].day, '2026-10-10');
  assert.equal(result.days.at(-1).groups.at(-1).id, 'unknown');
  assert.equal(result.totals.inAnalysis, 1);
  assert.equal(argentinaToday(new Date('2026-10-11T01:00:00Z')), '2026-10-10');
});

test('invalid or future ranges cannot claim there are no pending tasks', () => {
  for (const range of [{ from: '2026-02-30', to: today }, { from: today, to: '2026-10-10' }, { from: today, to: '2026-10-12' }]) {
    assert.equal(report({ [today]: dayStats() }, [], range).validRange, false);
  }
});
