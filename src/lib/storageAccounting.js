import { isPhotoCleanupCandidate, safePhotoCleanupCandidates, retentionCutoffIso } from './photoRetention.js';
export function storageSelection(photos, refs, days, now = new Date()) {
  const rows = [...new Map(photos.map(photo => [photo.id, photo])).values()];
  const cutoffIso = retentionCutoffIso(days, now);
  const present = rows.filter(photo=>photo.public_url);
  const protectedPaths = [...new Set(present.filter(photo=>!isPhotoCleanupCandidate(photo,{refs})).map(photo=>photo.file_path))];
  const protectedSet = new Set(protectedPaths);
  return {
    protectedPaths,
    eligiblePaths: [...new Set(safePhotoCleanupCandidates(present,{refs,cutoffIso}).filter(photo=>!protectedSet.has(photo.file_path)).map(photo=>photo.file_path))],
    recordsWithoutImage: rows.filter(photo=>!photo.public_url).length,
    retainedRecords: present.length,
  };
}
export function formatBytes(bytes) {
  const value=Number(bytes); if(!Number.isFinite(value)||value<0)return 'No disponible';
  if(value===0)return '0 B'; const unit=Math.min(3,Math.floor(Math.log(value)/Math.log(1024)));
  return `${(value/1024**unit).toLocaleString('es-AR',{maximumFractionDigits:2})} ${['B','KB','MB','GB'][unit]}`;
}
