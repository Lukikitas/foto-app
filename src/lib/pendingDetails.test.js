import test from 'node:test';
import assert from 'node:assert/strict';
import { complaintDetails, dailyDataOrigin } from './pendingDetails.js';
import { emptyHistory, normalizeHistoryItem, parseHistory, patchHistoryItem } from './complaintHistory.js';
import { mergeDraft } from './complaintDraft.js';

const complaint = { id: 'PEYA123456|2026-10-09', orderCode: 'PEYA123456', day: '2026-10-09', aggregator: 'pedidosya',
  reason: 'missing item', amount: 0, timeOfDay: '23:15', status: 'queja' };

test('daily origins separate manual, Excel, mixed fields and unknown history without making saved data pending', () => {
  assert.equal(dailyDataOrigin({ sources: { orders: 'manual', complaints: 'manual', awt: 'manual' } }, 'pedidosya').kind, 'manual');
  assert.equal(dailyDataOrigin({ sources: { orders: 'excel_pedidosya', complaints: 'excel_pedidosya', awt: 'excel_pedidosya' } }, 'pedidosya').kind, 'excel');
  const mixed = dailyDataOrigin({ sources: { orders: 'manual', complaints: 'excel_rappi' } }, 'rappi');
  assert.equal(mixed.label, 'Manual + Excel');
  assert.deepEqual(mixed.entries.map(entry => entry.origin), ['Carga manual', 'Excel Rappi']);
  assert.equal(dailyDataOrigin({ orders: 50, complaints: 0 }, 'rappi').kind, 'unknown');
  assert.equal(dailyDataOrigin({ sources: { complaints: 'excel_rappi' } }, 'rappi').kind, 'mixed');
});

test('only marking a photo cannot claim full complaint details despite having date, time and evidence', () => {
  const details = complaintDetails({ ...complaint, reason: 'Pendiente de cargar detalles del reclamo', detailOrigin: 'photo', photoId: 'photo' });
  assert.equal(details.state, 'marked');
  assert.ok(details.missing.includes('motivo'));
  assert.equal(details.excel, false);
});

test('optional comments do not block complete details, zero is an informed amount and PedidosYa expects a time', () => {
  assert.equal(complaintDetails(complaint).state, 'complete');
  const missing = complaintDetails({ ...complaint, amount: null, timeOfDay: null });
  assert.deepEqual(missing.missing, ['monto', 'hora']);
  assert.equal(missing.state, 'partial');
});

test('a Rappi Excel without hour or comments is valid and never borrows the camera time', () => {
  const details = complaintDetails({ ...complaint, aggregator: 'rappi', detailOrigin: 'excel_rappi', timeOfDay: null, photoId: 'photo' });
  assert.equal(details.state, 'complete');
  assert.equal(details.time, 'El Excel no trae hora');
  assert.equal(details.comment, '');
  assert.equal(details.excel, true);
  assert.equal(complaintDetails({ ...complaint, aggregator: 'rappi', timeOfDay: null }).time, 'Hora no informada');
});

test('legacy complaints do not receive an invented Excel origin based on reason text or daily totals', () => {
  const normalized = normalizeHistoryItem(complaint);
  assert.equal(normalized.detailOrigin, '');
  assert.equal(complaintDetails(normalized).origin, 'Origen no registrado');
  assert.equal(normalizeHistoryItem({ ...complaint, detailOrigin: 'untrusted-value' }).detailOrigin, '');
});

test('review confirmation records the actual import method even for manually entered PedidosYa codes', () => {
  for (const [source, origin] of [['manual', 'manual'], ['peya', 'excel_pedidosya'], ['rappi', 'excel_rappi'], ['sheet', 'sheet'], ['codes', 'codes']]) {
    const result = mergeDraft(emptyHistory(), { source, complaints: [complaint] });
    assert.equal(Object.values(result.store.items)[0].detailOrigin, origin);
  }
});

test('origin survives reload, resolution changes and manual detail edits without rewriting the import method', () => {
  const result = mergeDraft(emptyHistory(), { source: 'peya', complaints: [complaint] });
  const [item] = Object.values(result.store.items);
  const resolved = patchHistoryItem(result.store, item.id, { status: 'refutado' });
  assert.equal(resolved.items[item.id].detailEdited, false);
  const edited = patchHistoryItem(resolved, item.id, { comment: 'Revisado por el encargado' });
  const restored = parseHistory(JSON.parse(JSON.stringify(edited)));
  assert.equal(restored.items[item.id].detailOrigin, 'excel_pedidosya');
  assert.equal(restored.items[item.id].detailEdited, true);
});
