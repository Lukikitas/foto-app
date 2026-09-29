import { readDocument, mutateDocument } from './sharedDocuments.js';
import { documentChanges, applyDocumentChanges } from './documentChanges.js';
import { emptyStore, parseStore, groupPhotoFlags } from './metrics.js';
import { fetchPhotos, PHOTO_GALLERY_KINDS } from './photos.js';
import { loadComplaintHistory } from './complaintHistoryStore.js';
import { groupHistoryFlags } from './complaintHistory.js';

const CACHE_KEY = 'foto-app-metrics-store';
const VIEW_KEY = 'foto-app-metrics-view';
const PERIOD_KEY = 'foto-app-metrics-period';
const snapshots = new Map();
function rememberMetrics(store) {
  snapshots.set(store.updatedAt || 'empty', structuredClone(store));
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(store)); } catch { /* Cache is optional. */ }
  return store;
}
export async function loadMetricsStore({ strict = false } = {}) {
  try { const doc = await readDocument('metrics', emptyStore); return rememberMetrics(parseStore(doc.data)); }
  catch (error) {
    if (strict) throw error;
    try { const raw = localStorage.getItem(CACHE_KEY); if (raw) return rememberMetrics(parseStore(JSON.parse(raw))); } catch { /* Report original error. */ }
    throw error;
  }
}
export async function saveMetricsStore(store) {
  const baseline = snapshots.get(store.updatedAt || 'empty');
  if (!baseline) throw new Error('Recargá las métricas antes de guardar.');
  const delta = documentChanges(baseline, parseStore(store));
  const saved = await mutateDocument('metrics', emptyStore, parseStore, current => ({
    ...applyDocumentChanges(current, delta), version: 1, updatedAt: new Date().toISOString(),
  }));
  return rememberMetrics(saved);
}
export async function fetchPhotoFlags(dateFrom, dateTo) {
  const photos = await fetchPhotos({
    kind: PHOTO_GALLERY_KINDS.orders,
    dateFrom,
    dateTo,
    columns: 'id,file_path,created_at,has_complaint,is_refutado,aggregator',
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
    if (value === 'entry' || value === 'overview' || value === 'complaints' || value === 'report' || value === 'staff') {
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
