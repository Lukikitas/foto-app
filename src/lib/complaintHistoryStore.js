import { supabase } from './supabase.js';
import {
  attachPhotosToHistory,
  complaintHistoryId,
  emptyHistory,
  parseHistory,
  patchHistoryItem,
  upsertHistoryItems,
} from './complaintHistory.js';

const BUCKET = 'photos';
const FILE_PATH = 'complaints/history.json';
const CACHE_KEY = 'foto-app-complaints-history';

function isMissingObject(error) {
  const status = String(error?.statusCode || error?.status || '');
  const message = String(error?.message || error?.error || '').toLowerCase();
  return status === '404' || message.includes('not found') || message.includes('object not found');
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parseHistory(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(store) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    // localStorage no disponible
  }
}

let memoryStore = null;
let loadPromise = null;
let writeChain = Promise.resolve();

export function cachedComplaintHistory() {
  return memoryStore || readCache() || emptyHistory();
}

export async function loadComplaintHistory({ force = false } = {}) {
  if (memoryStore && !force) return memoryStore;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const { data, error } = await supabase.storage.from(BUCKET).download(FILE_PATH);
    if (error) {
      if (isMissingObject(error)) {
        memoryStore = emptyHistory();
        writeCache(memoryStore);
        return memoryStore;
      }
      const cached = readCache();
      if (cached) {
        memoryStore = cached;
        return cached;
      }
      throw new Error(error.message || 'No se pudo leer el historial de reclamos.');
    }

    try {
      memoryStore = parseHistory(JSON.parse(await data.text()));
    } catch {
      memoryStore = emptyHistory();
    }
    writeCache(memoryStore);
    return memoryStore;
  })().finally(() => {
    loadPromise = null;
  });

  return loadPromise;
}

export async function saveComplaintHistory(store) {
  const next = {
    ...parseHistory(store),
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(next)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(FILE_PATH, blob, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  });
  if (error) throw new Error(error.message || 'No se pudo guardar el historial de reclamos.');
  memoryStore = next;
  writeCache(next);
  return next;
}

export function mutateComplaintHistory(mutator) {
  const run = writeChain.catch(() => {}).then(async () => {
    const current = await loadComplaintHistory();
    const result = mutator(current);
    const next = result?.store || result;
    const saved = await saveComplaintHistory(next);
    if (result && typeof result === 'object' && result.store) {
      return { ...result, store: saved };
    }
    return saved;
  });
  writeChain = run.catch(() => {});
  return run;
}

function resolutionPatch(current, photo, { accepted, refutado } = {}) {
  return {
    accepted: accepted == null ? current.accepted : Boolean(accepted),
    refutado: refutado == null ? current.refutado : Boolean(refutado),
    photoId: photo?.id || current.photoId,
    photoName: photo?.name || current.photoName,
    photoUrl: photo?.public_url || current.photoUrl,
  };
}

export function importComplaintsToHistory(complaints, rows = []) {
  return mutateComplaintHistory((store) => {
    const upserted = upsertHistoryItems(store, complaints);
    return {
      store: attachPhotosToHistory(upserted.store, rows),
      added: upserted.added,
      updated: upserted.updated,
    };
  });
}

export function setHistoryResolutions(rows, { accepted, refutado } = {}) {
  return mutateComplaintHistory((store) => {
    let next = store;
    rows.forEach(({ complaint, photo }) => {
      if (!complaint) return;
      const id = complaintHistoryId(complaint);
      if (!next.items[id]) {
        next = upsertHistoryItems(next, [complaint]).store;
      }
      const current = next.items[id];
      if (!current) return;
      next = patchHistoryItem(next, id, resolutionPatch(current, photo, { accepted, refutado }));
    });
    return next;
  });
}

export function setHistoryResolution(complaint, photo, { accepted, refutado } = {}) {
  return setHistoryResolutions([{ complaint, photo }], { accepted, refutado });
}

export function setHistoryResolutionForPhoto(photo, { accepted, refutado } = {}) {
  return setHistoryResolution(
    {
      orderCode: photo.name,
      orderAtIso: photo.created_at,
      reason: '',
      comment: '',
    },
    photo,
    { accepted, refutado },
  );
}
