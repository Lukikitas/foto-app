import { detectOrderFromPhoto } from './orderOcr.js';
import { compressImageInWorker as compressImage } from './compressImageInWorker.js';
import {
  uploadFile,
  uploadPhoto,
  uploadUnidentifiedOrder,
} from './uploadQueueDeps.js';
import { processQueueItem } from './uploadQueueProcessor.js';
import { keepTicketForRecovery, recoverOrderCodeInCloud, releaseCloudTicket } from './cloudOrderRecovery.js';
import {
  requestBackgroundQueueProcessing,
  subscribeBackgroundQueueUpdates,
} from './uploadQueueBackground.js';
import {
  applyLease,
  clearLease,
  getQueueOwner,
  isActiveQueueStatus,
  isForeignLeaseActive,
} from './uploadQueueProtocol.js';
import {
  deleteQueueRecord,
  hydrateQueueRecord,
  listQueueRecords,
  putQueueRecord,
  serializeQueueRecord,
  shouldRestoreQueueRecord,
} from './uploadQueueStore.js';

const queue = [];
const listeners = new Set();
const persistLocks = new Map();
let processing = false;
let pagePaused = false;
let pageAbort = null;
let processingId = null;
let onCompleteHandler = null;
let restorePromise = null;
let persistListenersBound = false;
let handoffPromise = null;
let leaseRetryTimer = null;
let storeRestorationError = null;

export function getQueueStoreError() {
  return storeRestorationError;
}

export function clearQueueStoreError() {
  storeRestorationError = null;
  notify();
}

function snapshot() {
  return queue.map((item) => ({
    id: item.id,
    status: item.status,
    label: item.label,
    error: item.error,
    createdAt: item.createdAt,
    uploadAttempts: item.uploadAttempts || 0,
  }));
}

function notify() {
  const data = snapshot();
  data.storeError = storeRestorationError;
  listeners.forEach((fn) => fn(data));
}

function persistItem(item, { holdLease = true, reportError = false } = {}) {
  const previous = persistLocks.get(item.id) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(() => {
      if (item.status === 'done') return deleteQueueRecord(item.id);
      const record = holdLease
        ? applyLease(serializeQueueRecord(item), getQueueOwner())
        : clearLease(serializeQueueRecord(item));
      return putQueueRecord(record);
    });
  const loggedJob = job.catch((error) => {
    console.error('persistItem error:', error);
    throw error;
  });
  persistLocks.set(item.id, loggedJob.catch(() => {}));
  return reportError ? job : loggedJob.catch(() => {});
}

async function pausePageQueueAndHandoff() {
  if (handoffPromise) return handoffPromise;
  pagePaused = true;
  pageAbort?.abort();
  handoffPromise = (async () => {
    await Promise.all(
      queue
        .filter((item) => item.status !== 'done')
        .map((item) => persistItem(item, { holdLease: item.status === 'uploading' }))
    );
    const handoffSuccess = await requestBackgroundQueueProcessing();
    if (!handoffSuccess) {
      // If service worker handoff fails, page retakes queue immediately
      pagePaused = false;
      processQueue();
    }
  })();
  try {
    return await handoffPromise;
  } finally {
    handoffPromise = null;
  }
}

async function resumePageQueue() {
  if (handoffPromise) await handoffPromise;
  pagePaused = false;
  try {
    await syncQueueFromStore();
  } catch {
    // Error is already stored in storeRestorationError and notified
  }
  processQueue();
}

export function handleQueueVisibilityChange() {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    void pausePageQueueAndHandoff();
    return;
  }
  void resumePageQueue();
}

function bindPersistListeners() {
  if (persistListenersBound || typeof window === 'undefined') return;
  persistListenersBound = true;

  window.addEventListener('pagehide', () => { void pausePageQueueAndHandoff(); });
  window.addEventListener('beforeunload', () => { void pausePageQueueAndHandoff(); });
  document.addEventListener('visibilitychange', handleQueueVisibilityChange);
  subscribeBackgroundQueueUpdates(() => {
    void syncQueueFromStore()
      .then(() => {
        if (!pagePaused) processQueue();
      })
      .catch(() => {});
  });
}

