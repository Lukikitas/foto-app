import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attachPhotosToHistory,
  complaintHistoryId,
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
    complaint({ reason: 'Faltó producto', comment: 'Confirmado por el local' }),
  ]);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);
  assert.equal(Object.keys(second.store.items).length, 1);
  const item = Object.values(second.store.items)[0];
  assert.match(item.comment, /Sin papas/);
  assert.match(item.comment, /Confirmado por el local/);
  assert.equal(item.accepted, false);
  assert.equal(item.refutado, false);
});

test('keeps accepted and refutado flags when the same complaint is imported again', () => {
  const seeded = upsertHistoryItems(emptyHistory(), [complaint()]);
  const id = Object.keys(seeded.store.items)[0];
  const marked = patchHistoryItem(seeded.store, id, { accepted: true, refutado: true });
  const again = upsertHistoryItems(marked, [complaint({ comment: 'Sheet de nuevo' })]);
  const item = Object.values(again.store.items)[0];
  assert.equal(item.accepted, true);
  assert.equal(item.refutado, true);
  assert.equal(historyResolution(item), 'refutado_aceptado');
});

test('history can be filtered by aggregator and lists every sheet field', () => {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({
      orderCode: 'RAPPI-480403041',
      orderAtIso: '2026-09-17T18:00:00.000-03:00',
      reason: 'Frío',
      comment: '',
    }),
  ]).store;
  const rappi = listHistoryItems(store, { aggregator: 'rappi' });
  assert.equal(rappi.length, 1);
  assert.equal(rappi[0].orderCode, 'RAPPI-480403041');
  assert.equal(rappi[0].reason, 'Frío');
  assert.equal(listHistoryItems(store, { search: '2286878556' }).length, 1);
  assert.equal(listHistoryItems(store, { search: 'faltó' }).length, 1);
});

test('groups accepted, refuted and refuted-accepted counts by day and aggregator', () => {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'PEYA-1', orderAtIso: '2026-09-17T12:00:00.000-03:00' }),
    complaint({ orderCode: 'PEYA-2', orderAtIso: '2026-09-17T13:00:00.000-03:00' }),
  ]).store;
  const ids = Object.keys(store.items);
  store = patchHistoryItem(store, ids[0], { accepted: true });
  store = patchHistoryItem(store, ids[1], { refutado: true });
  store = patchHistoryItem(store, ids[2], { accepted: true, refutado: true });
  const flags = groupHistoryFlags(store, '2026-09-17', '2026-09-17');
  assert.equal(flags['2026-09-17'].pedidosya.accepted, 2);
  assert.equal(flags['2026-09-17'].pedidosya.refuted, 2);
  assert.equal(flags['2026-09-17'].pedidosya.refutedAccepted, 1);
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
  assert.equal(item.refutado, true);
  assert.equal(item.aggregator, 'pedidosya');
  const view = historyItemToRow(item);
  assert.equal(view.photo.public_url, 'https://example.com/1.jpg');
  assert.equal(view.history.accepted, false);
});

test('parseHistory drops broken records and keeps a valid map', () => {
  const parsed = parseHistory({
    items: {
      a: { orderCode: 'PEYA-1', orderAtIso: '2026-09-17T12:00:00.000-03:00', accepted: true },
      b: { orderCode: '' },
    },
  });
  assert.equal(Object.keys(parsed.items).length, 1);
  assert.equal(Object.values(parsed.items)[0].accepted, true);
});
