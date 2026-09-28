import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  classifyStepError,
  isTransientError,
  nativePhotoStoragePath,
  processNativeSessionReturn,
} from './nativeCaptureBridge.js';

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

  let sessionCleared = false;
  const mockVerifyPhotos = async () => ({ verifiedCount: 2, verifiedAll: true });

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
      clearSessionFn: () => {
        sessionCleared = true;
      },
      verifyPhotosFn: mockVerifyPhotos,
    },
  );

  assert.equal(result.importedCount, 2);
  assert.equal(result.remainingCount, 0);
  assert.equal(result.sessionState, 'completed');
  assert.equal(result.allReady, true);
  assert.equal(sessionCleared, true);
  assert.equal(enqueuedItems.length, 2);

  // Verify idempotent ID passed to enqueue
  assert.equal(enqueuedItems[0].id, 'p1-uuid');
  assert.equal(enqueuedItems[1].id, 'p2-uuid');
  assert.equal(enqueuedItems[0].storagePath, nativePhotoStoragePath('p1-uuid'));

  assert.equal(enqueuedItems[0].kind, 'order');
  assert.equal(enqueuedItems[0].meta.taken_by, 'Lucas');
  assert.equal(enqueuedItems[0].meta.notes, 'Combo 1');
  assert.equal(enqueuedItems[0].meta.is_refutado, false);

  assert.equal(enqueuedItems[1].meta.is_refutado, true);

  // Verify 4 total downloads (2 ticket + 2 evidence)
  assert.equal(downloads.length, 4);
});

test('recovers an imported pair when its local queue record disappeared before publication', async () => {
  const enqueued = [];
  const session = {
    ...mockSessionPairs,
    state: 'completed',
    pairs: [{ ...mockSessionPairs.pairs[0], state: 'imported' }],
  };
  const result = await processNativeSessionReturn(
    {
      sessionId: session.sessionId,
      sessionToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      takenBy: 'Lucas',
    },
    {
      fetchPairsFn: async () => session,
      verifyPhotosFn: async () => ({ verifiedCount: 0, verifiedAll: false, verifiedPairIds: [] }),
      listQueueFn: async () => [],
      downloadFn: async () => new Blob(['dummy']),
      enqueueFn: async (item) => { enqueued.push(item); return item.id; },
      markImportedFn: async () => { throw new Error('Already imported pair must not be marked again.'); },
      clearSessionFn: () => {},
    },
  );
  assert.equal(result.allReady, false);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].storagePath, 'orders/no_code/p1-uuid.jpg');
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
      verifyPhotosFn: async () => ({ verifiedCount: 0, verifiedAll: false }),
    },
  );

  assert.equal(result.sessionState, 'finishing');
  assert.equal(result.totalPairs, 0);
  assert.equal(result.remainingCount, 0);
  assert.equal(cleared, false);
});

test('does not mark allReady nor clear session until verified in photos', async () => {
  let cleared = false;
  const mockDownload = async () => new Blob(['dummy']);
  const mockEnqueue = async () => 'queue-id';
  const fetchPairsFn = async () => ({
    ...mockSessionPairs,
    pairs: mockSessionPairs.pairs.map((p) => ({ ...p, state: 'imported' })),
    state: 'completed',
  });
  const markImportedFn = async () => ({ markedCount: 2, remainingPending: 0 });

  // Verification says 0 photos in photos table yet (still in uploadQueue)
  const mockVerifyPhotos = async () => ({ verifiedCount: 0, verifiedAll: false });

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
      clearSessionFn: () => {
        cleared = true;
      },
      verifyPhotosFn: mockVerifyPhotos,
    },
  );

  assert.equal(result.allReady, false);
  assert.equal(cleared, false);
});

test('stops retrying immediately on permanent errors and exposes exact step', async () => {
  const recordedSteps = [];
  const permanentErr = new Error('Archivo no encontrado');
  permanentErr.status = 404;

  const mockDownload = async (bucket, path) => {
    if (path.includes('ticket')) {
      throw permanentErr;
    }
    return new Blob(['dummy']);
  };

  const fetchPairsFn = async () => mockSessionPairs;

  const result = await processNativeSessionReturn(
    {
      sessionId: mockSessionPairs.sessionId,
      sessionToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      takenBy: 'Lucas',
    },
    {
      downloadFn: mockDownload,
      enqueueFn: async () => {},
      fetchPairsFn,
      markImportedFn: async () => {},
      clearSessionFn: () => {},
      verifyPhotosFn: async () => ({ verifiedCount: 0, verifiedAll: false }),
      maxAutomaticRetries: 3,
      onProgress: (p) => {
        if (p.step) recordedSteps.push(p.step);
      },
    },
  );

  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].step, 'downloading_ticket');
  assert.equal(result.errors[0].isPermanent, true);
  assert.equal(result.errors[0].pairNumber, 1);
});

test('distinguishes transient vs permanent errors accurately', () => {
  assert.equal(isTransientError({ status: 500 }), true);
  assert.equal(isTransientError({ status: 503 }), true);
  assert.equal(isTransientError(new Error('Failed to fetch')), true);
  assert.equal(isTransientError(new Error('NetworkError')), true);

  assert.equal(isTransientError({ status: 401 }), false);
  assert.equal(isTransientError({ status: 403 }), false);
  assert.equal(isTransientError({ status: 404 }), false);
  assert.equal(isTransientError({ status: 410 }), false);

  const classified = classifyStepError(new Error('QuotaExceededError'), 'saving_local', 3);
  assert.equal(classified.step, 'saving_local');
  assert.equal(classified.pairNumber, 3);
  assert.match(classified.error, /IndexedDB/);
});
