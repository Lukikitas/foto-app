import { supabase } from './supabase.js';
import { emptyStore, parseStore, groupPhotoFlags } from './metrics.js';
import { fetchPhotos, PHOTO_GALLERY_KINDS } from './photos.js';
import { loadComplaintHistory } from './complaintHistoryStore.js';
import { groupHistoryFlags } from './complaintHistory.js';

const BUCKET = 'photos';
const FILE_PATH = 'metrics/dashboard.json';
const CACHE_KEY = 'foto-app-metrics-store';
const VIEW_KEY = 'foto-app-metrics-view';
const PERIOD_KEY = 'foto-app-metrics-period';

function isMissingObject(error) {
  const status = String(error?.statusCode || error?.status || '');
  const message = String(error?.message || error?.error || '').toLowerCase();
  return status === '404' || message.includes('not found') || message.includes('object not found');
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? parseStore(JSON.parse(raw)) : null;
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

export async function loadMetricsStore({ strict = false } = {}) {
  const { data, error } = await supabase.storage.from(BUCKET).download(FILE_PATH);

  if (error) {
    if (isMissingObject(error)) {
      const empty = emptyStore();
      writeCache(empty);
      return empty;
    }
    if (strict) throw new Error(error.message || 'No se pudieron leer las métricas actuales.');
    const cached = readCache();
    if (cached) return cached;
    throw new Error(error.message || 'No se pudieron leer las métricas.');
  }

  try {
    const parsed = parseStore(JSON.parse(await data.text()));
    writeCache(parsed);
    return parsed;
  } catch {
    if (strict) throw new Error('No se pudieron interpretar las métricas actuales.');
    const empty = emptyStore();
    writeCache(empty);
    return empty;
  }
}

export async function saveMetricsStore(store) {
  const next = {
    ...parseStore(store),
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(next)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(FILE_PATH, blob, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  });
  if (error) throw new Error(error.message || 'No se pudieron guardar las métricas.');
  writeCache(next);
  return next;
}

export async function fetchPhotoFlags(dateFrom, dateTo) {
  const photos = await fetchPhotos({
    kind: PHOTO_GALLERY_KINDS.orders,
    dateFrom,
    dateTo,
    columns: 'id,file_path,created_at,has_complaint,is_refutado',
  });
  return groupPhotoFlags(photos);
}

export async function fetchHistoryFlags(dateFrom, dateTo) {
  try {
    const store = await loadComplaintHistory();
    return groupHistoryFlags(store, dateFrom, dateTo);
  } catch {
    return {};
  }
}

export function getMetricsView() {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    if (value === 'dashboard') return 'overview';
    if (value === 'entry' || value === 'overview' || value === 'complaints' || value === 'report') {
      return value;
    }
    return 'overview';
  } catch {
    return 'overview';
  }
}

export function saveMetricsView(view) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // localStorage no disponible
  }
}

export function getSavedPeriod() {
  try {
    const raw = localStorage.getItem(PERIOD_KEY);
    if (!raw) return { preset: 'week', customFrom: '', customTo: '' };
    const parsed = JSON.parse(raw);
    return {
      preset: parsed.preset || 'week',
      customFrom: parsed.customFrom || '',
      customTo: parsed.customTo || '',
    };
  } catch {
    return { preset: 'week', customFrom: '', customTo: '' };
  }
}

export function savePeriod(period) {
  try {
    localStorage.setItem(PERIOD_KEY, JSON.stringify(period));
  } catch {
    // localStorage no disponible
  }
}
