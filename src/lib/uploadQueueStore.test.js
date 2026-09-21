import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  createMemoryQueueStore,
  fileFromStoredBlob,
  hydrateQueueRecord,
  isInterruptedQueueStatus,
  listQueueRecords,
  putQueueRecord,
  serializeQueueRecord,
  shouldRestoreQueueRecord,
  useQueueStoreForTests,
} from './uploadQueueStore.js';

afterEach(() => {
  useQueueStoreForTests(null);
});

function sampleItem(overrides = {}) {
  const file = new File([Uint8Array.from([1, 2, 3])], 'evidencia.jpg', { type: 'image/jpeg' });
  const ticketFile = new File([Uint8Array.from([4, 5, 6])], 'ticket.jpg', { type: 'image/jpeg' });
  return {
    id: 'queue-1',
    file,
    ticketFile,
    kind: 'order',
    orderDigits: '',
    title: '',
    aggregator: '',
    label: 'Leyendo el código…',
    meta: { taken_by: 'Sofi' },
    status: 'pending',
    error: null,
    createdAt: 1700000000000,
    ...overrides,
  };
}

test('serialize and hydrate keep ticket and evidence files', () => {
  const item = sampleItem();
  const record = serializeQueueRecord(item);
  const restored = hydrateQueueRecord(record);

  assert.equal(restored.id, 'queue-1');
  assert.equal(restored.status, 'pending');
  assert.equal(restored.file.name, 'evidencia.jpg');
  assert.equal(restored.ticketFile.name, 'ticket.jpg');
  assert.equal(restored.meta.taken_by, 'Sofi');
});

test('interrupted analyzing and uploading jobs resume as pending', () => {
  assert.equal(isInterruptedQueueStatus('analyzing'), true);
  assert.equal(isInterruptedQueueStatus('uploading'), true);
  assert.equal(isInterruptedQueueStatus('pending'), false);

  const analyzing = hydrateQueueRecord(serializeQueueRecord(sampleItem({
    status: 'analyzing',
    label: 'Leyendo el código…',
  })));
  assert.equal(analyzing.status, 'pending');
  assert.equal(analyzing.error, null);

  const uploading = hydrateQueueRecord(serializeQueueRecord(sampleItem({
    status: 'uploading',
    orderDigits: 'PEYA12345',
    aggregator: 'pedidosya',
    label: 'Pedido #PEYA12345',
  })));
  assert.equal(uploading.status, 'pending');
  assert.equal(uploading.orderDigits, 'PEYA12345');
  assert.equal(uploading.aggregator, 'pedidosya');
});

test('finished jobs are not restored', () => {
  const done = serializeQueueRecord(sampleItem({ status: 'done' }));
  assert.equal(shouldRestoreQueueRecord(done), false);
  assert.equal(hydrateQueueRecord(done), null);
});

test('error jobs stay in the queue so they can be retried after reload', () => {
  const uploadError = serializeQueueRecord(sampleItem({
    status: 'error',
    error: 'Error al subir la foto.',
    orderDigits: 'PEYA1',
    ticketFile: null,
    label: 'Pedido #PEYA1',
  }));
  const restoredUpload = hydrateQueueRecord(uploadError);
  assert.equal(restoredUpload.status, 'error');
  assert.equal(restoredUpload.error, 'Error al subir la foto.');
});

test('background OCR errors resume as pending instead of staying failed', () => {
  const record = serializeQueueRecord(sampleItem({
    status: 'error',
    error: 'No se pudo leer el ticket.',
  }));
  const restored = hydrateQueueRecord(record);
  assert.equal(restored.status, 'pending');
  assert.equal(restored.error, null);
  assert.equal(restored.label, 'Leyendo el código…');
});

test('memory store keeps records across a simulated close', async () => {
  const store = createMemoryQueueStore();
  useQueueStoreForTests(store);

  const item = sampleItem({ status: 'analyzing' });
  await putQueueRecord(serializeQueueRecord(item));

  const records = await listQueueRecords();
  assert.equal(records.length, 1);
  const restored = hydrateQueueRecord(records[0]);
  assert.equal(restored.status, 'pending');
  assert.equal(restored.ticketFile.name, 'ticket.jpg');
});

test('serialize keeps a stable storage path for retries', () => {
  const item = sampleItem({
    status: 'uploading',
    orderDigits: 'PEYA12345',
    storagePath: 'orders/pedidosya/abc.jpg',
  });
  const restored = hydrateQueueRecord(serializeQueueRecord(item));
  assert.equal(restored.storagePath, 'orders/pedidosya/abc.jpg');
  assert.equal(restored.status, 'pending');
});

test('restored jobs retain the worker lease so the page cannot upload them twice', () => {
  const restored = hydrateQueueRecord(serializeQueueRecord(sampleItem({
    leaseOwner: 'sw',
    leaseUntil: Date.now() + 10_000,
  })));
  assert.equal(restored.leaseOwner, 'sw');
  assert.ok(restored.leaseUntil > Date.now());
});

test('fileFromStoredBlob rebuilds a File from a saved blob', () => {
  const blob = new Blob([Uint8Array.from([9, 8, 7])], { type: 'image/jpeg' });
  const file = fileFromStoredBlob(blob, 'ticket.jpg', 'image/jpeg');
  assert.equal(file.name, 'ticket.jpg');
  assert.equal(file.type, 'image/jpeg');
});
