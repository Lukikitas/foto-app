import { notifyQueueProcessed } from './uploadQueueBackground.js';
import { processQueueItem } from './uploadQueueProcessor.js';
import {
  applyLease,
  clearLease,
  pickStoredQueueRecord,
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
      while (true) {
        let records = [];
        try {
          records = await listQueueRecords();
        } catch (error) {
          console.error(error);
          return;
        }

        const record = pickStoredQueueRecord(records, owner, Date.now(), { skipIds: seen });
        if (!record) return;
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
            allowOcr: owner !== QUEUE_OWNER.sw,
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
