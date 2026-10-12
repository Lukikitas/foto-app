import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyHistory, patchHistoryItem, upsertHistoryItems } from './complaintHistory.js';
import { buildComplaintReport } from './complaintReport.js';
import { emptyStore, upsertDayStats } from './metrics.js';
import { generateReportHtml } from './pdfReportGenerator.js';

function fixture() {
  let metrics = emptyStore();
  for (const [day, orders, complaints, awt] of [['2026-10-01', 100, 10, 20], ['2026-10-02', 300, 6, 12]]) {
    metrics = upsertDayStats(metrics, day, 'pedidosya', { orders, complaints, awt });
    metrics = upsertDayStats(metrics, day, 'rappi', { orders: 50, complaints: 0 });
  }
  let history = upsertHistoryItems(emptyHistory(), [
    { orderCode: 'PEYA-1', orderAtIso: '2026-10-01T17:00:00-03:00', amount: 100 },
    { orderCode: 'PEYA-2', orderAtIso: '2026-10-02T17:00:00-03:00', amount: 100 },
  ]).store;
  for (const id of Object.keys(history.items)) history = patchHistoryItem(history, id, { status: 'refutado_aceptado' });
  return { metrics, history, from: '2026-10-01', to: '2026-10-02' };
}

test('report rates use weighted range totals and subtract accepted cases per day and aggregator', () => {
  const { metrics, history, from, to } = fixture();
  const report = buildComplaintReport(history, { metrics, from, to, aggregator: 'pedidosya' });
  assert.equal(report.rates.aggregators.length, 1);
  const total = report.rates.aggregators[0];
  assert.equal(total.complaintPct, 4);
  assert.ok(Math.abs(total.adjustedComplaintPct - 3.5) < 1e-10);
  assert.equal(total.awtPct, 8);
  assert.deepEqual(report.rates.daily.map(row => row.adjustedComplaintPct), [9, 5 / 300 * 100]);
  assert.deepEqual(report.rates.daily.map(row => row.awtPct), [20, 4]);
});

test('report includes days with no history, explicit zero complaints and unavailable loads', () => {
  const { metrics, from, to } = fixture();
  const report = buildComplaintReport(emptyHistory(), { metrics, from, to, aggregator: 'rappi' });
  assert.equal(report.totals.count, 0);
  assert.equal(report.rates.daily.length, 2);
  assert.equal(report.rates.aggregators[0].complaintPct, 0);
  assert.equal(report.rates.aggregators[0].awtPct, null);
  delete metrics.days[to].rappi;
  const missing = buildComplaintReport(emptyHistory(), { metrics, from, to, aggregator: 'rappi' });
  assert.equal(missing.rates.daily[1].complaintPct, null);
  assert.equal(missing.rates.aggregators[0].adjustedComplaintPct, null);
  metrics.days[to].rappi = { orders: 50, complaints: 0, reported: { orders: true, complaints: false } };
  assert.equal(buildComplaintReport(emptyHistory(), { metrics, from, to, aggregator: 'rappi' }).rates.aggregators[0].complaintPct, null);
});

test('printed report includes range and daily rates with section switches and aggregator filter', () => {
  const { metrics, history, from, to } = fixture();
  const report = buildComplaintReport(history, { metrics, from, to, aggregator: 'pedidosya' });
  const html = generateReportHtml(report);
  assert.match(html, /Porcentajes del rango por agregador/);
  assert.match(html, /Porcentajes diarios por agregador/);
  assert.match(html, /3,50%/);
  assert.match(html, /AWT Peya/);
  const hidden = generateReportHtml(report, { sections: { aggregators: false, days: false } });
  assert.doesNotMatch(hidden, /Porcentajes (del rango|diarios)/);
  const rappi = generateReportHtml(buildComplaintReport(history, { metrics, from, to, aggregator: 'rappi' }));
  assert.doesNotMatch(rappi, /<th[^>]*>AWT Peya/);
  assert.match(rappi, /0,00%/);
});
