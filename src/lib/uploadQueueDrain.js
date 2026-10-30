import { notifyQueueProcessed } from './uploadQueueBackground.js';
import { processQueueItem } from './uploadQueueProcessor.js';
import {
  applyLease,
  clearLease,
  isActiveQueueStatus,
  isForeignLeaseActive,
  pickStoredQueueRecord,
  QUEUE_LEASE_MS,
  QUEUE_OWNER,
} from './uploadQueueProtocol.js';
import {
  deleteQueueRecord,
  hydrateQueueRecord,
  listQueueSummaries, getQueueRecord,
  putQueueRecord,
  patchQueueRecord,
  serializeQueueRecord,
} from './uploadQueueStore.js';

let storedDrain = null;
let drainAgain = false;

function persistStoredItem(item, owner, { holdLease = true } = {}) {
  if (item.status === 'done') return deleteQueueRecord(item.id);
  const record = holdLease
    ? applyLease(serializeQueueRecord(item), owner)
    : clearLease(serializeQueueRecord(item));
  return item.persisted ? patchQueueRecord(record) : putQueueRecord(record);
}

export async function processStoredUploadQueue(overrides = {}) {
  const { owner = QUEUE_OWNER.sw, ...itemOverrides } = overrides;
  if (storedDrain) { drainAgain = true; return storedDrain; }

  storedDrain = (async () => {
    try {
      const seen = new Set();
      let retryScheduled = false;
      let waitedForPageLease = false;
      let records = await listQueueSummaries();
      let rescanned = false;
      while (true) {
        const record = pickStoredQueueRecord(records, owner, Date.now(), { skipIds: seen });
        if (!record) {
          if (!rescanned) { records = await listQueueSummaries(); rescanned = true; continue; }
          if (owner === QUEUE_OWNER.sw && !waitedForPageLease) {
            const now = Date.now();
            const leased = records.filter((entry) =>
              isActiveQueueStatus(entry.status)
              && isForeignLeaseActive(entry, owner, now)
              && !seen.has(entry.id));
            if (leased.length) {
              waitedForPageLease = true;
              const soonest = Math.min(...leased.map((entry) => entry.leaseUntil));
              const delay = Math.min(QUEUE_LEASE_MS + 50, Math.max(25, soonest - now + 25));
              await new Promise((resolve) => setTimeout(resolve, delay));
              records = await listQueueSummaries();
              continue;
            }
          }
          // Reject a background sync with retryable pending work so the browser
          // can schedule another sync instead of treating this as a full drain.
          if (retryScheduled && owner === QUEUE_OWNER.sw) throw new Error('Hay subidas pendientes de reintento por conexión.');
          return;
        }
        seen.add(record.id);
        const stored = await getQueueRecord(record.id);
        const item = stored ? hydrateQueueRecord(stored) : null;
        if (!item) {
          await deleteQueueRecord(record.id);
          continue;
        }
        item.storagePath = record.storagePath || item.storagePath;

        try {
          const result = await processQueueItem(item, {
            persist: (entry, options) => persistStoredItem(entry, owner, options),
            notify: () => {
              void notifyQueueProcessed(globalThis, item.id);
            },
            onComplete: () => {
              void notifyQueueProcessed(globalThis, item.id);
            },
            ...itemOverrides,
          });
          if (result?.retryScheduled) retryScheduled = true;
          if (result?.yielded) continue;
        } catch (error) {
          console.error(error);
        }
      }
    } finally {
      const repeat = drainAgain;
      drainAgain = false;
      storedDrain = null;
      await notifyQueueProcessed();
      if (repeat) await processStoredUploadQueue(overrides);
    }
  })();

  return storedDrain;
}

export function resetStoredUploadQueueForTests() {
  storedDrain = null;
  drainAgain = false;
}
