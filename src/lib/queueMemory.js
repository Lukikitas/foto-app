/** Lightweight queue entries never retain a persisted capture's binary files. */
export function queueRecordSummary(record) {
  const {file,ticket,...metadata}=record;
  return {...metadata,hasFile:Boolean(file || record.hasFile),hasTicket:Boolean(ticket || record.hasTicket),fileSize:file?.size ?? record.fileSize ?? 0,ticketSize:ticket?.size ?? record.ticketSize ?? 0};
}
export function releaseQueueFiles(item) {
  if (!item.persisted || item.localSaveFailed || item.initialPersistPending) return false;
  item.fileName=item.file?.name || item.fileName;
  item.fileType=item.file?.type || item.fileType;
  item.ticketName=item.ticketFile?.name || item.ticketName;
  item.ticketType=item.ticketFile?.type || item.ticketType;
  item.hasFile=Boolean(item.file || item.hasFile);
  item.hasTicket=Boolean(item.ticketFile || item.hasTicket);
  item.fileSize=item.file?.size ?? item.fileSize ?? 0;
  item.ticketSize=item.ticketFile?.size ?? item.ticketSize ?? 0;
  item.file=null;item.ticketFile=null;item.filesUnloaded=true;
  return true;
}
export function mergeQueueStateWithStoredFiles(item,stored,state) {
  if (!item.filesUnloaded) return state;
  if (!stored?.file) throw new Error('No se encontró la foto guardada. El pendiente se conserva para revisar.');
  return {...state,file:stored.file,ticket:stored.ticket,fileName:stored.fileName,fileType:stored.fileType,ticketName:stored.ticketName,ticketType:stored.ticketType};
}
