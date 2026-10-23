import { queueRecordSummary } from './queueMemory.js';
import { OCR_ENGINE_ERROR } from './tesseractAssets.js';
import { itemNeedsOcr } from './uploadQueueProtocol.js';

const DB_NAME = 'foto-app-upload-queue';
const DB_VERSION = 1;
const STORE_NAME = 'items';

const memoryRecords = new Map();
let testStore = null;
let dbPromise = null;

export function isInterruptedQueueStatus(status) {
  return status === 'analyzing' || status === 'preparing' || status === 'uploading';
}

export function isRetryableBackgroundOcrError(record) {
  return record?.status === 'error'
    && record.error === OCR_ENGINE_ERROR
    && itemNeedsOcr(record);
}

export function shouldRestoreQueueRecord(record) {
  return Boolean(record?.id && (record.file || record.hasFile) && record.status !== 'done');
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
    fileName: item.file?.name || item.fileName || 'evidencia.jpg',
    fileType: item.file?.type || item.fileType || 'image/jpeg',
    ticket: item.ticketFile || null,
    ticketName: item.ticketFile?.name || item.ticketName || '',
    ticketType: item.ticketFile?.type || item.ticketType || '',
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

export function hydrateQueueRecord(record, {includeFiles=true} = {}) {
  if (!shouldRestoreQueueRecord(record)) return null;

  const file = includeFiles ? fileFromStoredBlob(record.file, record.fileName, record.fileType) : null;
  if (includeFiles && !file) return null;

  const resume = isInterruptedQueueStatus(record.status) || isRetryableBackgroundOcrError(record);
  return {
    id: record.id,
    file,
    ticketFile: includeFiles ? fileFromStoredBlob(record.ticket, record.ticketName, record.ticketType) : null,
    persisted: true, filesUnloaded: !includeFiles,
    fileName: record.fileName, fileType: record.fileType, ticketName: record.ticketName, ticketType: record.ticketType,
    hasFile: Boolean(record.file || record.hasFile), hasTicket: Boolean(record.ticket || record.hasTicket),
    fileSize: record.file?.size ?? record.fileSize ?? 0, ticketSize: record.ticket?.size ?? record.ticketSize ?? 0,
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
    async get(id) { return data.get(id) || null; },
    async summaries() { return [...data.values()].map(queueRecordSummary); },
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
    async get(id) { return memoryRecords.get(id) || null; },
    async summaries() { return [...memoryRecords.values()].map(queueRecordSummary); },
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
    async patch(id, metadata) {
      const db = await openQueueDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const done = completeTransaction(tx);
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => {
        if (!request.result?.file) { tx.abort(); return; }
        // Keep the existing immutable Blob handles inside the transaction.
        store.put({ ...request.result, ...metadata });
      };
      await done;
    },
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
    async get(id) {
      const db=await openQueueDb();const tx=db.transaction(STORE_NAME,'readonly');const done=completeTransaction(tx);
      const result=await requestResult(tx.objectStore(STORE_NAME).get(id));await done;return result || null;
    },
    async summaries() {
      const db=await openQueueDb();const tx=db.transaction(STORE_NAME,'readonly');const done=completeTransaction(tx);
      const rows=[];
      await new Promise((resolve,reject)=>{
        const request=tx.objectStore(STORE_NAME).openCursor();
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const cursor=request.result;if(!cursor){resolve();return;}rows.push(queueRecordSummary(cursor.value));cursor.continue();};
      });
      await done;return rows;
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
  if (typeof indexedDB === 'undefined') {
    if(typeof window !== 'undefined')throw new Error('Este navegador no permite guardar la cola en el dispositivo. Conservá la app abierta y no descartes las capturas.');
    return memoryBackend();
  }
  return idbBackend();
}

export async function putQueueRecord(record) {
  if (!record?.id) return;
  await activeBackend().put(record);
}
export async function patchQueueRecord(record) {
  const backend = activeBackend();
  const metadata = { ...record };
  delete metadata.file;
  delete metadata.ticket;
  if (backend.patch) return backend.patch(record.id, metadata);
  const stored = await backend.get(record.id);
  if (!stored?.file) throw new Error('No se encontró la foto guardada. Conservá el pendiente para revisar.');
  return backend.put({ ...stored, ...metadata });
}

export async function deleteQueueRecord(id) {
  if (!id) return;
  await activeBackend().delete(id);
}

export async function listQueueRecords() {
  const records = await activeBackend().list();
  return Array.isArray(records) ? records : [];
}

export async function getQueueRecord(id) {
  const backend=activeBackend();return backend.get ? backend.get(id) : (await backend.list()).find(row=>row.id===id) || null;
}
export async function listQueueSummaries() {
  const backend=activeBackend();return backend.summaries ? backend.summaries() : (await backend.list()).map(queueRecordSummary);
}
