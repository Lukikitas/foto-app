import { executePeyaRefunds } from './peyaRefunds.js';
import { loadComplaintHistory, mutateComplaintHistory } from './complaintHistoryStore.js';
import { beginWorkbookImport } from './workbookImportEvents.js';
export async function importPeyaRefunds(report) {
  const release = beginWorkbookImport();
  try {
    return await executePeyaRefunds(report, {
      loadHistory: () => loadComplaintHistory({ force: true, strict: true }),
      mutateHistory: mutateComplaintHistory,
    });
  } finally { release(); }
}
