import { compressImage } from './compressImage';
import { detectOrderFromPhoto } from './orderOcr';
import { OCR_ENGINE_ERROR } from './tesseract';
import { uploadFile, uploadPhoto, uploadUnidentifiedOrder } from './photos';
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
let onCompleteHandler = null;
let restorePromise = null;
let persistListenersBound = false;

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

function persistItem(item) {
  const previous = persistLocks.get(item.id) || Promise.resolve();
  const job = previous
    .catch(() => {})
    .then(() => {
      if (item.status === 'done') return deleteQueueRecord(item.id);
      return putQueueRecord(serializeQueueRecord(item));
    })
    .catch((error) => {
      console.error(error);
    });
  persistLocks.set(item.id, job);
  return job;
}

function persistVisibleQueue() {
  for (const item of queue) {
    if (item.status === 'done') continue;
    void persistItem(item);
  }
}

function bindPersistListeners() {
  if (persistListenersBound || typeof window === 'undefined') return;
  persistListenersBound = true;

  const persist = () => persistVisibleQueue();
  window.addEventListener('pagehide', persist);
  window.addEventListener('beforeunload', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
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

export function enqueue({
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
    error: null,
    createdAt: Date.now(),
  };

  queue.push(item);
  notify();
  bindPersistListeners();
  void persistItem(item);
  processQueue();
  return item.id;
}

export function retryUpload(id) {
  const item = queue.find((entry) => entry.id === id);
  if (!item || item.status !== 'error') return;

  item.status = 'pending';
  item.error = null;
  notify();
  void persistItem(item);
  processQueue();
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

function releaseTicket(item) {
  item.ticketFile = null;
}

async function processQueue() {
  if (processing) return;

  const next = queue.find((entry) => entry.status === 'pending');
  if (!next) return;

  processing = true;
  try {
    await persistItem(next);

    let detectedOrder = null;
    const needsOcr = next.kind === 'order' && !next.orderDigits && next.ticketFile;

    if (needsOcr) {
      next.status = 'analyzing';
      next.label = 'Leyendo el código…';
      notify();
      await persistItem(next);
      detectedOrder = await detectOrderFromPhoto(next.ticketFile, {
        fallbackFiles: next.file && next.file !== next.ticketFile ? [next.file] : [],
      });
      if (detectedOrder?.displayCode) {
        next.orderDigits = detectedOrder.displayCode;
        next.aggregator = detectedOrder.aggregator;
        next.label = `Pedido #${detectedOrder.displayCode}`;
        await persistItem(next);
      }
    }

    const preparedFile = next.file.type.startsWith('image/')
      ? await compressImage(next.file)
      : next.file;

    // OCR uses ticketFile only. Evidence (`next.file`) is the only image uploaded.

    let photo;
    if (next.kind === 'file') {
      next.status = 'uploading';
      notify();
      await persistItem(next);
      photo = await uploadFile(preparedFile, next.title, next.meta);
    } else if (next.orderDigits) {
      next.status = 'uploading';
      if (next.orderDigits && next.label === 'Leyendo el código…') {
        next.label = `Pedido #${next.orderDigits}`;
      }
      notify();
      await persistItem(next);
      photo = await uploadPhoto(preparedFile, next.orderDigits, next.meta, next.aggregator);
    } else if (detectedOrder?.aggregator) {
      next.status = 'uploading';
      next.label = `Pedido #${detectedOrder.displayCode}`;
      notify();
      await persistItem(next);
      photo = await uploadPhoto(
        preparedFile,
        detectedOrder.displayCode,
        next.meta,
        detectedOrder.aggregator,
      );
    } else {
      next.status = 'uploading';
      next.label = 'Código no encontrado';
      notify();
      await persistItem(next);
      photo = await uploadUnidentifiedOrder(preparedFile, next.meta);
    }

    releaseTicket(next);
    next.status = 'done';
    next.error = null;
    notify();
    await persistItem(next);
    onCompleteHandler?.(photo);

    setTimeout(() => {
      const index = queue.findIndex((entry) => entry.id === next.id);
      if (index !== -1 && queue[index].status === 'done') {
        queue.splice(index, 1);
        notify();
      }
    }, 4000);
  } catch (err) {
    const analyzing = next.status === 'analyzing';
    next.status = 'error';
    next.error = err.message || (analyzing ? OCR_ENGINE_ERROR : 'Error al subir la foto.');
    notify();
    await persistItem(next);
  } finally {
    processing = false;
    processQueue();
  }
}

export function getPendingCount() {
  return queue.filter((entry) =>
    entry.status === 'pending' || entry.status === 'analyzing' || entry.status === 'uploading'
  ).length;
}

export function restorePersistedQueue() {
  if (restorePromise) return restorePromise;

  restorePromise = (async () => {
    bindPersistListeners();
    let records = [];
    try {
      records = await listQueueRecords();
    } catch (error) {
      console.error(error);
      return queue.slice();
    }

    const existing = new Set(queue.map((item) => item.id));
    for (const record of records) {
      if (!shouldRestoreQueueRecord(record) || existing.has(record.id)) continue;
      const item = hydrateQueueRecord(record);
      if (!item) continue;
      queue.push(item);
      existing.add(item.id);
    }

    queue.sort((left, right) => left.createdAt - right.createdAt);
    notify();
    processQueue();
    return snapshot();
  })();

  return restorePromise;
}

export function resetUploadQueueForTests() {
  queue.splice(0, queue.length);
  persistLocks.clear();
  processing = false;
  restorePromise = null;
  onCompleteHandler = null;
  notify();
}
