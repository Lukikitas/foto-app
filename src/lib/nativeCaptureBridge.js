import { supabase, supabaseAnonKey, supabaseUrl } from './supabase.js';
import {
  clearStoredNativeSession,
  fetchNativeSessionPairs,
  markNativePairsAsImported,
  hashTokenSha256,
} from './nativeCameraSession.js';

const NATIVE_BUCKET = 'native-captures';

export async function downloadStorageAsFile(
  bucket,
  storagePath,
  fileName,
  mimeType = 'image/jpeg',
  credentials = null,
) {
  let blob;

  if (bucket === NATIVE_BUCKET && credentials?.sessionId && credentials?.sessionToken) {
    const tokenHash = await hashTokenSha256(credentials.sessionToken);
    const response = await fetch(`${supabaseUrl}/functions/v1/native-camera-transfer`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        'x-session-id': credentials.sessionId,
        'x-token-hash': tokenHash,
        'x-storage-path': storagePath,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `No se pudo descargar el archivo ${storagePath}`);
    }
    blob = await response.blob();
  } else {
    const result = await supabase.storage.from(bucket).download(storagePath);
    if (result.error || !result.data) {
      throw new Error(result.error?.message || `No se pudo descargar el archivo ${storagePath}`);
    }
    blob = result.data;
  }

  return new File([blob], fileName, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

export async function processNativeSessionReturn(sessionRecord, options = {}) {
  const { sessionId, sessionToken, takenBy } = sessionRecord;
  const onProgress = options.onProgress;
  const downloadFn = options.downloadFn || downloadStorageAsFile;
  const enqueueFn = options.enqueueFn || (await import('./uploadQueue.js')).enqueue;
  const fetchPairsFn = options.fetchPairsFn || fetchNativeSessionPairs;
  const markImportedFn = options.markImportedFn || markNativePairsAsImported;
  const clearSessionFn = options.clearSessionFn || clearStoredNativeSession;

  const sessionData = await fetchPairsFn(sessionId, sessionToken);
  const pairs = sessionData.pairs || [];
  const pendingToImport = pairs.filter((p) => p.state === 'uploaded');

  const importedIds = [];
  const errors = [];

  for (let i = 0; i < pendingToImport.length; i++) {
    const pair = pendingToImport[i];
    try {
      const ticketFile = await downloadFn(
        NATIVE_BUCKET,
        pair.ticketPath,
        `ticket-${pair.pairNumber}.jpg`,
        'image/jpeg',
        { sessionId, sessionToken },
      );
      const evidenceFile = await downloadFn(
        NATIVE_BUCKET,
        pair.evidencePath,
        `evidencia-${pair.pairNumber}.jpg`,
        'image/jpeg',
        { sessionId, sessionToken },
      );

      await enqueueFn({
        file: evidenceFile,
        ticketFile,
        kind: 'order',
        meta: {
          taken_by: takenBy || sessionData.takenBy,
          notes: pair.metadata?.notes || '',
          is_refutado: Boolean(pair.metadata?.is_refutado),
          has_complaint: false,
        },
      });

      await markImportedFn(sessionId, sessionToken, [pair.id]);
      importedIds.push(pair.id);

      onProgress?.({
        processed: i + 1,
        total: pendingToImport.length,
        currentPair: pair,
      });
    } catch (err) {
      errors.push({ pairNumber: pair.pairNumber, error: err.message });
    }
  }

  // Check if session has finished and all pairs are imported
  const updatedStatus = await fetchPairsFn(sessionId, sessionToken);
  const remainingNotImported = (updatedStatus.pairs || []).filter((p) => p.state !== 'imported');

  if (updatedStatus.state === 'completed') {
    clearSessionFn();
  }

  return {
    sessionId,
    totalPairs: pairs.length,
    importedCount: importedIds.length,
    remainingCount: remainingNotImported.length,
    sessionState: updatedStatus.state,
    errors,
  };
}
