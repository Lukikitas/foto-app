import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { processQueueItem } from './uploadQueueProcessor.js';
import { processStoredUploadQueue, resetStoredUploadQueueForTests } from './uploadQueueDrain.js';
import { applyLease, QUEUE_OWNER } from './uploadQueueProtocol.js';
import {
  createMemoryQueueStore,
  serializeQueueRecord,
  useQueueStoreForTests,
} from './uploadQueueStore.js';
import { deleteUnresolvedTicket, getUnresolvedTicket } from './unresolvedTicketStore.js';

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
    retainUnresolvedTicket: async () => {},
    ...overrides,
  };
}

test('processQueueItem reads the ticket and then uploads with a stable path', async () => {
  const item = sampleItem();
  let fallbackFile;
  const deps = mockDeps({
    detectOrderFromPhoto: async (ticket, options) => {
      assert.equal(ticket, item.ticketFile);
      fallbackFile = options.fallbackFiles[0];
      return { displayCode: 'PEYA12345', aggregator: 'pedidosya' };
    },
  });
  const result = await processQueueItem(item, deps);

  assert.equal(fallbackFile, item.file);
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

test('the stored queue reads tickets and uploads their evidence without the page', async () => {
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
      return { displayCode: 'PEYA12345', aggregator: 'pedidosya' };
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

  assert.equal(ocrCalls, 1);
  assert.deepEqual(uploaded.map((item) => item.orderDigits), ['PEYA12345', 'RAPPI99']);
  const remaining = await store.list();
  assert.equal(remaining.length, 0);
});

test('the background worker resumes a ticket after the closing page lease expires', async () => {
  const store = createMemoryQueueStore();
  useQueueStoreForTests(store);
  await store.put(applyLease(serializeQueueRecord(sampleItem()), QUEUE_OWNER.page, Date.now(), 20));
  let uploaded = false;
  await processStoredUploadQueue({
    detectOrderFromPhoto: async () => ({ displayCode: 'PEYA12345', aggregator: 'pedidosya' }),
    compressImage: async (file) => file,
    uploadFile: async () => { throw new Error('no file'); },
    uploadPhoto: async () => {
      uploaded = true;
      return { id: 'photo-1' };
    },
    uploadUnidentifiedOrder: async () => { throw new Error('no unidentified'); },
  });
  assert.equal(uploaded, true);
  assert.equal((await store.list()).length, 0);
});

test('the ticket is discarded as soon as its code is safely persisted', async () => {
  const item = sampleItem();
  const saved = [];
  await processQueueItem(item, mockDeps({
    persist: async (entry) => saved.push(serializeQueueRecord(entry)),
    compressImage: async (file) => {
      assert.equal(item.ticketFile, null);
      return file;
    },
  }));
  const identified = saved.find((record) => record.orderDigits === 'PEYA12345');
  assert.equal(identified.ticket, null);
});

test('order evidence gets higher-quality processing without changing generic files', async () => {
  const options = [];
  await processQueueItem(sampleItem(), mockDeps({
    compressImage: async (file, config) => {
      options.push(config);
      return file;
    },
  }));
  assert.equal(options[0].maxDimension, 2400);
  assert.equal(options[0].sharpen, true);
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

test('OCR engine errors still save the important evidence in the no-code category', async () => {
  const item = sampleItem();
  let savedWithoutCode = false;
  let retainedTicket = null;
  await processQueueItem(item, mockDeps({
    onOcrError: () => {},
    detectOrderFromPhoto: async () => {
      throw new Error('No se pudo leer el ticket.');
    },
    uploadUnidentifiedOrder: async () => {
      savedWithoutCode = true;
      return { id: 'no-code' };
    },
    retainUnresolvedTicket: async (photoId, ticket) => {
      retainedTicket = { photoId, ticket };
    },
  }));
  assert.equal(savedWithoutCode, true);
  assert.equal(retainedTicket.photoId, 'no-code');
  assert.equal(retainedTicket.ticket.name, 'ticket.jpg');
  assert.equal(item.status, 'done');
  assert.equal(item.ticketFile, null);
  assert.match(item.storagePath, /^orders\/no_code\//);
});

test('a reliable cloud fallback identifies an uploaded no-code order after local OCR fails', async () => {
  const item = sampleItem();
  const calls = [];
  const result = await processQueueItem(item, mockDeps({
    detectOrderFromPhoto: async () => null,
    uploadUnidentifiedOrder: async () => ({ id: 'unread-photo', name: 'Código no encontrado' }),
    keepTicketForRecovery: async (id, ticket) => {
      calls.push(['keep', id, ticket.name]);
      return true;
    },
    recoverOrderCodeInCloud: async (id) => {
      calls.push(['cloud', id]);
      return { displayCode: 'PEYA2298878868', aggregator: 'pedidosya', reliable: true };
    },
    releaseCloudTicket: async (id) => calls.push(['release', id]),
  }));
  assert.deepEqual(calls, [
    ['keep', 'unread-photo', 'ticket.jpg'],
    ['cloud', 'unread-photo'],
    ['release', 'photo-1'],
  ]);
  assert.equal(result.photo.name, 'PEYA2298878868');
  assert.equal(item.orderDigits, 'PEYA2298878868');
  assert.equal(item.status, 'done');
});

test('an uncertain cloud code stays pending for human review', async () => {
  const item = sampleItem();
  let corrected = false;
  const result = await processQueueItem(item, mockDeps({
    detectOrderFromPhoto: async () => null,
    uploadUnidentifiedOrder: async () => ({ id: 'unread-photo', name: 'Código no encontrado' }),
    uploadPhoto: async () => { corrected = true; throw new Error('no automatic correction'); },
    recoverOrderCodeInCloud: async () => ({ displayCode: 'PEYA2298878868', aggregator: 'pedidosya', reliable: false }),
  }));
  assert.equal(corrected, false);
  assert.equal(result.photo.name, 'Código no encontrado');
  assert.equal(item.orderDigits, '');
  assert.equal(item.status, 'done');
});

test('the background worker retains an unread ticket after uploading its no-code evidence', async () => {
  const store = createMemoryQueueStore();
  useQueueStoreForTests(store);
  await store.put(serializeQueueRecord(sampleItem({ id: 'unread-worker' })));
  try {
    await processStoredUploadQueue({
      detectOrderFromPhoto: async () => null,
      compressImage: async (file) => file,
      uploadFile: async () => { throw new Error('no file'); },
      uploadPhoto: async () => { throw new Error('no identified order'); },
      uploadUnidentifiedOrder: async () => ({ id: 'unread-photo' }),
    });
    assert.equal((await store.list()).length, 0);
    assert.equal((await getUnresolvedTicket('unread-photo'))?.name, 'ticket.jpg');
  } finally {
    await deleteUnresolvedTicket('unread-photo');
  }
});

test('an unread ticket remains retryable if it cannot be archived locally', async () => {
  const item = sampleItem();
  await assert.rejects(processQueueItem(item, mockDeps({
    detectOrderFromPhoto: async () => null,
    uploadUnidentifiedOrder: async () => ({ id: 'unread-photo' }),
    retainUnresolvedTicket: async () => { throw new Error('local storage full'); },
  })), /local storage full/);
  assert.equal(item.status, 'error');
  assert.equal(item.ticketFile?.name, 'ticket.jpg');
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
