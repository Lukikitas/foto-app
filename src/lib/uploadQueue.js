import { detectOrderFromPhoto } from './orderOcr.js';
import { compressImageInWorker as compressImage } from './compressImageInWorker.js';
import {
  uploadFile,
  uploadPhoto,
  uploadUnidentifiedOrder,
} from './uploadQueueDeps.js';
import { processQueueItem } from './uploadQueueProcessor.js';
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
} from './uploadQueueStore';

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

function snapshot() {
  return queue.map((item) => ({
    id: item.id,
    status: item.status,
    label: item.label,
    error: item.error,
    createdAt: item.createdAt,
  }));
}

function notify() {
  const data = snapshot();
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
    console.error(error);
  });
  persistLocks.set(item.id, loggedJob);
  return reportError ? job : loggedJob;
}

async function pausePageQueueAndHandoff() {
  if (handoffPromise) return handoffPromise;
  pagePaused = true;
  pageAbort?.abort();
  handoffPromise = (async () => {
    await Promise.all(queue
      .filter((item) => item.status !== 'done')
      .map((item) => persistItem(item, { holdLease: item.status === 'uploading' })));
    await requestBackgroundQueueProcessing();
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
  await syncQueueFromStore();
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
    void syncQueueFromStore().then(() => {
      if (!pagePaused) processQueue();
    });
  });
}

export function setUploadCompleteHandler(handler) {
  onCompleteHandler = handler;
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export async function enqueue({
  file,
  ticketFile,
  kind = 'order',
  orderDigits = '',
  title = '',
  aggregator = '',
  meta,
}) {
  const item = {
    id: crypto.randomUUID(),
    file,
    ticketFile,
    kind,
    orderDigits,
    title,
    aggregator,
    label: kind === 'order'
      ? orderDigits ? `Pedido #${orderDigits}` : 'Leyendo el código…'
      : title || file.name,
    meta,
    status: 'pending',
    initialPersistPending: true,
    error: null,
    createdAt: Date.now(),
    storagePath: '',
  };

  queue.push(item);
  notify();
  bindPersistListeners();
  try {
    await persistItem(item, { reportError: true });
    item.initialPersistPending = false;
  } catch {
    item.initialPersistPending = false;
    item.status = 'error';
    item.error = 'No se guardó en este celular. No cierres la app: liberá espacio y reintentá.';
    notify();
    const error = new Error('No se guardó la foto. No cierres la app: reintentá desde la cola.');
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

  item.status = 'pending';
  item.error = null;
  item.initialPersistPending = true;
  notify();
  void persistItem(item, { reportError: true })
    .then(() => {
      item.initialPersistPending = false;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        void requestBackgroundQueueProcessing();
      } else {
        processQueue();
      }
    })
    .catch(() => {
      item.initialPersistPending = false;
      item.status = 'error';
      item.error = 'No se guardó en este celular. No cierres la app: liberá espacio y reintentá.';
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
        void syncQueueFromStore().then(() => processQueue());
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
    console.error(error);
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
  } catch (error) {
    console.error(error);
    return snapshot();
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
      continue;
    }
    queue.push(hydrated);
    existing.set(hydrated.id, hydrated);
  }

  for (const item of queue) {
    if (item.initialPersistPending) continue;
    if (storedIds.has(item.id) || item.status === 'done' || item.status === 'error') continue;
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
    await syncQueueFromStore();
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
  if (leaseRetryTimer) clearTimeout(leaseRetryTimer);
  leaseRetryTimer = null;
  notify();
}
