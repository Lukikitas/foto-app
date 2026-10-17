import { releaseQueueFiles, mergeQueueStateWithStoredFiles } from './queueMemory.js';
import { checkpointUploadQueue, canRetireMissingItem } from './uploadQueueSafety.js';
import { detectOrderFromPhoto } from './orderOcr.js';
import { compressImageInWorker as compressImage } from './compressImageInWorker.js';
import {
  uploadFile,
  uploadPhoto,
  uploadUnidentifiedOrder,
} from './uploadQueueDeps.js';
import { processQueueItem } from './uploadQueueProcessor.js';
import { keepTicketForRecovery, recoverOrderCodeInCloud } from './cloudOrderRecovery.js';
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
  listQueueRecords, getQueueRecord, listQueueSummaries,
  putQueueRecord,
  serializeQueueRecord,
  shouldRestoreQueueRecord,
} from './uploadQueueStore';

const queue = [];
const listeners = new Set();
const persistLocks = new Map();
let processing = false;
let processItem=processQueueItem;
let pagePaused = false;
let pageAbort = null;
let processingId = null;
let onCompleteHandler = null;
let restorePromise = null;
let persistListenersBound = false;
let handoffPromise = null;
let leaseRetryTimer = null;
let processingFinished = Promise.resolve();
let updateCheckpoint = null;
let syncPromise = null;
let syncTimer = null;
let retryChain = Promise.resolve();

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
    .then(async () => {
      if (item.status === 'done') return deleteQueueRecord(item.id);
      const record = holdLease
        ? applyLease(serializeQueueRecord(item), getQueueOwner())
        : clearLease(serializeQueueRecord(item));
      const complete = mergeQueueStateWithStoredFiles(item,item.filesUnloaded ? await getQueueRecord(item.id) : null,record);
      return putQueueRecord(complete).then(() => { item.localSaveFailed = false; item.persisted = true; }, error => { item.localSaveFailed = true; throw error; });
    });
  const loggedJob = job.catch((error) => {
    console.error(error);
  }).finally(() => { if (persistLocks.get(item.id) === loggedJob) persistLocks.delete(item.id); });
  persistLocks.set(item.id, loggedJob);
  return reportError ? job : loggedJob;
}

