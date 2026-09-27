import { prepareComplaintDraft } from './complaintDraftStore.js';
export async function importRappiReport(report) {
  return prepareComplaintDraft(report.complaints, { source: 'rappi', report });
}
