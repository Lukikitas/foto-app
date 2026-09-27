import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { processNativeSessionReturn } from './nativeCaptureBridge.js';

let mockSessionPairs;
let mockImportedPairs;

beforeEach(() => {
  mockSessionPairs = {
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    takenBy: 'Lucas',
    state: 'finishing',
    pairCount: 2,
    pairs: [
      {
        id: 'p1-uuid',
        pairNumber: 1,
        ticketPath: '123e4567-e89b-12d3-a456-426614174000/1/ticket.jpg',
        evidencePath: '123e4567-e89b-12d3-a456-426614174000/1/evidence.jpg',
        state: 'uploaded',
        metadata: { notes: 'Combo 1', is_refutado: false },
      },
      {
        id: 'p2-uuid',
        pairNumber: 2,
        ticketPath: '123e4567-e89b-12d3-a456-426614174000/2/ticket.jpg',
        evidencePath: '123e4567-e89b-12d3-a456-426614174000/2/evidence.jpg',
        state: 'uploaded',
        metadata: { notes: '', is_refutado: true },
      },
    ],
  };
  mockImportedPairs = [];
});

test('processNativeSessionReturn downloads pairs and enqueues them into existing queue', async () => {
  const enqueuedItems = [];
  const downloads = [];

  const mockDownload = async (bucket, path, filename, mimeType) => {
    downloads.push({ bucket, path, filename, mimeType });
    if (typeof File !== 'undefined') {
      return new File(['dummy-bytes'], filename, { type: mimeType });
    }
    const blob = new Blob(['dummy-bytes'], { type: mimeType });
    blob.name = filename;
    return blob;
  };

  const mockEnqueue = async (item) => {
    enqueuedItems.push(item);
    return 'queue-id';
  };

  const fetchPairsFn = async () => ({
    ...mockSessionPairs,
    pairs: mockSessionPairs.pairs.map((p) => ({
      ...p,
      state: mockImportedPairs.includes(p.id) ? 'imported' : p.state,
    })),
    state: mockImportedPairs.length === mockSessionPairs.pairs.length ? 'completed' : mockSessionPairs.state,
  });

  const markImportedFn = async (sessionId, sessionToken, ids) => {
    mockImportedPairs.push(...ids);
    return { markedCount: ids.length, remainingPending: 0 };
  };

  const result = await processNativeSessionReturn(
    {
      sessionId: mockSessionPairs.sessionId,
      sessionToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      takenBy: 'Lucas',
    },
    {
      downloadFn: mockDownload,
      enqueueFn: mockEnqueue,
      fetchPairsFn,
      markImportedFn,
      clearSessionFn: () => {},
    },
  );

  assert.equal(result.importedCount, 2);
  assert.equal(result.remainingCount, 0);
  assert.equal(result.sessionState, 'completed');
  assert.equal(enqueuedItems.length, 2);

  assert.equal(enqueuedItems[0].kind, 'order');
  assert.equal(enqueuedItems[0].meta.taken_by, 'Lucas');
  assert.equal(enqueuedItems[0].meta.notes, 'Combo 1');
  assert.equal(enqueuedItems[0].meta.is_refutado, false);

  assert.equal(enqueuedItems[1].meta.is_refutado, true);

  // Verify 4 total downloads (2 ticket + 2 evidence)
  assert.equal(downloads.length, 4);
});

test('keeps a finishing session while Android still has files to upload', async () => {
  let cleared = false;
  const result = await processNativeSessionReturn(
    {
      sessionId: mockSessionPairs.sessionId,
      sessionToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      takenBy: 'Lucas',
    },
    {
      fetchPairsFn: async () => ({
        sessionId: mockSessionPairs.sessionId,
        state: 'finishing',
        pairCount: 0,
        pairs: [],
      }),
      downloadFn: async () => {
        throw new Error('No debería descargar archivos.');
      },
      enqueueFn: async () => {
        throw new Error('No debería encolar archivos.');
      },
      markImportedFn: async () => {
        throw new Error('No debería marcar archivos.');
      },
      clearSessionFn: () => {
        cleared = true;
      },
    },
  );

  assert.equal(result.sessionState, 'finishing');
  assert.equal(result.totalPairs, 0);
  assert.equal(result.remainingCount, 0);
  assert.equal(cleared, false);
});
