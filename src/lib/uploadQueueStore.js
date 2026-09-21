import { OCR_ENGINE_ERROR } from './tesseractAssets.js';
import { itemNeedsOcr } from './uploadQueueProtocol.js';

const DB_NAME = 'foto-app-upload-queue';
const DB_VERSION = 1;
const STORE_NAME = 'items';

const memoryRecords = new Map();
let testStore = null;
let dbPromise = null;

export function isInterruptedQueueStatus(status) {
  return status === 'analyzing' || status === 'uploading';
}

export function isRetryableBackgroundOcrError(record) {
  return record?.status === 'error'
    && record.error === OCR_ENGINE_ERROR
    && itemNeedsOcr(record);
}

export function shouldRestoreQueueRecord(record) {
  return Boolean(record?.id && record.file && record.status !== 'done');
}

export function serializeQueueRecord(item) {
  return {
    id: item.id,
    status: item.status,
    label: item.label,
    error: item.error || null,
    createdAt: item.createdAt,
    kind: item.kind || 'order',
    orderDigits: item.orderDigits || '',
    title: item.title || '',
    aggregator: item.aggregator || '',
    meta: item.meta && typeof item.meta === 'object' ? { ...item.meta } : {},
    file: item.file || null,
    fileName: item.file?.name || 'evidencia.jpg',
    fileType: item.file?.type || 'image/jpeg',
    ticket: item.ticketFile || null,
    ticketName: item.ticketFile?.name || '',
    ticketType: item.ticketFile?.type || '',
    storagePath: item.storagePath || '',
    leaseOwner: item.leaseOwner || null,
    leaseUntil: item.leaseUntil || 0,
  };
}

export function fileFromStoredBlob(blob, name, type) {
  if (!blob) return null;

  const fileName = name || 'foto.jpg';
  const fileType = type || blob.type || 'image/jpeg';
  if (typeof File === 'function') {
    return new File([blob], fileName, {
      type: fileType,
      lastModified: Date.now(),
    });
  }

  return blob;
}

export function hydrateQueueRecord(record) {
  if (!shouldRestoreQueueRecord(record)) return null;

  const file = fileFromStoredBlob(record.file, record.fileName, record.fileType);
  if (!file) return null;

  const resume = isInterruptedQueueStatus(record.status) || isRetryableBackgroundOcrError(record);
  return {
    id: record.id,
    file,
    ticketFile: fileFromStoredBlob(record.ticket, record.ticketName, record.ticketType),
    kind: record.kind || 'order',
    orderDigits: record.orderDigits || '',
    title: record.title || '',
    aggregator: record.aggregator || '',
    label: resume && !record.orderDigits ? 'Leyendo el código…' : (record.label || 'Leyendo el código…'),
    meta: record.meta && typeof record.meta === 'object' ? { ...record.meta } : {},
    status: resume ? 'pending' : record.status || 'pending',
    error: resume ? null : record.error || null,
    createdAt: record.createdAt || Date.now(),
    storagePath: record.storagePath || '',
    leaseOwner: record.leaseOwner || null,
    leaseUntil: record.leaseUntil || 0,
  };
}

export function useQueueStoreForTests(store) {
  testStore = store;
  dbPromise = null;
}

export function createMemoryQueueStore() {
  const data = new Map();
  return {
    async put(record) {
      data.set(record.id, record);
    },
    async delete(id) {
      data.delete(id);
    },
    async list() {
      return [...data.values()];
    },
    async clear() {
      data.clear();
    },
  };
}

function memoryBackend() {
  return {
    async put(record) {
      memoryRecords.set(record.id, record);
    },
    async delete(id) {
      memoryRecords.delete(id);
    },
    async list() {
      return [...memoryRecords.values()];
    },
  };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completeTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('No se pudo guardar la cola.'));
  });
}

function openQueueDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

function idbBackend() {
  return {
    async put(record) {
      const db = await openQueueDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = completeTransaction(tx);
      tx.objectStore(STORE_NAME).put(record);
      await done;
    },
    async delete(id) {
      const db = await openQueueDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = completeTransaction(tx);
      tx.objectStore(STORE_NAME).delete(id);
      await done;
    },
    async list() {
      const db = await openQueueDb();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const done = completeTransaction(tx);
      const records = await requestResult(tx.objectStore(STORE_NAME).getAll());
      await done;
      return records;
    },
  };
}

function activeBackend() {
  if (testStore) return testStore;
  if (typeof indexedDB === 'undefined') return memoryBackend();
  return idbBackend();
}

export async function putQueueRecord(record) {
  if (!record?.id) return;
  await activeBackend().put(record);
}

export async function deleteQueueRecord(id) {
  if (!id) return;
  await activeBackend().delete(id);
}

export async function listQueueRecords() {
  const records = await activeBackend().list();
  return Array.isArray(records) ? records : [];
}
