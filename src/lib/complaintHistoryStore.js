import { supabase } from './supabase.js';
import {
  attachPhotosToHistory,
  clearHistoryItems,
  complaintHistoryId,
  COMPLAINT_STATUSES,
  deleteHistoryItem,
  deleteHistoryItems,
  editHistoryItemInStore,
  emptyHistory,
  parseHistory,
  patchHistoryItem,
  patchHistoryItems,
  syncGalleryComplaintInStore,
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
const listeners = new Set();

function emitComplaintHistory(store) {
  listeners.forEach((listener) => {
    try {
      listener(store);
    } catch {
      // un subscriber no debe frenar el guardado
    }
  });
}

function remember(store) {
  memoryStore = store;
  writeCache(store);
  emitComplaintHistory(store);
  return store;
}

export function cachedComplaintHistory() {
  return memoryStore || readCache() || emptyHistory();
}

export function subscribeComplaintHistory(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadComplaintHistory({ force = false, strict = false } = {}) {
  if (memoryStore && !force) return memoryStore;
  if (loadPromise) {
    if (!strict) return loadPromise;
    await loadPromise;
  }

  loadPromise = (async () => {
    const { data, error } = await supabase.storage.from(BUCKET).download(FILE_PATH);
    if (error) {
      if (isMissingObject(error)) {
        return remember(emptyHistory());
      }
      if (strict) throw new Error(error.message || 'No se pudo leer el historial actual.');
      const cached = readCache();
      if (cached) {
        return remember(cached);
      }
      throw new Error(error.message || 'No se pudo leer el historial de reclamos.');
    }

    let parsed;
    try {
      parsed = parseHistory(JSON.parse(await data.text()));
    } catch {
      if (strict) throw new Error('No se pudo interpretar el historial actual.');
      parsed = emptyHistory();
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

export async function saveComplaintHistory(store) {
  const next = {
    ...parseHistory(store),
    version: 2,
    updatedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(next)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(FILE_PATH, blob, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  });
  if (error) throw new Error(error.message || 'No se pudo guardar el historial de reclamos.');
  return remember(next);
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

function nextStatus(current, { status, accepted, refutado } = {}) {
  if (status && COMPLAINT_STATUSES[status]) return status;
  if (accepted && refutado) return COMPLAINT_STATUSES.refutado_aceptado;
  if (refutado) return COMPLAINT_STATUSES.refutado;
  if (accepted) return COMPLAINT_STATUSES.refutado_rechazado;
  return current.status || COMPLAINT_STATUSES.queja;
}

function resolutionPatch(current, photo, { status, accepted, refutado } = {}) {
  return {
    status: nextStatus(current, { status, accepted, refutado }),
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

export function setHistoryResolutions(rows, { status, accepted, refutado } = {}) {
  return mutateComplaintHistory((store) => {
    let next = store;
    rows.forEach(({ complaint, photo }) => {
      if (!complaint) return;
      const id = complaintHistoryId(complaint);
      if (!next.items[id]) {
        next = upsertHistoryItems(next, [complaint]).store;
      }
      const current = next.items[id] || Object.values(next.items).find((item) => item.sourceId === id);
      if (!current) return;
      next = patchHistoryItem(next, current.id, resolutionPatch(current, photo, { status, accepted, refutado }));
    });
    return next;
  });
}

export function setHistoryResolution(complaint, photo, { status, accepted, refutado } = {}) {
  return setHistoryResolutions([{ complaint, photo }], { status, accepted, refutado });
}

export function setHistoryPhoto(complaint, photo) {
  return mutateComplaintHistory((store) => {
    let next = store;
    const id = complaintHistoryId(complaint);
    if (!next.items[id]) {
      next = upsertHistoryItems(next, [complaint]).store;
    }
    const current = next.items[id] || Object.values(next.items).find((item) => item.sourceId === id);
    if (!current || !photo) return next;
    return patchHistoryItem(next, current.id, {
      photoId: photo.id,
      photoName: photo.name,
      photoUrl: photo.public_url,
    });
  });
}

export function deleteHistoryItemById(id) {
  return mutateComplaintHistory((store) => deleteHistoryItem(store, id));
}

export function deleteHistoryItemsByIds(ids) {
  return mutateComplaintHistory((store) => deleteHistoryItems(store, ids));
}

export function patchHistoryItemsByIds(ids, patch) {
  return mutateComplaintHistory((store) => patchHistoryItems(store, ids, patch));
}

export function editHistoryItemById(id, changes) {
  return mutateComplaintHistory((store) => editHistoryItemInStore(store, id, changes));
}

export function clearComplaintHistory() {
  return mutateComplaintHistory((store) => clearHistoryItems(store));
}

export function syncGalleryComplaintToHistory(photo) {
  if (!photo) return Promise.resolve(cachedComplaintHistory());
  return mutateComplaintHistory((store) => syncGalleryComplaintInStore(store, photo));
}

export function setHistoryResolutionForPhoto(photo, { status, accepted, refutado } = {}) {
  return setHistoryResolution(
    {
      orderCode: photo.name,
      orderAtIso: photo.created_at,
      reason: '',
      comment: '',
    },
    photo,
    { status, accepted, refutado },
  );
}
