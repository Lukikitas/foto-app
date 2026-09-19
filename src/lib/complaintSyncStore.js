import { supabase } from './supabase.js';
import { applyManualCruzarToSync, emptyComplaintSync, parseComplaintSync } from './complaintSync.js';
import { getSavedSheetUrl, saveSheetUrl } from './storage.js';

const BUCKET = 'photos';
const FILE_PATH = 'complaints/sync.json';
const CACHE_KEY = 'foto-app-complaints-sync';

function isMissingObject(error) {
  const status = String(error?.statusCode || error?.status || '');
  const message = String(error?.message || error?.error || '').toLowerCase();
  return status === '404' || message.includes('not found') || message.includes('object not found');
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parseComplaintSync(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(sync) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(sync));
  } catch {
    // localStorage no disponible
  }
}

let memoryStore = null;
let loadPromise = null;
let writeChain = Promise.resolve();

function remember(sync) {
  memoryStore = sync;
  writeCache(sync);
  saveSheetUrl(sync.sheetUrl);
  return sync;
}

export function cachedComplaintSync() {
  return memoryStore || readCache() || parseComplaintSync({ sheetUrl: getSavedSheetUrl() });
}

export async function loadComplaintSync({ force = false } = {}) {
  if (memoryStore && !force) return memoryStore;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { data, error } = await supabase.storage.from(BUCKET).download(FILE_PATH);
    if (error) {
      if (isMissingObject(error)) {
        const migrated = parseComplaintSync({ sheetUrl: getSavedSheetUrl() });
        if (migrated.sheetUrl) {
          try {
            return await saveComplaintSync(migrated);
          } catch {
            return remember(migrated);
          }
        }
        return remember(migrated);
      }
      const cached = readCache() || parseComplaintSync({ sheetUrl: getSavedSheetUrl() });
      return remember(cached);
    }

    let parsed;
    try {
      parsed = parseComplaintSync(JSON.parse(await data.text()));
    } catch {
      parsed = emptyComplaintSync();
    }

    if (
      memoryStore?.updatedAt &&
      parsed.updatedAt &&
      Date.parse(memoryStore.updatedAt) > Date.parse(parsed.updatedAt)
    ) {
      return memoryStore;
    }
    return remember(parsed);
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

export async function saveComplaintSync(sync) {
  const next = {
    ...parseComplaintSync(sync),
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(next)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(FILE_PATH, blob, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  });
  if (error) throw new Error(error.message || 'No se pudo guardar el link compartido del Sheet.');
  return remember(next);
}

export function mutateComplaintSync(mutator) {
  const run = writeChain.catch(() => {}).then(async () => {
    const current = await loadComplaintSync({ force: true });
    return saveComplaintSync(mutator(current));
  });
  writeChain = run.catch(() => {});
  return run;
}

export function saveSharedSheetUrl(url) {
  const sheetUrl = String(url || '').trim();
  saveSheetUrl(sheetUrl);
  return mutateComplaintSync((sync) => ({ ...sync, sheetUrl }));
}

export function recordManualCruzar(url, now = new Date()) {
  return mutateComplaintSync((sync) => applyManualCruzarToSync(sync, url, now));
}
