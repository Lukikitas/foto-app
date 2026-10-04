import { readDocument, mutateDocument } from './sharedDocuments.js';
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

const CACHE_KEY = 'foto-app-complaints-history';
let memoryStore = null;
let loadPromise = null;
const listeners = new Set();
function remember(store) {
  memoryStore = store;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(store)); } catch { /* Cache is optional. */ }
  listeners.forEach(listener => listener(store));
  return store;
}
export function cachedComplaintHistory() {
  if (memoryStore) return memoryStore;
  try { return parseHistory(JSON.parse(localStorage.getItem(CACHE_KEY))); } catch { return emptyHistory(); }
}
export function subscribeComplaintHistory(listener) {
  listeners.add(listener); return () => listeners.delete(listener);
}
// Revisión del último documento leído: el sondeo cada 5s puede cortar el
// parseo completo del historial (costoso con lotes grandes) si no cambió.
let lastRevision = null;

export async function loadComplaintHistory({ force = false, strict = false } = {}) {
  if (memoryStore && !force && !strict) return memoryStore;
  if (loadPromise) return loadPromise;
  loadPromise = readDocument('history', emptyHistory)
    .then(doc => {
      if (memoryStore && typeof doc?.revision === 'number' && doc.revision === lastRevision) {
        return memoryStore;
      }
      if (typeof doc?.revision === 'number') lastRevision = doc.revision;
      const parsed = parseHistory(doc.data);
      // Misma fecha de actualización = mismo contenido: devolvemos la referencia
      // en memoria para no serializar a localStorage ni re-renderizar suscritos.
      if (memoryStore && memoryStore.updatedAt === parsed.updatedAt) return memoryStore;
      return remember(parsed);
    })
    .catch(error => { if (strict) throw error; if (memoryStore) return memoryStore; throw error; })
    .finally(() => { loadPromise = null; });
  return loadPromise;
}
export async function mutateComplaintHistory(mutator) {
  const result = await mutateDocument('history', emptyHistory, parseHistory, current => {
    const result = mutator(current);
    const next = result?.store || result;
    next.updatedAt = new Date().toISOString();
    return result;
  });
  remember(result?.store || result);
  return result;
}
function nextStatus(current, { status, accepted, refutado } = {}) {
  if (status && COMPLAINT_STATUSES[status]) return status;
  if (accepted && refutado) return COMPLAINT_STATUSES.refutado_aceptado;
  if (refutado) return COMPLAINT_STATUSES.refutado;
  if (accepted) return COMPLAINT_STATUSES.refutado_rechazado;
  return current.status || COMPLAINT_STATUSES.queja;
}

function resolutionPatch(current, photo, { status, accepted, refutado, unrefutableReason } = {}) {
  const nextStatusValue = nextStatus(current, { status, accepted, refutado });
  const patch = {
    status: nextStatusValue,
    photoId: photo?.id || current.photoId,
    photoName: photo?.name || current.photoName,
    photoUrl: photo?.public_url || current.photoUrl,
  };
  if (nextStatusValue === COMPLAINT_STATUSES.no_refutable) {
    patch.unrefutableReason = String(
      unrefutableReason || current.unrefutableReason || '',
    ).trim();
  } else if (current.unrefutableReason) {
    // Salir del estado «No refutable» limpia el motivo para no dejar datos viejos.
    patch.unrefutableReason = '';
  }
  return patch;
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

export function setHistoryResolutions(rows, { status, accepted, refutado, unrefutableReason } = {}) {
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
      next = patchHistoryItem(
        next,
        current.id,
        resolutionPatch(current, photo, { status, accepted, refutado, unrefutableReason }),
      );
    });
    return next;
  });
}

export function setHistoryResolution(complaint, photo, { status, accepted, refutado, unrefutableReason } = {}) {
  return setHistoryResolutions([{ complaint, photo }], { status, accepted, refutado, unrefutableReason });
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

export function setHistoryResolutionForPhoto(photo, { status, accepted, refutado, unrefutableReason } = {}) {
  return setHistoryResolution(
    {
      orderCode: photo.name,
      orderAtIso: photo.created_at,
      reason: '',
      comment: '',
    },
    photo,
    { status, accepted, refutado, unrefutableReason },
  );
}
