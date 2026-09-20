import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { processQueueItem } from './uploadQueueProcessor.js';
import { processStoredUploadQueue, resetStoredUploadQueueForTests } from './uploadQueueDrain.js';
import {
  createMemoryQueueStore,
  serializeQueueRecord,
  useQueueStoreForTests,
} from './uploadQueueStore.js';

afterEach(() => {
  useQueueStoreForTests(null);
  resetStoredUploadQueueForTests();
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
    storagePath: '',
    ...overrides,
  };
}

function mockDeps(overrides = {}) {
  const uploaded = [];
  return {
    uploaded,
    detectOrderFromPhoto: async () => ({ displayCode: 'PEYA12345', aggregator: 'pedidosya' }),
    compressImage: async (file) => file,
    uploadFile: async () => {
      throw new Error('no debería subir un archivo');
    },
    uploadPhoto: async (file, orderDigits, meta, aggregator, filePath) => {
      uploaded.push({ orderDigits, aggregator, filePath });
      return { id: 'photo-1', name: orderDigits, file_path: filePath };
    },
    uploadUnidentifiedOrder: async () => {
      throw new Error('no debería subir sin código');
    },
    persist: async () => {},
    notify: () => {},
    ...overrides,
  };
}

test('processQueueItem reads the ticket and then uploads with a stable path', async () => {
  const item = sampleItem();
  const deps = mockDeps();
  const result = await processQueueItem(item, deps);

  assert.equal(item.status, 'done');
  assert.equal(item.orderDigits, 'PEYA12345');
  assert.equal(item.ticketFile, null);
  assert.equal(result.photo.name, 'PEYA12345');
  assert.equal(deps.uploaded.length, 1);
  assert.equal(deps.uploaded[0].aggregator, 'pedidosya');
  assert.equal(deps.uploaded[0].filePath, item.storagePath);
  assert.match(item.storagePath, /^orders\/pedidosya\//);
});

test('processQueueItem yields instead of failing when the page is handed off', async () => {
  const item = sampleItem();
  let started = false;
  const result = await processQueueItem(item, mockDeps({
    shouldYield: () => started,
    detectOrderFromPhoto: async () => {
      started = true;
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    },
  }));

  assert.equal(result.yielded, true);
  assert.notEqual(item.status, 'error');
});

test('the stored queue uploads coded jobs and leaves OCR jobs pending', async () => {
  const store = createMemoryQueueStore();
  useQueueStoreForTests(store);

  const first = sampleItem({ id: 'one', createdAt: 1 });
  const second = sampleItem({
    id: 'two',
    createdAt: 2,
    orderDigits: 'RAPPI99',
    aggregator: 'rappi',
    ticketFile: null,
    label: 'Pedido #RAPPI99',
  });
  await store.put(serializeQueueRecord(first));
  await store.put(serializeQueueRecord(second));

  const uploaded = [];
  let ocrCalls = 0;
  await processStoredUploadQueue({
    detectOrderFromPhoto: async () => {
      ocrCalls += 1;
      throw new Error('No se pudo leer el ticket.');
    },
    compressImage: async (file) => file,
    uploadFile: async () => {
      throw new Error('no file');
    },
    uploadPhoto: async (file, orderDigits, meta, aggregator, filePath) => {
      uploaded.push({ orderDigits, aggregator, filePath });
      return { id: orderDigits, name: orderDigits, file_path: filePath };
    },
    uploadUnidentifiedOrder: async () => {
      throw new Error('no unidentified');
    },
  });

  assert.equal(ocrCalls, 0);
  assert.deepEqual(uploaded.map((item) => item.orderDigits), ['RAPPI99']);
  const remaining = await store.list();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'one');
  assert.notEqual(remaining[0].status, 'error');
});

test('OCR engine errors while the app is hidden stay pending', async () => {
  const original = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  try {
    const item = sampleItem();
    const result = await processQueueItem(item, mockDeps({
      detectOrderFromPhoto: async () => {
        globalThis.document.visibilityState = 'hidden';
        throw new Error('No se pudo leer el ticket.');
      },
    }));

    assert.equal(result.yielded, true);
    assert.notEqual(item.status, 'error');
    assert.equal(item.error, null);
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test('successful OCR while hidden keeps the code instead of failing', async () => {
  const original = globalThis.document;
  globalThis.document = { visibilityState: 'visible' };
  try {
    const item = sampleItem();
    const result = await processQueueItem(item, mockDeps({
      detectOrderFromPhoto: async () => {
        globalThis.document.visibilityState = 'hidden';
        return { displayCode: 'PEYA12345', aggregator: 'pedidosya' };
      },
    }));

    assert.equal(result.yielded, true);
    assert.equal(item.orderDigits, 'PEYA12345');
    assert.equal(item.aggregator, 'pedidosya');
    assert.notEqual(item.status, 'error');
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test('OCR engine errors while visible still fail', async () => {
  const item = sampleItem();
  await assert.rejects(() => processQueueItem(item, mockDeps({
    detectOrderFromPhoto: async () => {
      throw new Error('No se pudo leer el ticket.');
    },
  })));
  assert.equal(item.status, 'error');
  assert.equal(item.error, 'No se pudo leer el ticket.');
});

test('the worker does not run OCR even if a reader is provided', async () => {
  const item = sampleItem();
  let ocrCalls = 0;
  const result = await processQueueItem(item, mockDeps({
    allowOcr: false,
    detectOrderFromPhoto: async () => {
      ocrCalls += 1;
      throw new Error('No se pudo leer el ticket.');
    },
  }));

  assert.equal(result.yielded, true);
  assert.equal(ocrCalls, 0);
  assert.notEqual(item.status, 'error');
});
