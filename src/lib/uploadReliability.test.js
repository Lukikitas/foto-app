import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBoundedFetch } from './boundedFetch.js';
import { scheduleUploadRetry, isTransientUploadError, queueItemReady } from './uploadRetry.js';
import { hydrateQueueRecord, serializeQueueRecord } from './uploadQueueStore.js';

test('stalled headers are aborted and the caller is released', async () => {
  let aborted = false;
  const fetcher = createBoundedFetch((_, { signal }) => {
    signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(() => {});
  }, 20);
  await assert.rejects(fetcher('https://example.test'), { code: 'REQUEST_TIMEOUT' });
  assert.equal(aborted, true);
});

test('the network deadline includes a stalled response body', async () => {
  const fetcher = createBoundedFetch(async () => new Response(new ReadableStream({ start() {} })), 20);
  await assert.rejects(fetcher('https://example.test'), { code: 'REQUEST_TIMEOUT' });
});

test('external cancellation interrupts a request without classifying it as a retry', async () => {
  const controller = new AbortController();
  const fetcher = createBoundedFetch(() => new Promise(() => {}));
  const pending = fetcher('https://example.test', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(isTransientUploadError(new DOMException('Interrumpido', 'AbortError')), false);
});

test('retry schedule survives restart with the original bytes and acknowledgement', () => {
  const item = { id: 'capture', file: new File(['evidence'], 'photo.jpg'), ticketFile: new File(['ticket'], 'ticket.jpg'), status: 'uploading', uploadedPhoto: { id: 'server-photo' } };
  assert.equal(scheduleUploadRetry(item, { status: 503 }, 1000, () => 0.5), true);
  const restored = hydrateQueueRecord(serializeQueueRecord(item));
  assert.equal(restored.nextAttemptAt, 3000);
  assert.equal(restored.retryAttempt, 1);
  assert.equal(restored.uploadedPhoto.id, 'server-photo');
  assert.equal(restored.file.size, 8);
  assert.equal(restored.ticketFile.size, 6);
  assert.equal(queueItemReady(restored, 2999), false);
  assert.equal(queueItemReady(restored, 3000), true);
});

test('retryable rate limits and server errors do not hide authorization or invalid data', () => {
  for (const status of [408, 425, 429, 500, 503]) assert.equal(isTransientUploadError({ status }), true);
  for (const status of [400, 401, 403, 404, 413]) assert.equal(isTransientUploadError({ status }), false);
  assert.equal(isTransientUploadError({ message: 'Failed to fetch' }), true);
  const item = {};
  for (let attempt = 0; attempt < 100; attempt++) scheduleUploadRetry(item, { status: 503 }, 0, () => 0.5);
  assert.equal(item.nextAttemptAt, 300_000);
});
