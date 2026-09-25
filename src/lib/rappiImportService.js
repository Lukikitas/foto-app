import { beginWorkbookImport } from './workbookImportEvents.js';
import { executePeyaImport } from './peyaImportFlow.js';
import { mergeRappiHistory, mergeRappiMetrics } from './rappiWorkbook.js';
import { loadComplaintHistory, mutateComplaintHistory } from './complaintHistoryStore.js';
import { loadMetricsStore, saveMetricsStore } from './metricsStore.js';
import { fetchPhotosForComplaints, saveComplaintBatch } from './complaints.js';
import { matchComplaintsToPhotos } from './complaintMatch.js';
import { getPhotoAggregator } from './aggregators.js';
import { announceWorkbookImport } from './workbookImportEvents.js';
export async function importRappiReport(report) {
  const release = beginWorkbookImport();
  try {
    const result = await executePeyaImport(report, {
      loadMetrics: () => loadMetricsStore({ strict: true }),
      validateHistory: async () => mergeRappiHistory(await loadComplaintHistory({ force: true, strict: true }), report),
      matchPhotos: async complaints => matchComplaintsToPhotos(complaints, (await fetchPhotosForComplaints(complaints)).filter(p => getPhotoAggregator(p) === report.aggregator)),
      saveHistory: (incoming, rows) => mutateComplaintHistory(store => mergeRappiHistory(store, incoming, rows)),
      saveMetrics: saveMetricsStore, mergeMetrics: mergeRappiMetrics,
    });
    saveComplaintBatch(result.history.complaints, {});
    announceWorkbookImport(result);
    return result;
  } catch (error) {
    if (error.result?.historySaved) {
      saveComplaintBatch(error.result.history.complaints, {});
      announceWorkbookImport(error.result);
    }
    throw error;
  } finally { release(); }
}
