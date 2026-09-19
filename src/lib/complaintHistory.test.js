import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attachPhotosToHistory,
  clearHistoryItems,
  complaintHistoryId,
  COMPLAINT_STATUSES,
  deleteHistoryItem,
  emptyHistory,
  groupHistoryFlags,
  historyItemToRow,
  historyResolution,
  listHistoryItems,
  parseHistory,
  patchHistoryItem,
  upsertHistoryItems,
} from './complaintHistory.js';

function complaint(overrides = {}) {
  return {
    orderCode: 'PEYA-2286878556',
    orderAtIso: '2026-09-17T17:51:00.000-03:00',
    timeOfDay: '17:51',
    dateAssumed: false,
    reason: 'Faltó producto',
    comment: 'Sin papas',
    combo: 'Combo Crispy',
    amount: 8990,
    fields: { Local: 'La Plata' },
    ...overrides,
  };
}

test('history ids collapse the same order on the same day', () => {
  const first = complaintHistoryId(complaint());
  const again = complaintHistoryId(
    complaint({ reason: 'Otro texto', comment: 'Reenvío del sheet' }),
  );
  assert.equal(first, again);
  assert.notEqual(
    first,
    complaintHistoryId(complaint({ orderAtIso: '2026-09-18T17:51:00.000-03:00' })),
  );
});

test('re-uploading a sheet updates the same row instead of copying it', () => {
  const first = upsertHistoryItems(emptyHistory(), [complaint()]);
  assert.equal(first.added, 1);
  assert.equal(first.updated, 0);
  assert.equal(Object.keys(first.store.items).length, 1);

  const second = upsertHistoryItems(first.store, [
    complaint({ reason: 'Faltó producto', comment: 'Confirmado por el local', amount: 9100 }),
  ]);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(Object.keys(second.store.items).length, 1);
  const item = Object.values(second.store.items)[0];
  assert.match(item.comment, /Sin papas/);
  assert.match(item.comment, /Confirmado por el local/);
  assert.equal(item.status, COMPLAINT_STATUSES.queja);
  assert.equal(item.amount, 9100);
  assert.equal(item.fields.Local, 'La Plata');
});

test('keeps resolution status when the same complaint is imported again', () => {
  const seeded = upsertHistoryItems(emptyHistory(), [complaint()]);
  const id = Object.keys(seeded.store.items)[0];
  const marked = patchHistoryItem(seeded.store, id, { status: COMPLAINT_STATUSES.refutado_aceptado });
  const again = upsertHistoryItems(marked, [complaint({ comment: 'Sheet de nuevo' })]);
  const item = Object.values(again.store.items)[0];
  assert.equal(item.status, COMPLAINT_STATUSES.refutado_aceptado);
  assert.equal(historyResolution(item), 'refutado_aceptado');
});

test('migrates old accepted and refutado flags into a single status', () => {
  const parsed = parseHistory({
    items: {
      a: { orderCode: 'PEYA-1', orderAtIso: '2026-09-17T12:00:00.000-03:00', accepted: true, refutado: true },
      b: { orderCode: 'PEYA-2', orderAtIso: '2026-09-17T12:00:00.000-03:00', refutado: true },
      c: { orderCode: 'PEYA-3', orderAtIso: '2026-09-17T12:00:00.000-03:00', accepted: true },
    },
  });
  const statuses = Object.values(parsed.items).map((item) => item.status).sort();
  assert.deepEqual(statuses, [
    COMPLAINT_STATUSES.refutado,
    COMPLAINT_STATUSES.refutado_aceptado,
    COMPLAINT_STATUSES.refutado_rechazado,
  ]);
});

