import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMPLAINT_STATUSES,
  emptyHistory,
  patchHistoryItem,
  upsertHistoryItems,
} from './complaintHistory.js';
import { buildComplaintReport, buildRegistryCsv, comboRanking } from './complaintReport.js';

function complaint(overrides = {}) {
  return {
    orderCode: 'PEYA-1',
    orderAtIso: '2026-09-17T17:00:00.000-03:00',
    timeOfDay: '17:00',
    reason: 'Faltó producto',
    comment: '',
    combo: 'Combo Crispy',
    amount: 8000,
    ...overrides,
  };
}

test('combo ranking uses share of informed complaints and keeps Sin combo aside', () => {
  const store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'PEYA-2', combo: 'Combo Crispy', amount: 2000 }),
    complaint({ orderCode: 'PEYA-3', combo: 'Twister', amount: 1000 }),
    complaint({ orderCode: 'PEYA-4', combo: '', amount: 500 }),
  ]).store;
  const ranked = comboRanking(Object.values(store.items));
  assert.equal(ranked[0].combo, 'Combo Crispy');
  assert.equal(ranked[0].count, 2);
  assert.ok(Math.abs(ranked[0].sharePct - (2 / 3) * 100) < 0.0001);
  const empty = ranked.find((row) => row.combo === 'Sin combo');
  assert.equal(empty.count, 1);
  assert.equal(empty.sharePct, 25);
});

test('report totals recovered money only from Ref. aceptado', () => {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'RAPPI-1', amount: 3000, combo: 'Twister' }),
    complaint({ orderCode: 'PEYA-9', amount: 1000, combo: 'Papas' }),
  ]).store;
  const ids = Object.keys(store.items);
  store = patchHistoryItem(store, ids[0], { status: COMPLAINT_STATUSES.refutado_aceptado });
  store = patchHistoryItem(store, ids[1], { status: COMPLAINT_STATUSES.refutado_rechazado });
  const report = buildComplaintReport(store, { from: '2026-09-17', to: '2026-09-17' });
  assert.equal(report.totals.count, 3);
  assert.equal(report.totals.complaintAmount, 12000);
  assert.equal(report.totals.recoveredAmount, 8000);
  assert.equal(report.totals.lostAmount, 4000);
  assert.equal(report.aggregators.length, 2);
  const csv = buildRegistryCsv(report.items);
  assert.match(csv, /Combo Crispy/);
  assert.match(csv, /8000/);
});
