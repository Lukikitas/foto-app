import { supabase, supabaseAnonKey, supabaseUrl } from './supabase.js';
import {
  clearStoredNativeSession,
  fetchNativeSessionPairs,
  markNativePairsAsImported,
  hashTokenSha256,
} from './nativeCameraSession.js';

const NATIVE_BUCKET = 'native-captures';

export function isTransientError(error) {
  if (!error) return false;
  const message = (error.message || String(error)).toLowerCase();
  const status = error.status || error.statusCode;

  // HTTP status codes
  if (status) {
    if (status === 401 || status === 403 || status === 404 || status === 410) {
      return false; // Permanent auth, missing file, or expired session
    }
    if (status >= 500 && status <= 599) return true; // Server errors are transient
    if (status === 408 || status === 429) return true; // Timeout / rate limit
  }

  // Network messages
  if (
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('aborterror') ||
    message.includes('connection')
  ) {
    return true;
  }

  return false;
}

export function classifyStepError(err, step, pairNumber) {
  const transient = isTransientError(err);
  let friendlyReason = err.message || 'Error desconocido';

  if (err.status === 410 || friendlyReason.includes('expiró')) {
    friendlyReason = 'La sesión expiró. El plazo de recuperación ha vencido.';
  } else if (err.status === 401 || err.status === 403) {
    friendlyReason = 'Credencial de sesión no autorizada o manipulada.';
  } else if (err.status === 404) {
    friendlyReason = `Archivo no encontrado en el depósito temporal para el par #${pairNumber}.`;
  } else if (step === 'saving_local') {
    friendlyReason = `Fallo al persistir en IndexedDB del dispositivo: ${friendlyReason}`;
  } else if (step === 'confirming_rpc') {
    friendlyReason = `Fallo al confirmar importación en servidor: ${friendlyReason}`;
  }

  return {
    pairNumber,
    step,
    error: friendlyReason,
    originalMessage: err.message,
    status: err.status || null,
    isTransient: transient,
    isPermanent: !transient,
  };
}

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
    let response;
    try {
      response = await fetch(`${supabaseUrl}/functions/v1/native-camera-transfer`, {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          'x-session-id': credentials.sessionId,
          'x-token-hash': tokenHash,
          'x-storage-path': storagePath,
        },
      });
    } catch (netErr) {
      netErr.isNetworkError = true;
      throw netErr;
    }

    if (!response.ok) {
      const detail = await response.text();
      const err = new Error(detail || `No se pudo descargar el archivo ${storagePath} (HTTP ${response.status})`);
      err.status = response.status;
      throw err;
    }
    blob = await response.blob();
  } else {
    const result = await supabase.storage.from(bucket).download(storagePath);
    if (result.error || !result.data) {
      const err = new Error(result.error?.message || `No se pudo descargar el archivo ${storagePath}`);
      err.status = result.error?.status || 500;
      throw err;
    }
    blob = result.data;
  }

  return new File([blob], fileName, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

export async function verifySessionPhotosInDatabase(sessionId, pairIds = []) {
  if (!sessionId) return { verifiedCount: 0, verifiedAll: false };

  try {
    // Check photos with file_path or metadata referencing sessionId
    const { data, error } = await supabase
      .from('photos')
      .select('id, file_path, notes, created_at')
      .or(`file_path.ilike.%${sessionId}%,notes.ilike.%${sessionId}%`);

    if (error || !data) return { verifiedCount: 0, verifiedAll: false };

    const count = data.length;
    return {
      verifiedCount: count,
      verifiedAll: pairIds.length > 0 ? count >= pairIds.length : false,
      photos: data,
    };
  } catch {
    return { verifiedCount: 0, verifiedAll: false };
  }
}

export async function processNativeSessionReturn(sessionRecord, options = {}) {
  const { sessionId, sessionToken, takenBy } = sessionRecord;
  const onProgress = options.onProgress;
  const downloadFn = options.downloadFn || downloadStorageAsFile;
  const enqueueFn = options.enqueueFn || (await import('./uploadQueue.js')).enqueue;
  const fetchPairsFn = options.fetchPairsFn || fetchNativeSessionPairs;
  const markImportedFn = options.markImportedFn || markNativePairsAsImported;
  const clearSessionFn = options.clearSessionFn || clearStoredNativeSession;
  const verifyPhotosFn = options.verifyPhotosFn || verifySessionPhotosInDatabase;
  const maxAutomaticRetries = options.maxAutomaticRetries ?? 2;

  const sessionData = await fetchPairsFn(sessionId, sessionToken);
  const pairs = sessionData.pairs || [];
  const pendingToImport = pairs.filter((p) => p.state === 'uploaded');

  const importedIds = [];
  const detailedErrors = [];

  for (let i = 0; i < pendingToImport.length; i++) {
    const pair = pendingToImport[i];
    let attempt = 0;
    let importedSuccessfully = false;

    while (attempt <= maxAutomaticRetries && !importedSuccessfully) {
      attempt++;
      let currentStep = 'starting';

      try {
        currentStep = 'downloading_ticket';
        onProgress?.({
          processed: i,
          total: pendingToImport.length,
          pairNumber: pair.pairNumber,
          step: currentStep,
          attempt,
        });

        const ticketFile = await downloadFn(
          NATIVE_BUCKET,
          pair.ticketPath,
          `ticket-${pair.pairNumber}.jpg`,
          'image/jpeg',
          { sessionId, sessionToken },
        );

        currentStep = 'downloading_evidence';
        onProgress?.({
          processed: i,
          total: pendingToImport.length,
          pairNumber: pair.pairNumber,
          step: currentStep,
          attempt,
        });

        const evidenceFile = await downloadFn(
          NATIVE_BUCKET,
          pair.evidencePath,
          `evidencia-${pair.pairNumber}.jpg`,
          'image/jpeg',
          { sessionId, sessionToken },
        );

        currentStep = 'saving_local';
        onProgress?.({
          processed: i,
          total: pendingToImport.length,
          pairNumber: pair.pairNumber,
          step: currentStep,
          attempt,
        });

        // Use idempotent ID based on pair.id so retries never duplicate queue items or photos
        await enqueueFn({
          id: pair.id,
          file: evidenceFile,
          ticketFile,
          kind: 'order',
          meta: {
            taken_by: takenBy || sessionData.takenBy,
            notes: pair.metadata?.notes || '',
            is_refutado: Boolean(pair.metadata?.is_refutado),
            has_complaint: false,
            native_pair_id: pair.id,
            native_session_id: sessionId,
            native_pair_number: pair.pairNumber,
          },
        });

        currentStep = 'confirming_rpc';
        onProgress?.({
          processed: i,
          total: pendingToImport.length,
          pairNumber: pair.pairNumber,
          step: currentStep,
          attempt,
        });

        await markImportedFn(sessionId, sessionToken, [pair.id]);
        importedIds.push(pair.id);
        importedSuccessfully = true;

        onProgress?.({
          processed: i + 1,
          total: pendingToImport.length,
          pairNumber: pair.pairNumber,
          step: 'completed',
          currentPair: pair,
        });
      } catch (err) {
        const classified = classifyStepError(err, currentStep, pair.pairNumber);

        if (classified.isPermanent || attempt > maxAutomaticRetries) {
          detailedErrors.push(classified);
          onProgress?.({
            processed: i,
            total: pendingToImport.length,
            pairNumber: pair.pairNumber,
            step: currentStep,
            error: classified,
          });
          break; // Stop retrying on permanent error or exhausted retries
        } else {
          // Wait briefly before next transient retry
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }
  }

  // Check updated session state from server
  const updatedStatus = await fetchPairsFn(sessionId, sessionToken);
  const remainingUploaded = (updatedStatus.pairs || []).filter((p) => p.state === 'uploaded');
  const totalCount = (updatedStatus.pairs || []).length;
  const importedCount = (updatedStatus.pairs || []).filter((p) => p.state === 'imported').length;

  // Verify definitive photos in photos table before ever declaring allReady or clearing session
  const verification = await verifyPhotosFn(sessionId, (updatedStatus.pairs || []).map((p) => p.id));
  const isAllImported = totalCount > 0 && importedCount === totalCount && remainingUploaded.length === 0;
  const isSessionFinished = updatedStatus.state === 'completed';
  const allVerified = isAllImported && isSessionFinished && verification.verifiedCount >= totalCount;

  if (allVerified) {
    clearSessionFn();
  }

  return {
    sessionId,
    totalPairs: totalCount,
    importedCount,
    remainingCount: remainingUploaded.length,
    availableCount: remainingUploaded.length,
    sessionState: updatedStatus.state,
    verifiedCount: verification.verifiedCount,
    allReady: allVerified,
    errors: detailedErrors,
  };
}
