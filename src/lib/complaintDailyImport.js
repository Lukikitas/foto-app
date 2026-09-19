import { fetchComplaintSheetText, parseComplaintSheet } from './complaintSheet.js';
import {
  argentinaDateTimeParts,
  dailyImportDecision,
  msUntilDailyImportCutoff,
} from './complaintSync.js';
import { loadComplaintSync, mutateComplaintSync } from './complaintSyncStore.js';
import { fetchPhotosForComplaints, matchComplaintsToPhotos, saveComplaintBatch } from './complaints.js';
import { importComplaintsToHistory, loadComplaintHistory } from './complaintHistoryStore.js';

const listeners = new Set();
let dailyImportPromise = null;
let lastDailyImportResult = null;

export function subscribeDailyImport(listener) {
  listeners.add(listener);
  if (lastDailyImportResult) {
    try {
      listener({ ...lastDailyImportResult, replay: true });
    } catch {
      // un subscriber no debe frenar el cruce
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

function emitDailyImport(result) {
  lastDailyImportResult = result;
  listeners.forEach((listener) => {
    try {
      listener(result);
    } catch {
      // un subscriber no debe frenar el cruce
    }
  });
  return result;
}

export async function cruzarSheetUrl(url) {
  const text = await fetchComplaintSheetText(url);
  const parsed = parseComplaintSheet(text);
  if (parsed.complaints.length === 0) {
    throw new Error('No encontré códigos de pedido en el Sheet.');
  }
  const photos = await fetchPhotosForComplaints(parsed.complaints);
  const matched = matchComplaintsToPhotos(parsed.complaints, photos);
  const result = await importComplaintsToHistory(parsed.complaints, matched);
  return {
    ...result,
    complaints: parsed.complaints,
    skipped: parsed.skipped,
    matched,
  };
}

export async function maybeRunDailyImport(now = new Date()) {
  if (dailyImportPromise) {
    try {
      await dailyImportPromise;
    } catch {
      // reintentamos con el link y el horario actuales
    }
    return maybeRunDailyImport();
  }

  dailyImportPromise = (async () => {
    const sync = await loadComplaintSync({ force: true });
    try {
      const status = dailyImportDecision(sync, now);
      if (status !== 'run') {
        if (status === 'already_done') {
          await loadComplaintHistory({ force: true });
        }
        return emitDailyImport({ status, sync });
      }

      const cruzar = await cruzarSheetUrl(sync.sheetUrl);
      saveComplaintBatch(cruzar.complaints, {});
      const saved = await mutateComplaintSync((current) => ({
        ...current,
        sheetUrl: current.sheetUrl || sync.sheetUrl,
        lastImportAt: new Date().toISOString(),
        lastImportDay: argentinaDateTimeParts(now).date,
      }));
      return emitDailyImport({
        status: 'imported',
        sync: saved,
        added: cruzar.added,
        updated: cruzar.updated,
        complaints: cruzar.complaints,
        skipped: cruzar.skipped,
      });
    } catch (error) {
      emitDailyImport({
        status: 'error',
        error: error?.message || 'No se pudo cruzar el Sheet automáticamente.',
        sync,
      });
      throw error;
    }
  })().finally(() => {
    dailyImportPromise = null;
  });

  return dailyImportPromise;
}

export function startDailyImportScheduler() {
  let cancelled = false;
  let timer;

  async function run() {
    if (cancelled) return;
    window.clearTimeout(timer);
    try {
      await maybeRunDailyImport();
    } catch {
      // se reintenta al volver a la app o cuando llegue el horario
    }
    if (cancelled) return;
    const wait = msUntilDailyImportCutoff();
    if (wait > 0) {
      timer = window.setTimeout(run, Math.min(wait + 1000, 2_147_000_000));
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible') run();
  }

  run();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', run);

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', run);
  };
}
