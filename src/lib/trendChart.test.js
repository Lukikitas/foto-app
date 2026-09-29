import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTrendChartSvg,
  buildTrendCsv,
  buildTrendSeries,
  TREND_PALETTES,
  trendChartSize,
} from './trendChart.js';
import { emptyStore, upsertDayStats } from './metrics.js';
import { emptyHistory, upsertHistoryItems, patchHistoryItem, COMPLAINT_STATUSES } from './complaintHistory.js';

function fixture() {
  let store = emptyStore();
  store = upsertDayStats(store, '2026-09-20', 'pedidosya', { orders: 120, complaints: 4, awt: 15 });
  store = upsertDayStats(store, '2026-09-21', 'pedidosya', { orders: 100, complaints: 1, awt: 9 });
  store = upsertDayStats(store, '2026-09-20', 'rappi', { orders: 60, complaints: 3, awt: 0 });

  let history = emptyHistory();
  history = upsertHistoryItems(history, [
    {
      orderCode: 'PEYA-2286878556',
      orderAtIso: '2026-09-20T20:00:00-03:00',
      reason: 'Frío',
      amount: 1500,
    },
    {
      orderCode: 'RAPPI-480403041',
      orderAtIso: '2026-09-20T21:00:00-03:00',
      reason: 'Falta producto',
      amount: 800,
    },
  ]).store;
  history = patchHistoryItem(history, 'PEYA2286878556|2026-09-20', {
    status: COMPLAINT_STATUSES.refutado_aceptado,
  });
  return { store, history };
}

test('trend series aggregates totals, money, targets and peaks per day', () => {
  const { store, history } = fixture();
  const series = buildTrendSeries(store, history, { from: '2026-09-20', to: '2026-09-21' });

  assert.equal(series.hasData, true);
  assert.equal(series.rows.length, 2);
  assert.equal(series.totals.orders, 280);
  assert.equal(series.totals.complaints, 8);
  assert.equal(series.target, 2.4);
  assert.ok(series.totals.complaintAmount >= 2300);
  assert.ok(series.totals.recoveredAmount >= 1500);

  const worst = series.peaks.worstPct;
  assert.equal(worst.day, '2026-09-20');
  assert.ok(worst.complaintPct > series.rows[1].complaintPct);

  const compared = series.compared;
  assert.equal(compared.orders, 280);
  assert.equal(compared.complaints, 8);
});

test('trend series respects the aggregator filter', () => {
  const { store, history } = fixture();
  const series = buildTrendSeries(store, history, {
    from: '2026-09-20',
    to: '2026-09-21',
    aggregator: 'rappi',
  });
  assert.equal(series.aggregator, 'rappi');
  assert.equal(series.totals.orders, 60);
  assert.equal(series.totals.complaints, 3);
});

test('operation SVG keeps palette colors out of CSS variables and adds target and peak', () => {
  const { store, history } = fixture();
  const series = buildTrendSeries(store, history, { from: '2026-09-20', to: '2026-09-21' });
  const svg = buildTrendChartSvg(series, { palette: 'print', view: 'operation' });

  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(!svg.includes('var(--'), 'print palette must not use CSS variables');
  assert.ok(svg.includes('objetivo'));
  assert.ok(svg.includes('pico'));
  assert.ok(svg.includes('polyline'));
  assert.ok(svg.includes('Pedidos'));
  assert.ok(svg.includes('Quejas'));
  const { width, height } = trendChartSize('operation');
  assert.ok(svg.includes(`width="${width}"`));
  assert.ok(svg.includes(`height="${height}"`));
});

test('money SVG stacks recovered, dispute and lost with fixed colors', () => {
  const { store, history } = fixture();
  const series = buildTrendSeries(store, history, { from: '2026-09-20', to: '2026-09-21' });
  const svg = buildTrendChartSvg(series, { palette: 'print', view: 'money' });

  assert.ok(svg.includes('$ recuperado'));
  assert.ok(svg.includes('$ perdido'));
  assert.ok(svg.includes(TREND_PALETTES.print.recovered));
  assert.ok(!svg.includes('var(--'));
});

test('empty series renders a placeholder instead of a broken chart', () => {
  const svg = buildTrendChartSvg(buildTrendSeries(emptyStore(), emptyHistory(), {
    from: '2026-09-20',
    to: '2026-09-21',
  }), { palette: 'print' });
  assert.ok(svg.includes('Sin datos en el período'));
  const nullSvg = buildTrendChartSvg(null);
  assert.ok(nullSvg.includes('Sin datos en el período'));
});

test('trend CSV lists every day with raw values', () => {
  const { store, history } = fixture();
  const series = buildTrendSeries(store, history, { from: '2026-09-20', to: '2026-09-21' });
  const csv = buildTrendCsv(series);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'dia,pedidos,quejas,porcentaje_quejas,awt,porcentaje_awt,monto_quejas,monto_recuperado,monto_en_disputa,monto_perdido');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('2026-09-20,180,7,'));
  assert.ok(lines[2].startsWith('2026-09-21,100,1,'));
});
