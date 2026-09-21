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
  listQueueRecords,
  putQueueRecord,
  serializeQueueRecord,
} from './uploadQueueStore.js';

let storedDrain = null;

function persistStoredItem(item, owner, { holdLease = true } = {}) {
  if (item.status === 'done') return deleteQueueRecord(item.id);
  const record = holdLease
    ? applyLease(serializeQueueRecord(item), owner)
    : clearLease(serializeQueueRecord(item));
  return putQueueRecord(record);
}

export async function processStoredUploadQueue(overrides = {}) {
  const { owner = QUEUE_OWNER.sw, ...itemOverrides } = overrides;
  if (storedDrain) return storedDrain;

  storedDrain = (async () => {
    try {
      const seen = new Set();
      let waitedForPageLease = false;
      while (true) {
        let records = [];
        try {
          records = await listQueueRecords();
        } catch (error) {
          console.error(error);
          return;
        }

        const record = pickStoredQueueRecord(records, owner, Date.now(), { skipIds: seen });
        if (!record) {
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
              continue;
            }
          }
          return;
        }
        seen.add(record.id);
        const item = hydrateQueueRecord(record);
        if (!item) {
          await deleteQueueRecord(record.id);
          continue;
        }
        item.storagePath = record.storagePath || item.storagePath;

        try {
          const result = await processQueueItem(item, {
            persist: (entry, options) => persistStoredItem(entry, owner, options),
            notify: () => {
              void notifyQueueProcessed();
            },
            onComplete: () => {
              void notifyQueueProcessed();
            },
            ...itemOverrides,
          });
          if (result?.yielded) continue;
        } catch (error) {
          console.error(error);
        }
      }
    } finally {
      storedDrain = null;
      await notifyQueueProcessed();
    }
  })();

  return storedDrain;
}

export function resetStoredUploadQueueForTests() {
  storedDrain = null;
}
