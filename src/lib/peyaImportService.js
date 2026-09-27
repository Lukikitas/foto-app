import { prepareComplaintDraft } from './complaintDraftStore.js';
export { subscribeWorkbookImport as subscribePeyaImport } from './workbookImportEvents.js';
export async function importPeyaReport(report) {
  return prepareComplaintDraft(report.complaints, { source: 'peya', report });
}
