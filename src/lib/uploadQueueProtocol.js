export const UPLOAD_QUEUE_MESSAGE = {
  process: 'PROCESS_UPLOAD_QUEUE',
  updated: 'UPLOAD_QUEUE_UPDATED',
  skipWaiting: 'SKIP_WAITING',
};

export const UPLOAD_QUEUE_SYNC_TAG = 'upload-queue';
export const UPLOAD_QUEUE_CHANNEL = 'foto-app-upload-queue';
export const QUEUE_LEASE_MS = 20_000;

export const QUEUE_OWNER = {
  page: 'page',
  sw: 'sw',
};

export function getQueueOwner() {
  const Scope = globalThis.ServiceWorkerGlobalScope;
  if (typeof Scope !== 'undefined' && globalThis instanceof Scope) {
    return QUEUE_OWNER.sw;
  }
  return QUEUE_OWNER.page;
}

export function itemNeedsOcr(item) {
  return item?.kind === 'order' && !item.orderDigits && Boolean(item.ticketFile || item.ticket);
}

export function isDocumentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function queueRecordWaitsForPageOcr(record) {
  return itemNeedsOcr(record) && record.status !== 'uploading';
}

export function isActiveQueueStatus(status) {
  return status === 'pending' || status === 'analyzing' || status === 'uploading';
}

export function isForeignLeaseActive(record, owner, now = Date.now()) {
  if (!record?.leaseUntil || record.leaseUntil <= now) return false;
  if (!record.leaseOwner) return false;
  return record.leaseOwner !== owner;
}

export function applyLease(record, owner, now = Date.now(), ttl = QUEUE_LEASE_MS) {
  return {
    ...record,
    leaseOwner: owner,
    leaseUntil: now + ttl,
  };
}

export function clearLease(record) {
  return {
    ...record,
    leaseOwner: null,
    leaseUntil: 0,
  };
}

export function fileExtension(file, fallback = 'jpg') {
  const name = String(file?.name || '');
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext || ext === name.toLowerCase()) return fallback;
  return ext;
}

export function buildStoragePath(item, file) {
  if (item?.storagePath) return item.storagePath;
  const ext = fileExtension(file, file?.type?.startsWith('image/') ? 'jpg' : 'bin');
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}`;
  if (item?.kind === 'file') return `files/${id}.${ext}`;
  if (item?.orderDigits && item?.aggregator) return `orders/${item.aggregator}/${id}.${ext}`;
  if (item?.orderDigits) return `orders/sin_agregador/${id}.${ext}`;
  return `orders/no_code/${id}.${ext}`;
}

export function pickStoredQueueRecord(records, owner, now = Date.now(), options = {}) {
  const skipOcr = options.skipOcr ?? owner === QUEUE_OWNER.sw;
  const skipIds = options.skipIds;

  return [...(records || [])]
    .filter((record) => record?.id && record.status !== 'done' && record.status !== 'error')
    .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0))
    .find((record) => {
      if (skipIds?.has(record.id)) return false;
      if (isForeignLeaseActive(record, owner, now)) return false;
      if (skipOcr && queueRecordWaitsForPageOcr(record)) return false;
      return true;
    }) || null;
}
