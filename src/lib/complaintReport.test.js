
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

test('report totals count no_refutable separately and keep its money as lost', () => {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'PEYA-5', amount: 2000 }),
  ]).store;
  const ids = Object.keys(store.items);
  store = patchHistoryItem(store, ids[0], {
    status: COMPLAINT_STATUSES.no_refutable,
    unrefutableReason: 'Queja real',
  });
  store = patchHistoryItem(store, ids[1], { status: COMPLAINT_STATUSES.refutado_aceptado });

  const report = buildComplaintReport(store, { from: '2026-09-17', to: '2026-09-17' });
  assert.equal(report.totals.count, 2);
  assert.equal(report.totals.noRefutable, 1);
  assert.equal(report.totals.queja, 0, 'los no refutables no son quejas pendientes');
  assert.equal(report.totals.refutadoAceptado, 1);
  // Sin estado disputado el dinero queda en «sin disputar» y entra en $ perdido.
  assert.equal(report.totals.undisputedAmount, 8000);
  assert.equal(report.totals.recoveredAmount, 2000);
  assert.equal(report.totals.lostAmount, 8000);

  const csv = buildRegistryCsv(report.items);
  assert.match(csv, /motivo_no_refutable/);
  assert.match(csv, /Queja real/);
});

test('report ranks rejection and unrefutable reasons with shares, money and comments', () => {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'PEYA-2', amount: 2000 }),
    complaint({ orderCode: 'PEYA-3', amount: 1000 }),
    complaint({ orderCode: 'PEYA-4', amount: 500 }),
  ]).store;
  const ids = Object.keys(store.items);
  store = patchHistoryItem(store, ids[0], {
    status: COMPLAINT_STATUSES.refutado_rechazado,
    rejectionReason: 'Ticket ilegible · abajo roto',
  });
  store = patchHistoryItem(store, ids[1], {
    status: COMPLAINT_STATUSES.refutado_rechazado,
    rejectionReason: 'Ticket ilegible',
  });
  store = patchHistoryItem(store, ids[2], {
    status: COMPLAINT_STATUSES.refutado_rechazado,
    rejectionReason: 'motivo inventado',
  });
  store = patchHistoryItem(store, ids[3], {
    status: COMPLAINT_STATUSES.no_refutable,
    unrefutableReason: 'No hay foto · sin evidencia',
  });

  const report = buildComplaintReport(store, { from: '2026-09-17', to: '2026-09-17' });

  assert.equal(report.rejectionReasons.length, 2, 'se agrupa por preset: preset y Otro');
  const ticket = report.rejectionReasons[0];
  assert.equal(ticket.key, 'Ticket ilegible');
  assert.equal(ticket.count, 2);
  assert.ok(Math.abs(ticket.sharePct - (2 / 3) * 100) < 0.0001, 'el % es sobre el total de refutado_rechazado');
  assert.equal(ticket.complaintAmount, 10000);
  assert.equal(ticket.lostAmount, 10000);
  assert.deepEqual(ticket.comments, ['abajo roto'], 'solo el comentario libre y sin repetir');

  const unknown = report.rejectionReasons[1];
  assert.equal(unknown.key, 'Otro');
  assert.equal(unknown.count, 1);
  assert.deepEqual(unknown.comments, []);

  assert.equal(report.unrefutableReasons.length, 1);
  const unrefutable = report.unrefutableReasons[0];
  assert.equal(unrefutable.key, 'No hay foto');
  assert.equal(unrefutable.count, 1);
  assert.equal(unrefutable.sharePct, 100);
  assert.equal(unrefutable.complaintAmount, 500);
  assert.equal(unrefutable.lostAmount, 500);
  assert.deepEqual(unrefutable.comments, ['sin evidencia']);
});

test('registry CSV includes motivo_rechazo right after motivo_no_refutable', () => {
  let store = upsertHistoryItems(emptyHistory(), [complaint()]).store;
  const id = Object.keys(store.items)[0];
  store = patchHistoryItem(store, id, {
    status: COMPLAINT_STATUSES.refutado_rechazado,
    rejectionReason: 'Foto incompleta · falta medio pedido',
  });
  const report = buildComplaintReport(store, { from: '2026-09-17', to: '2026-09-17' });
  const csv = buildRegistryCsv(report.items);
  const header = csv.trim().split('\n')[0];
  assert.match(header, /motivo_no_refutable,motivo_rechazo,foto/);
  assert.match(csv, /Foto incompleta · falta medio pedido/);
});

test('buildReportWorkbook produces multi-sheet workbook with 6 sheets and proper data', async () => {
  const store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'RAPPI-1', amount: 3000, combo: 'Twister' }),
  ]).store;
  const report = buildComplaintReport(store, { from: '2026-09-17', to: '2026-09-17' });
  const { buildReportWorkbook, buildRegistryWorkbook } = await import('./complaintReport.js');
  const { generateXlsxBlob } = await import('./xlsxExport.js');

  const wb = buildReportWorkbook(report);
  assert.equal(wb.sheets.length, 6);
  assert.equal(wb.sheets[0].name, 'Resumen');
  assert.equal(wb.sheets[1].name, 'Por Agregador');
  assert.equal(wb.sheets[2].name, 'Top Combos');
  assert.equal(wb.sheets[3].name, 'Por Motivo');
  assert.equal(wb.sheets[4].name, 'Por Día');
  assert.equal(wb.sheets[5].name, 'Detalle de Quejas');

  const blob = generateXlsxBlob(wb);
  assert.ok(blob);
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(blob.size > 1000, `Blob size is ${blob.size}`);

  const regWb = buildRegistryWorkbook(report.items);
  assert.equal(regWb.sheets.length, 1);
  const regBlob = generateXlsxBlob(regWb);
  assert.ok(regBlob.size > 500);
});

test('generateReportHtml generates executive HTML with print-color-adjust, KPIs, and progress bar', async () => {
  const store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'RAPPI-1', amount: 3000, combo: 'Twister' }),
  ]).store;
  const report = buildComplaintReport(store, { from: '2026-09-17', to: '2026-09-17' });
  const { generateReportHtml } = await import('./pdfReportGenerator.js');

  const html = generateReportHtml(report, { includeDetail: true });
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Delivery La Plata'));
  assert.ok(html.includes('print-color-adjust: exact'));
  assert.ok(html.includes('kpi-grid'));
  assert.ok(html.includes('status-panel'));
  assert.ok(html.includes('insights-box'));
  assert.ok(html.includes('Anexo: Registro Detallado de Reclamos'));
  assert.ok(html.includes('Combo Crispy'));
});