export function setUploadCompleteHandler(handler) {
  onCompleteHandler = handler;
}

export function subscribe(listener) {
  listeners.add(listener);
  const data = snapshot();
  data.storeError = storeRestorationError;
  listener(data);
  return () => listeners.delete(listener);
}

export async function enqueue({
  id,
  file,
  ticketFile,
  kind = 'order',
  orderDigits = '',
  title = '',
  aggregator = '',
  meta,
  storagePath = '',
}) {
  const itemId = id || crypto.randomUUID();

  // Idempotency: check if an item with this ID is already in the active queue
  const existing = queue.find((entry) => entry.id === itemId);
  if (existing) {
    if (existing.status !== 'done' && existing.status !== 'error') {
      return existing.id;
    }
  }

  const defaultLabel = kind === 'order'
    ? (orderDigits ? `Pedido #${orderDigits}` : 'Leyendo el código…')
    : (title || file.name);

  // Status is explicitly "saving_local" until confirmed by IndexedDB
  const item = {
    id: itemId,
    file,
    ticketFile,
    kind,
    orderDigits,
    title,
    aggregator,
    label: defaultLabel,
    meta: meta && typeof meta === 'object' ? { ...meta } : {},
    status: 'saving_local',
    initialPersistPending: true,
    error: null,
    createdAt: Date.now(),
    storagePath,
    uploadAttempts: 0,
  };

  queue.push(item);
  notify();
  bindPersistListeners();

  try {
    await persistItem(item, { reportError: true });
    // Once confirmed in IndexedDB, update to "pending" (En cola)
    item.initialPersistPending = false;
    item.status = 'pending';
    notify();
  } catch (err) {
    item.initialPersistPending = false;
    item.status = 'error';
    item.error = `No se guardó en este celular (${err.message}). No cierres la app: liberá espacio y reintentá.`;
    notify();
    const error = new Error('No se guardó la foto en el dispositivo. Reintentá desde la cola.');
    error.queueId = item.id;
    throw error;
  }

  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    void requestBackgroundQueueProcessing();
  } else {
    processQueue();
  }

  return item.id;
}

export function retryUpload(id) {
  const item = queue.find((entry) => entry.id === id);
  if (!item || item.status !== 'error') return;

  item.status = 'saving_local';
  item.error = null;
  item.initialPersistPending = true;
  notify();

  void persistItem(item, { reportError: true })
    .then(() => {
      item.initialPersistPending = false;
      item.status = 'pending';
      notify();
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        void requestBackgroundQueueProcessing();
      } else {
        processQueue();
      }
    })
    .catch((err) => {
      item.initialPersistPending = false;
      item.status = 'error';
      item.error = `No se guardó en este celular (${err.message}). Reintentá.`;
      notify();
    });
}

export function dismissUpload(id) {
  const index = queue.findIndex((entry) => entry.id === id);
  if (index === -1) return;

  queue.splice(index, 1);
  persistLocks.delete(id);
  notify();
  void deleteQueueRecord(id);
  processQueue();
}

function markItemDone(item, photo) {
  item.status = 'done';
  item.error = null;
  notify();
  onCompleteHandler?.(photo);
  setTimeout(() => {
    const index = queue.findIndex((entry) => entry.id === item.id);
    if (index !== -1 && queue[index].status === 'done') {
      queue.splice(index, 1);
      notify();
    }
  }, 4000);
}

