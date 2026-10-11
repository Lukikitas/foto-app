import { safePhotoCleanupCandidates } from './photoRetention.js';

// Exclusive start of the following day includes the selected day's entire
// timestamp range, including Postgres microseconds, in Argentina (UTC-3).
export function cleanupDateCutoffIso(dateTo) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo || ''))) {
    throw new Error('Elegí una fecha válida desde el calendario.');
  }
  const day = new Date(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== dateTo) {
    throw new Error('Elegí una fecha válida desde el calendario.');
  }
  return new Date(new Date(`${dateTo}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export function cleanupCandidates(photos, { cutoffIso = null, refs = null } = {}) {
  return safePhotoCleanupCandidates(photos,{cutoffIso,refs});
}

// Execute only the objects explicitly previewed, after checking current state.
// Storage removal and the metadata update are retryable; never delete a row.
export async function executePhotoCleanup(preview, adapter, onProgress = () => {}) {
  const result = { removed: 0, skipped: 0, failed: 0, updated: [], errors: [] };
  const unique = [...new Map(preview.photos.map(photo => [photo.id, photo])).values()];
  for (let start = 0; start < unique.length; start += 100) {
    const approved = unique.slice(start, start + 100);
    let skipped = 0;
    try {
      const refs = await adapter.loadRefs();
      const current = await adapter.loadPhotos(approved.map(photo => photo.id));
      const related = adapter.loadRelated ? await adapter.loadRelated(current.map(photo=>photo.file_path)) : current;
      const originals = new Map(approved.map(photo => [photo.id, photo]));
      const eligible = cleanupCandidates(related, { cutoffIso: preview.cutoffIso, refs })
        .filter(photo => {
          const original = originals.get(photo.id);
          return original?.file_path === photo.file_path && original.public_url === photo.public_url;
        });
      skipped = approved.length - eligible.length;
      result.skipped += skipped;
      if (eligible.length) {
        await adapter.removeFiles([...new Set(eligible.map(photo => photo.file_path))]);
        const updated = await adapter.clearUrls(eligible);
        result.removed += updated.length;
        result.failed += eligible.length - updated.length;
        result.updated.push(...updated);
      }
    } catch (error) {
      result.failed += approved.length - skipped;
      result.errors.push(error.message || 'No se pudo completar un lote.');
      // A read failure must stop processing, never assume absent protections.
      break;
    }
    onProgress({ ...result, processed: start + approved.length, total: unique.length });
  }
  result.pending = unique.length - result.removed - result.skipped - result.failed;
  return result;
}