async function pausePageQueueAndHandoff() {
  if (handoffPromise) return handoffPromise;
  pagePaused = true;
  pageAbort?.abort();
  handoffPromise = (async () => {
    await Promise.all(queue
      .filter((item) => item.status !== 'done' && (!item.filesUnloaded || item.localSaveFailed))
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
    if (syncTimer) return;
    syncTimer=setTimeout(()=>{syncTimer=null;void syncQueueFromStore().then(()=>{if(!pagePaused)processQueue();});},200);
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
    releaseQueueFiles(item);
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
      releaseQueueFiles(item);
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

export function retryAllFailedUploads() {
  const ids = queue.filter(item => item.status === 'error').map(item => item.id);
  for (const id of ids) retryChain=retryChain.then(async()=>{retryUpload(id);const pending=persistLocks.get(id);if(pending)await pending;await new Promise(resolve=>setTimeout(resolve,0));});
  return ids.length;
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
  item.file = null; item.ticketFile = null;
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
  let resolveFinished;
  processingFinished = new Promise(resolve => { resolveFinished = resolve; });
  processingId = next.id;
  pageAbort = typeof AbortController === 'function' ? new AbortController() : null;
  try {
    if (next.filesUnloaded) {
      const stored=await getQueueRecord(next.id);
      if(!stored?.file)throw new Error('No se pudo encontrar la foto guardada. Conservá el pendiente para revisar.');
      const loaded=hydrateQueueRecord(stored);
      next.file=loaded.file;next.ticketFile=loaded.ticketFile;next.filesUnloaded=false;
    }
    const result = await processItem(next, {
      detectOrderFromPhoto,
      compressImage,
      uploadFile,
      uploadPhoto,
      uploadUnidentifiedOrder,
      keepTicketForRecovery,
      recoverOrderCodeInCloud,
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
    if (next.status !== 'done') {
      next.status = 'error';
      next.error = next.localSaveFailed ? 'No se guardó en este celular. Conservá esta pestaña abierta y no descartes la foto.' : error.message || 'No se pudo procesar la foto. Reintentá sin descartar el pendiente.';
      notify();
    }
    console.error(error);
  } finally {
    processing = false;
    processingId = null;
    pageAbort = null;
    releaseQueueFiles(next);
    resolveFinished();
    if (!pagePaused) setTimeout(()=>void processQueue(),0);
  }
}

export function syncQueueFromStore() {
  if(syncPromise)return syncPromise;
  syncPromise=syncQueueImpl().finally(()=>{syncPromise=null;});return syncPromise;
}
async function syncQueueImpl() {
  let records;
  try {
    records = await listQueueSummaries();
  } catch (error) {
    console.error(error);
    return snapshot();
  }

  const storedIds = new Set(records.map((record) => record.id));
  const existing = new Map(queue.map((item) => [item.id, item]));

  for (const record of records) {
    if (!shouldRestoreQueueRecord(record)) continue;
    const hydrated = hydrateQueueRecord(record,{includeFiles:false});
    if (!hydrated) continue;
    const current = existing.get(record.id);
    if (current) {
      if (current.localSaveFailed || current.initialPersistPending) continue;
      if (processingId === current.id) continue;
      current.status = hydrated.status;
      current.label = hydrated.label;
      current.error = hydrated.error;
      current.orderDigits = hydrated.orderDigits;
      current.aggregator = hydrated.aggregator;
      current.storagePath = hydrated.storagePath;
      current.file=null; current.ticketFile=null; current.filesUnloaded=true;current.persisted=true;
      for(const key of ['fileName','fileType','ticketName','ticketType','hasFile','hasTicket','fileSize','ticketSize'])current[key]=hydrated[key];
      current.leaseOwner = hydrated.leaseOwner;
      current.leaseUntil = hydrated.leaseUntil;
      continue;
    }
    queue.push(hydrated);
    existing.set(hydrated.id, hydrated);
  }

  for (const item of queue) {
    if (!canRetireMissingItem(item)) continue;
    if (storedIds.has(item.id) || item.status === 'done' || item.status === 'error') continue;
    if (processingId === item.id && storedIds.has(item.id)) continue;
    markItemDone(item);
  }

  queue.sort((left, right) => left.createdAt - right.createdAt);
  notify();
  return snapshot();
}

export function prepareQueueForUpdate() {
  if (updateCheckpoint) return updateCheckpoint;
  pagePaused = true;
  pageAbort?.abort();
  updateCheckpoint = (async () => {
    let timer;
    try {
      await Promise.race([processingFinished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('La lectura sigue ocupada. No se actualizó la app; conservá esta pestaña abierta y volvé a intentar.')),15000);})]);
    } finally { clearTimeout(timer); }
    await Promise.all([...persistLocks.values()]);
    const records = [];
    for(const item of queue.filter(item=>item.status!=='done')) {
      const state=clearLease(serializeQueueRecord(item));
      records.push(mergeQueueStateWithStoredFiles(item,item.filesUnloaded ? await getQueueRecord(item.id) : null,state));
    }
    const result = await checkpointUploadQueue(records,{put:putQueueRecord,list:listQueueRecords});
    const currentIds = queue.filter(item=>item.status!=='done').map(item=>item.id);
    if (currentIds.length!==records.length || currentIds.some(id=>!records.some(record=>record.id===id))) throw new Error('La cola cambió durante la comprobación. No se actualizó; volvé a intentar.');
    return result;
  })().catch(error=>{pagePaused=false;void processQueue();throw error;}).finally(()=>{updateCheckpoint=null;});
  return updateCheckpoint;
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

export function resetUploadQueueForTests({processor=processQueueItem}={}) {
  processItem=processor;
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
  processingFinished = Promise.resolve();
  updateCheckpoint = null;syncPromise=null;retryChain=Promise.resolve();
  if(syncTimer)clearTimeout(syncTimer);syncTimer=null;
  if (leaseRetryTimer) clearTimeout(leaseRetryTimer);
  leaseRetryTimer = null;
  notify();
}