async function processQueue() {
  if (processing || pagePaused) return;

  const now = Date.now();
  const next = queue.find((entry) => entry.status === 'pending'
    && !entry.initialPersistPending
    && !isForeignLeaseActive(entry, getQueueOwner(), now));

  if (leaseRetryTimer) {
    clearTimeout(leaseRetryTimer);
    leaseRetryTimer = null;
  }

  if (!next) {
    const blocked = queue.filter((entry) => entry.status === 'pending'
      && isForeignLeaseActive(entry, getQueueOwner(), now));
    if (blocked.length) {
      const delay = Math.max(100, Math.min(...blocked.map((entry) => entry.leaseUntil)) - now + 50);
      leaseRetryTimer = setTimeout(() => {
        leaseRetryTimer = null;
        void syncQueueFromStore().then(() => processQueue()).catch(() => {});
      }, delay);
    }
    return;
  }

  processing = true;
  processingId = next.id;
  pageAbort = typeof AbortController === 'function' ? new AbortController() : null;

  try {
    const result = await processQueueItem(next, {
      detectOrderFromPhoto,
      compressImage,
      uploadFile,
      uploadPhoto,
      uploadUnidentifiedOrder,
      keepTicketForRecovery,
      recoverOrderCodeInCloud,
      releaseCloudTicket,
      persist: (entry, options) => pagePaused
        ? Promise.resolve()
        : persistItem(entry, { ...options, reportError: true }),
      notify,
      shouldYield: () => pagePaused,
      signal: pageAbort?.signal,
      onComplete: (photo) => markItemDone(next, photo),
    });

    if (result?.yielded && next.status !== 'done' && next.status !== 'error') {
      next.status = 'pending';
      next.error = null;
      notify();
      if (!pagePaused) await persistItem(next, { holdLease: false });
      if (pagePaused) void requestBackgroundQueueProcessing();
    }
  } catch (error) {
    console.error('processQueue error:', error);
  } finally {
    processing = false;
    processingId = null;
    pageAbort = null;
    if (!pagePaused) processQueue();
  }
}

export async function syncQueueFromStore() {
  let records;
  try {
    records = await listQueueRecords();
    storeRestorationError = null;
  } catch (error) {
    storeRestorationError = `Error al leer las fotos guardadas en el dispositivo: ${error.message}`;
    console.error(storeRestorationError, error);
    notify();
    throw error;
  }

  const storedIds = new Set(records.map((record) => record.id));
  const existing = new Map(queue.map((item) => [item.id, item]));

  for (const record of records) {
    if (!shouldRestoreQueueRecord(record)) continue;
    const hydrated = hydrateQueueRecord(record);
    if (!hydrated) continue;
    const current = existing.get(record.id);
    if (current) {
      if (processingId === current.id) continue;
      current.status = hydrated.status;
      current.label = hydrated.label;
      current.error = hydrated.error;
      current.orderDigits = hydrated.orderDigits;
      current.aggregator = hydrated.aggregator;
      current.storagePath = hydrated.storagePath;
      current.file = hydrated.file || current.file;
      current.ticketFile = hydrated.ticketFile;
      current.leaseOwner = hydrated.leaseOwner;
      current.leaseUntil = hydrated.leaseUntil;
      current.uploadAttempts = hydrated.uploadAttempts || 0;
      continue;
    }
    queue.push(hydrated);
    existing.set(hydrated.id, hydrated);
  }

  for (const item of queue) {
    if (item.initialPersistPending) continue;
    if (storedIds.has(item.id) || item.status === 'done' || item.status === 'error' || item.status === 'saving_local') continue;
    if (processingId === item.id && storedIds.has(item.id)) continue;
    markItemDone(item);
  }

  queue.sort((left, right) => left.createdAt - right.createdAt);
  notify();
  return snapshot();
}

export function getPendingCount() {
  return queue.filter((entry) => isActiveQueueStatus(entry.status)).length;
}

export function restorePersistedQueue() {
  if (restorePromise) return restorePromise;

  restorePromise = (async () => {
    bindPersistListeners();
    try {
      await syncQueueFromStore();
    } catch {
      // Error is set in storeRestorationError and listeners notified
    }
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      processQueue();
    } else {
      void requestBackgroundQueueProcessing();
    }
    return snapshot();
  })();

  return restorePromise;
}

export function resetUploadQueueForTests() {
  queue.splice(0, queue.length);
  persistLocks.clear();
  processing = false;
  pagePaused = false;
  pageAbort = null;
  processingId = null;
  restorePromise = null;
  onCompleteHandler = null;
  persistListenersBound = false;
  handoffPromise = null;
  storeRestorationError = null;
  if (leaseRetryTimer) clearTimeout(leaseRetryTimer);
  leaseRetryTimer = null;
  notify();
}
