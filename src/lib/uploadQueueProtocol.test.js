import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyLease,
  buildStoragePath,
  isForeignLeaseActive,
  itemNeedsOcr,
  pickStoredQueueRecord,
  QUEUE_OWNER,
  UPLOAD_QUEUE_MESSAGE,
  UPLOAD_QUEUE_SYNC_TAG,
} from './uploadQueueProtocol.js';

test('camera captures without a code still need OCR', () => {
  assert.equal(itemNeedsOcr({
    kind: 'order',
    orderDigits: '',
    ticketFile: new Blob(['ticket']),
  }), true);
  assert.equal(itemNeedsOcr({
    kind: 'order',
    orderDigits: 'PEYA1',
    ticketFile: new Blob(['ticket']),
  }), false);
  assert.equal(itemNeedsOcr({
    kind: 'order',
    orderDigits: '',
    ticket: new Blob(['ticket']),
  }), true);
});

test('a live lease from the page blocks the service worker', () => {
  const record = applyLease({ id: '1' }, QUEUE_OWNER.page, 1_000, 20_000);
  assert.equal(isForeignLeaseActive(record, QUEUE_OWNER.sw, 5_000), true);
  assert.equal(isForeignLeaseActive(record, QUEUE_OWNER.page, 5_000), false);
  assert.equal(isForeignLeaseActive(record, QUEUE_OWNER.sw, 30_000), false);
});

test('buildStoragePath reuses the path so a retry does not duplicate the file', () => {
  const file = { name: 'foto.jpg', type: 'image/jpeg' };
  const first = buildStoragePath({
    kind: 'order',
    orderDigits: 'PEYA123',
    aggregator: 'pedidosya',
  }, file);
  const retry = buildStoragePath({
    kind: 'order',
    orderDigits: 'PEYA123',
    aggregator: 'pedidosya',
    storagePath: first,
  }, file);
  assert.equal(retry, first);
  assert.match(first, /^orders\/pedidosya\/.+\.jpg$/);
});

test('the worker picks the oldest unlocked job and skips errors', () => {
  const now = 10_000;
  const records = [
    applyLease({ id: 'busy', status: 'pending', createdAt: 1 }, QUEUE_OWNER.page, now, 20_000),
    { id: 'failed', status: 'error', createdAt: 2 },
    { id: 'ready', status: 'uploading', createdAt: 3, leaseUntil: 0 },
  ];
  assert.equal(pickStoredQueueRecord(records, QUEUE_OWNER.sw, now).id, 'ready');
});

test('the worker can pick tickets needing OCR when the page is closed', () => {
  const records = [
    {
      id: 'ocr',
      status: 'pending',
      createdAt: 1,
      kind: 'order',
      orderDigits: '',
      ticket: new Blob(['ticket']),
    },
    {
      id: 'ready',
      status: 'pending',
      createdAt: 2,
      kind: 'order',
      orderDigits: 'PEYA1',
    },
  ];
  assert.equal(pickStoredQueueRecord(records, QUEUE_OWNER.sw).id, 'ocr');
  assert.equal(pickStoredQueueRecord(records, QUEUE_OWNER.page).id, 'ocr');
});

test('the worker still uploads unidentified jobs that already left OCR', () => {
  const records = [
    {
      id: 'unidentified',
      status: 'uploading',
      createdAt: 1,
      kind: 'order',
      orderDigits: '',
      ticket: new Blob(['ticket']),
    },
  ];
  assert.equal(pickStoredQueueRecord(records, QUEUE_OWNER.sw).id, 'unidentified');
});

test('background protocol uses a stable sync tag and message type', () => {
  assert.equal(UPLOAD_QUEUE_MESSAGE.process, 'PROCESS_UPLOAD_QUEUE');
  assert.equal(UPLOAD_QUEUE_SYNC_TAG, 'upload-queue');
});
