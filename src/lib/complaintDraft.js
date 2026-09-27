import { complaintDay, complaintHistoryId, upsertHistoryItems, parseHistory, editHistoryItemInStore } from './complaintHistory.js';
import { compactCode } from './complaintMatch.js';
import { mergePeyaHistory, mergePeyaMetrics } from './peyaWorkbook.js';
import { mergeRappiHistory, mergeRappiMetrics } from './rappiWorkbook.js';
import { AGGREGATORS } from './aggregators.js';

const core = code => compactCode(code).replace(/^(PEYA|RAPPITURBO|RAPPI)/, '');
export function findDraftHistory(history, complaint) {
  const id = complaintHistoryId(complaint);
  const matches = Object.values(history.items || {}).filter(item =>
    (item.sourceId === (complaint.originalId || id) && item.manualEdit) ||
    ((item.id === id || (core(item.orderCode) === core(complaint.orderCode) && complaintDay(item) === complaintDay(complaint)))
      && (!item.aggregator || item.aggregator === complaint.aggregator)));
  if (matches.length > 1) throw new Error('Hay varios reclamos para ' + complaint.orderCode + '. Corregí la fila antes de guardar.');
  return matches[0] || null;
}
export function normalizeDraftComplaint(complaint) {
  return { ...complaint, originalId: complaint.originalId || complaint.id || complaintHistoryId(complaint),
    id: complaintHistoryId(complaint) };
}
export function validateDraft(complaints) {
  const keys = new Set();
  for (const item of complaints) {
    if (!compactCode(item.orderCode) || !complaintDay(item) || !AGGREGATORS[item.aggregator]) throw new Error('Completá código, fecha y agregador en todas las filas.');
    const day = complaintDay(item);
    const parsed = new Date(day + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) throw new Error('Corregí la fecha inválida antes de guardar.');
    if (item.amount != null && (item.amount === '' || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0)) throw new Error('El monto debe ser un número válido, mayor o igual a cero.');
    const key = item.aggregator + '|' + complaintHistoryId(item);
    if (keys.has(key)) throw new Error('Hay filas duplicadas para el mismo pedido, fecha y agregador.');
    keys.add(key);
  }
}
export function mergeDraft(history, draft, rows = []) {
  validateDraft(draft.complaints);
  let store = parseHistory(history); let added = 0; let updated = 0;
  const affected = [];
  for (const raw of draft.complaints) {
    const complaint = normalizeDraftComplaint(raw);
    const previous = findDraftHistory(store, complaint);
    if (previous && complaint.identityEdited && (previous.orderCode !== complaint.orderCode || previous.aggregator !== complaint.aggregator)) {
      store = editHistoryItemInStore(store, previous.id, { orderCode: complaint.orderCode, aggregator: complaint.aggregator });
    }
    const report = { complaints: [complaint] };
    const result = complaint.aggregator === 'pedidosya'
      ? mergePeyaHistory(store, report)
      : ['rappi','rappi_turbo'].includes(complaint.aggregator)
        ? mergeRappiHistory(store, report)
        : upsertHistoryItems(store, report.complaints);
    store = result.store; added += result.added; updated += result.updated;
    const item = findDraftHistory(store, complaint) || store.items[complaint.id];
    if (!item) throw new Error('No se pudo identificar el reclamo actualizado.');
    const row = rows.find(row => row.complaint.id === complaint.id);
    const manual = draft.pickedPhotoIds?.[complaint.id];
    if (row?.photo && (!item.photoId || manual)) {
      Object.assign(item, { photoId: row.photo.id, photoName: row.photo.name, photoUrl: row.photo.public_url });
    }
    affected.push(item.id);
  }
  return { store, added, updated, affected };
}
export function mergeDraftMetrics(metrics, draft) {
  if (!draft.report) return metrics;
  if (draft.source === 'peya') return mergePeyaMetrics(metrics, draft.report);
  if (draft.source === 'rappi') return mergeRappiMetrics(metrics, draft.report);
  return metrics;
}
export function draftComparison(history, draft, rows = []) {
  const result = mergeDraft(history, draft, rows);
  let changed = 0;
  const ignore = value => {
    const item = { ...value }; delete item.updatedAt; delete item.importedAt; return item;
  };
  for (const id of result.affected) {
    const previous = history.items?.[id];
    if (previous && JSON.stringify(ignore(previous)) !== JSON.stringify(ignore(result.store.items[id]))) changed++;
  }
  return { ...result, changed, unchanged: Math.max(0, draft.complaints.length - result.added - changed) };
}