test('history can be filtered by aggregator and lists every sheet field', () => {
  const store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({
      orderCode: 'RAPPI-480403041',
      orderAtIso: '2026-09-17T18:00:00.000-03:00',
      reason: 'Frío',
      comment: '',
      combo: 'Twister',
    }),
  ]).store;
  const rappi = listHistoryItems(store, { aggregator: 'rappi' });
  assert.equal(rappi.length, 1);
  assert.equal(rappi[0].orderCode, 'RAPPI-480403041');
  assert.equal(rappi[0].reason, 'Frío');
  assert.equal(listHistoryItems(store, { search: '2286878556' }).length, 1);
  assert.equal(listHistoryItems(store, { search: 'faltó' }).length, 1);
  assert.equal(listHistoryItems(store, { search: 'crispy' }).length, 1);
});

test('groups statuses and recovered money by day and aggregator', () => {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'PEYA-1', orderAtIso: '2026-09-17T12:00:00.000-03:00', amount: 1000 }),
    complaint({ orderCode: 'PEYA-2', orderAtIso: '2026-09-17T13:00:00.000-03:00', amount: 2000 }),
  ]).store;
  const ids = Object.keys(store.items);
  store = patchHistoryItem(store, ids[0], { status: COMPLAINT_STATUSES.refutado_rechazado });
  store = patchHistoryItem(store, ids[1], { status: COMPLAINT_STATUSES.refutado });
  store = patchHistoryItem(store, ids[2], { status: COMPLAINT_STATUSES.refutado_aceptado });
  const flags = groupHistoryFlags(store, '2026-09-17', '2026-09-17');
  const peya = flags['2026-09-17'].pedidosya;
  assert.equal(peya.refutadoRechazado, 1);
  assert.equal(peya.refutado, 1);
  assert.equal(peya.refutadoAceptado, 1);
  assert.equal(peya.complaintAmount, 11990);
  assert.equal(peya.recoveredAmount, 2000);
  assert.equal(peya.lostAmount, 9990);
});

test('groups money from complaints without a known aggregator', () => {
  const store = upsertHistoryItems(emptyHistory(), [
    complaint({ orderCode: '4696', amount: 3500 }),
  ]).store;
  const flags = groupHistoryFlags(store, '2026-09-17', '2026-09-17');
  assert.equal(flags['2026-09-17'].sin_agregador.complaintAmount, 3500);
  assert.equal(flags['2026-09-17'].sin_agregador.queja, 1);
});

test('attaches a matched photo without duplicating the history row', () => {
  const seeded = upsertHistoryItems(emptyHistory(), [complaint()]);
  const row = {
    complaint: complaint(),
    photo: {
      id: 'photo-1',
      name: 'PEYA-2286878556',
      public_url: 'https://example.com/1.jpg',
      is_refutado: true,
    },
  };
  const next = attachPhotosToHistory(seeded.store, [row]);
  assert.equal(Object.keys(next.items).length, 1);
  const item = Object.values(next.items)[0];
  assert.equal(item.photoId, 'photo-1');
  assert.equal(item.photoUrl, 'https://example.com/1.jpg');
  assert.equal(item.status, COMPLAINT_STATUSES.refutado);
  assert.equal(item.aggregator, 'pedidosya');
  const view = historyItemToRow(item);
  assert.equal(view.photo.public_url, 'https://example.com/1.jpg');
  assert.equal(view.complaint.amount, 8990);
});

test('deletes one complaint or the whole history', () => {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'PEYA-1', orderAtIso: '2026-09-17T12:00:00.000-03:00' }),
  ]).store;
  const id = Object.keys(store.items)[0];
  store = deleteHistoryItem(store, id);
  assert.equal(Object.keys(store.items).length, 1);
  store = clearHistoryItems(store);
  assert.equal(Object.keys(store.items).length, 0);
});

test('parseHistory drops broken records and keeps a valid map', () => {
  const parsed = parseHistory({
    items: {
      a: { orderCode: 'PEYA-1', orderAtIso: '2026-09-17T12:00:00.000-03:00', accepted: true },
      b: { orderCode: '' },
    },
  });
  assert.equal(Object.keys(parsed.items).length, 1);
  assert.equal(Object.values(parsed.items)[0].status, COMPLAINT_STATUSES.refutado_rechazado);
});
