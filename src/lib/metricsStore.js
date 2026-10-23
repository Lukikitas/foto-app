import { readDocument, mutateDocument } from './sharedDocuments.js';
import { documentChanges, applyDocumentChanges } from './documentChanges.js';
import { emptyStore, parseStore, groupPhotoFlags } from './metrics.js';
import { fetchPhotos, PHOTO_GALLERY_KINDS } from './photos.js';
import { loadComplaintHistory } from './complaintHistoryStore.js';
import { groupHistoryFlags } from './complaintHistory.js';
import { METRICS_BASELINE as BASELINE } from './metricsBaseline.js';
import { supabase } from './supabase.js';
import { withRequestTimeout } from './requestTimeout.js';

const CACHE_KEY = 'foto-app-metrics-store';
const VIEW_KEY = 'foto-app-metrics-view';
const PERIOD_KEY = 'foto-app-metrics-period';
const snapshots = new Map();
let memoryStore = null;
let lastDocument = null;
let loadPromise = null;
let lastRead = { cached: false, readAt: null };
export function metricsReadStatus() { return lastRead; }
function rememberMetrics(store) {
  const baseline = structuredClone(parseStore(store));
  // Object spreads made by editors carry the symbol; JSON serialization omits it.
  store[BASELINE] = baseline;
  snapshots.set(store.updatedAt || 'empty', baseline);
  while (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value);
  return store;
}
export function acceptCommittedMetrics(document) {
  lastRead = {cached:false,readAt:new Date().toISOString()};
  lastDocument = document;
  memoryStore = rememberMetrics(parseStore(document.data));
  return memoryStore;
}
export async function loadMetricsStore({ strict = false } = {}) {
  try {
    if (!loadPromise) loadPromise = readDocument('metrics', emptyStore).then(doc => {
      if (doc === lastDocument && memoryStore) return memoryStore;
      lastDocument = doc;
      memoryStore = rememberMetrics(parseStore(doc.data));
      return memoryStore;
    }).finally(() => { loadPromise = null; });
    const result = await loadPromise;
    lastRead = { cached: false, readAt: new Date().toISOString() };
    return result;
  }
  catch (error) {
    if (strict) throw error;
    try { const raw = localStorage.getItem(CACHE_KEY); if (raw) { lastRead = { cached: true, readAt: new Date().toISOString() }; return rememberMetrics(parseStore(JSON.parse(raw))); } } catch { /* Report original error. */ }
    throw error;
  }
}
export async function loadMetricsHeader() {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('foto_metrics_header').abortSignal(signal));
  if (error || !data?.data) return loadMetricsStore({ strict: true });
  const store = parseStore(data.data);
  store.availableLastDay = data.availableLastDay;
  return rememberMetrics(store);
}
export function rememberMetricsView(store) { return rememberMetrics({ ...parseStore(store), availableLastDay: store.availableLastDay }); }
export async function saveMetricsStore(store) {
  const baseline = store[BASELINE] || snapshots.get(store.updatedAt || 'empty');
  if (!baseline) throw new Error('Recargá las métricas antes de guardar.');
  const delta = documentChanges(baseline, parseStore(store));
  const saved = await mutateDocument('metrics', emptyStore, parseStore, current => ({
    ...applyDocumentChanges(current, delta), version: 1, updatedAt: new Date().toISOString(),
  }));
  lastRead = {cached:false,readAt:new Date().toISOString()};
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
