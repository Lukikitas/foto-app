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
  PENDING_COMPLAINT_DETAILS,
  syncGalleryComplaintInStore,
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

test('a chosen import aggregator classifies codes without a prefix', () => {
  const store = upsertHistoryItems(emptyHistory(), [
    complaint({ orderCode: '2093192289', aggregator: 'rappi' }),
  ]).store;
  assert.equal(Object.values(store.items)[0].aggregator, 'rappi');
});

test('without an import aggregator the code prefix still decides', () => {
  const store = upsertHistoryItems(emptyHistory(), [complaint()]).store;
  assert.equal(Object.values(store.items)[0].aggregator, 'pedidosya');
});

test('history can be filtered by a single day or a period', () => {
  const store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({
      orderCode: 'PEYA-2286878999',
      orderAtIso: '2026-09-18T17:51:00.000-03:00',
    }),
    complaint({
      orderCode: 'RAPPI-480403041',
      orderAtIso: '2026-09-19T12:00:00.000-03:00',
    }),
  ]).store;
  const day = listHistoryItems(store, { from: '2026-09-17', to: '2026-09-17' });
  assert.equal(day.length, 1);
  assert.equal(day[0].orderCode, 'PEYA-2286878556');
  const range = listHistoryItems(store, { from: '2026-09-18', to: '2026-09-19' });
  assert.equal(range.length, 2);
  assert.equal(listHistoryItems(store, { from: '2026-09-20', to: '2026-09-20' }).length, 0);
});

test('marking a gallery order creates a pending queja in history', () => {
  const photo = {
    id: 'photo-gal-1',
    name: 'PEYA-2286878556',
    public_url: 'https://example.com/gal.jpg',
    created_at: '2026-09-17T17:51:00.000-03:00',
    has_complaint: true,
    is_refutado: false,
  };
  const store = syncGalleryComplaintInStore(emptyHistory(), photo);
  const items = listHistoryItems(store);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, COMPLAINT_STATUSES.queja);
  assert.equal(items[0].reason, PENDING_COMPLAINT_DETAILS);
  assert.equal(items[0].photoId, 'photo-gal-1');
  assert.equal(items[0].orderCode, 'PEYA-2286878556');
});

test('unmarking a pending gallery complaint removes it from history', () => {
  const photo = {
    id: 'photo-gal-2',
    name: 'PEYA-2286878556',
    public_url: 'https://example.com/gal.jpg',
    created_at: '2026-09-17T17:51:00.000-03:00',
    has_complaint: true,
  };
  const marked = syncGalleryComplaintInStore(emptyHistory(), photo);
  const unmarked = syncGalleryComplaintInStore(marked, { ...photo, has_complaint: false });
  assert.equal(Object.keys(unmarked.items).length, 0);
});

test('unmarking does not delete a complaint that already has sheet details', () => {
  const seeded = upsertHistoryItems(emptyHistory(), [complaint()]).store;
  const photo = {
    id: 'photo-gal-3',
    name: 'PEYA-2286878556',
    public_url: 'https://example.com/gal.jpg',
    created_at: '2026-09-17T17:51:00.000-03:00',
    has_complaint: true,
  };
  const attached = syncGalleryComplaintInStore(seeded, photo);
  const unmarked = syncGalleryComplaintInStore(attached, { ...photo, has_complaint: false });
  const item = Object.values(unmarked.items)[0];
  assert.equal(item.reason, 'Faltó producto');
  assert.equal(item.amount, 8990);
  assert.equal(item.photoId, 'photo-gal-3');
});

test('cruzar replaces pending gallery details with the sheet row', () => {
  const photo = {
    id: 'photo-gal-4',
    name: 'PEYA-2286878556',
    public_url: 'https://example.com/gal.jpg',
    created_at: '2026-09-16T21:10:00.000-03:00',
    has_complaint: true,
  };
  const pending = syncGalleryComplaintInStore(emptyHistory(), photo);
  const pendingItem = Object.values(pending.items)[0];
  assert.equal(pendingItem.reason, PENDING_COMPLAINT_DETAILS);
  assert.notEqual(pendingItem.day, '2026-09-17');

  const crossed = upsertHistoryItems(pending, [complaint()]);
  assert.equal(crossed.added, 0);
  assert.equal(crossed.updated, 1);
  assert.equal(Object.keys(crossed.store.items).length, 1);
  const item = Object.values(crossed.store.items)[0];
  assert.equal(item.reason, 'Faltó producto');
  assert.equal(item.comment, 'Sin papas');
  assert.equal(item.amount, 8990);
  assert.equal(item.combo, 'Combo Crispy');
  assert.equal(item.photoId, 'photo-gal-4');
  assert.equal(item.day, '2026-09-17');
  assert.equal(item.status, COMPLAINT_STATUSES.queja);
  assert.equal(item.id, complaintHistoryId(complaint()));
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
