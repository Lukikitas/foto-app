import { executePeyaImport } from './peyaImportFlow.js';
import { mergePeyaHistory } from './peyaWorkbook.js';
import { loadComplaintHistory, mutateComplaintHistory } from './complaintHistoryStore.js';
import { loadMetricsStore, saveMetricsStore } from './metricsStore.js';
import { fetchPhotosForComplaints, saveComplaintBatch } from './complaints.js';
import { matchComplaintsToPhotos } from './complaintMatch.js';
import { getPhotoAggregator } from './aggregators.js';

const listeners = new Set();
let importing = false;
export function subscribePeyaImport(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function announce(result) { for (const listener of listeners) { try { listener(result); } catch { /* subscriber cannot invalidate a saved import */ } } }
export async function importPeyaReport(report) {
  if (importing) throw new Error('Ya hay una importación de PedidosYa en curso.');
  importing = true;
  const deps = {
    loadMetrics: () => loadMetricsStore({ strict: true }),
    validateHistory: async () => mergePeyaHistory(await loadComplaintHistory({ force: true, strict: true }), report),
    matchPhotos: async complaints => matchComplaintsToPhotos(complaints, (await fetchPhotosForComplaints(complaints)).filter(p => getPhotoAggregator(p) === 'pedidosya')),
    saveHistory: (incoming, rows) => mutateComplaintHistory(store => mergePeyaHistory(store, incoming, rows)),
    saveMetrics: saveMetricsStore,
  };
  try {
    const result = await executePeyaImport(report, deps);
    saveComplaintBatch(result.history.complaints, {});
    announce(result);
    return result;
  } catch (error) {
    if (error.result?.historySaved) {
      saveComplaintBatch(error.result.history.complaints, {});
      announce(error.result);
    }
    throw error;
  } finally { importing = false; }
}
