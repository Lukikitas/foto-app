import { supabase } from './supabase.js';
import { sharedError, readDocument, commitDocuments } from './sharedDocuments.js';
import { emptyHistory, parseHistory } from './complaintHistory.js';
import { emptyStore, parseStore } from './metrics.js';
import { mergeDraft, mergeDraftMetrics, normalizeDraftComplaint, findDraftHistory } from './complaintDraft.js';
import { fetchPhotosForComplaints } from './complaints.js';
import { matchComplaintsToPhotos } from './complaintMatch.js';
import { fetchPhotosByIds } from './photos.js';
import { loadComplaintHistory } from './complaintHistoryStore.js';
import { recordManualCruzar } from './complaintSyncStore.js';
import { announceWorkbookImport } from './workbookImportEvents.js';

const listeners = new Set();
const CACHE_KEY = 'foto-app-review-draft-v1';
export function cachedDraft() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}
function cache(draft) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(draft)); } catch { /* Cache is optional. */ }
  return draft;
}
export function subscribeDrafts(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function emit(draft) { cache(draft); listeners.forEach(listener => listener(draft)); return draft; }
function online() { if (navigator.onLine === false) throw new Error('Necesitás conexión para modificar la lista compartida.'); }
async function action(name, args = {}) {
  online();
  const { data, error } = await supabase.rpc('foto_draft_action', { action: name, ...args });
  if (error) throw sharedError(error);
  return data;
}
export async function loadDraft() { return cache(await action('read')); }
export async function prepareComplaintDraft(complaints, { source = 'manual', report = null, sheetUrl = '', pickedPhotoIds = {} } = {}) {
  online();
  if (await loadDraft()) throw new Error('Ya hay una lista pendiente. Guardala o descartala primero en Gestionar.');
  // Matching is read-only. The review UI repeats it after edits or new photos.
  await fetchPhotosForComplaints(complaints);
  return emit(await action('create', { payload: { source, report, sheetUrl, complaints: complaints.map(normalizeDraftComplaint), pickedPhotoIds } }));
}
export async function updateDraft(draft, patch) {
  if (patch.complaints) patch = { ...patch, complaints: patch.complaints.map(normalizeDraftComplaint) };
  return emit(await action('update', { draft_id: draft.id, expected_revision: draft.revision, payload: { ...draft.data, ...patch } }));
}
export async function discardDraft(draft) {
  await action('discard', { draft_id: draft.id, expected_revision: draft.revision });
  emit(null);
}
export async function matchDraft(draft, history) {
  const complaints = draft.data.complaints;
  const photos = await fetchPhotosForComplaints(complaints);
  const existingIds = complaints.map(item => {
    try { return findDraftHistory(history, item)?.photoId; } catch { return null; }
  }).filter(Boolean);
  const extra = existingIds.length ? await fetchPhotosByIds([...new Set(existingIds)]) : [];
  const byId = new Map([...photos, ...extra].map(photo => [photo.id, photo]));
  const rows = matchComplaintsToPhotos(complaints, [...byId.values()]).map(row => {
    let existing;
    try { existing = findDraftHistory(history, row.complaint); } catch { /* Review can resolve this. */ }
    const manualId = draft.data.pickedPhotoIds?.[row.complaint.id];
    const chosen = byId.get(manualId || existing?.photoId);
    return chosen ? { ...row, photo: chosen, status: 'matched', candidates: [...new Map([...row.candidates, chosen].map(p => [p.id,p])).values()] } : row;
  });
  return { rows, photos: [...byId.values()] };
}
export async function confirmDraft(draft) {
  online();
  for (let attempt = 0; attempt < 4; attempt++) {
    const historyDoc = await readDocument('history', emptyHistory);
    const metricsDoc = draft.data.report ? await readDocument('metrics', emptyStore) : null;
    const history = parseHistory(historyDoc.data);
    const { rows } = await matchDraft(draft, history);
    const result = mergeDraft(history, draft.data, rows);
    const stamp = new Date().toISOString();
    result.store.updatedAt = stamp;
    const changes = [{ key: 'history', revision: historyDoc.revision, data: result.store }];
    if (metricsDoc) changes.push({ key: 'metrics', revision: metricsDoc.revision,
      data: { ...mergeDraftMetrics(parseStore(metricsDoc.data), draft.data), updatedAt: stamp } });
    const summary = { added: result.added, updated: result.updated, count: draft.data.complaints.length };
    try {
      const saved = await commitDocuments(changes, { draft_id: draft.id, draft_revision: draft.revision,
        photo_ids: [...new Set(result.affected.map(id => result.store.items[id]?.photoId).filter(Boolean))],
        commit_result: summary });
      emit(null);
      await loadComplaintHistory({ force: true, strict: true }).catch(() => {});
      let warning = '';
      if (draft.data.sheetUrl) {
        try { await recordManualCruzar(draft.data.sheetUrl); }
        catch { warning = 'Los reclamos se guardaron; no se pudo actualizar la hora del cruce manual.'; }
      }
      announceWorkbookImport({ historySaved: true, metricsSaved: Boolean(metricsDoc),
        history: { ...summary, complaints: [] }, warning });
      return { ...(saved.result || summary), warning };
    } catch (error) {
      if (!error.message.includes('REVISION_CONFLICT') || attempt === 3) throw error;
      const currentDraft = await loadDraft();
      if (!currentDraft || currentDraft.id !== draft.id || currentDraft.revision !== draft.revision) throw error;
    }
  }
}
