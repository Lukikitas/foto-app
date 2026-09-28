import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearStoredNativeSession,
  getStoredNativeSession,
} from '../lib/nativeCameraSession';
import { processNativeSessionReturn } from '../lib/nativeCaptureBridge';

const STEP_LABELS = {
  downloading_ticket: 'Descargando ticket…',
  downloading_evidence: 'Descargando evidencia…',
  saving_local: 'Guardando en este dispositivo (IndexedDB)…',
  confirming_rpc: 'Confirmando recepción en servidor…',
  verifying_photo: 'Verificando foto definitiva…',
};

export default function NativeCameraReturnNotice({ onDone }) {
  const [session, setSession] = useState(getStoredNativeSession);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [errors, setErrors] = useState([]);
  const [manualRetrying, setManualRetrying] = useState(false);

  const mountedRef = useRef(true);
  const timerRef = useRef(null);
  const checkAndImportRef = useRef(null);

  const checkAndImport = useCallback(async (isManual = false) => {
    const active = getStoredNativeSession();
    if (!active || !mountedRef.current) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setImporting(true);
    if (isManual) setManualRetrying(true);

    try {
      const result = await processNativeSessionReturn(active, {
        onProgress: (p) => {
          if (mountedRef.current) setProgress(p);
        },
      });

      if (mountedRef.current) {
        setSummary(result);
        if (result.errors && result.errors.length > 0) {
          setErrors(result.errors);
        } else {
          setErrors([]);
        }

        // If not all pairs are verified or session is not complete, schedule next check
        if (!result.allReady) {
          const hasPermanentErrors = result.errors.some((e) => e.isPermanent);
          // Only poll automatically if there are no permanent blocking errors
          if (!hasPermanentErrors) {
            timerRef.current = setTimeout(() => checkAndImportRef.current?.(false), 5000);
          }
        } else {
          onDone?.();
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setErrors([
          {
            pairNumber: '?',
            step: 'general',
            error: err.message || 'Error al recuperar fotos de la cámara.',
            isPermanent: false,
          },
        ]);
        timerRef.current = setTimeout(() => checkAndImportRef.current?.(false), 7000);
      }
    } finally {
      if (mountedRef.current) {
        setImporting(false);
        setManualRetrying(false);
      }
    }
  }, [onDone]);

  useEffect(() => {
    mountedRef.current = true;
    checkAndImportRef.current = checkAndImport;
    const startupTimer = setTimeout(() => checkAndImportRef.current?.(false), 0);

    return () => {
      mountedRef.current = false;
      clearTimeout(startupTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [checkAndImport]);

  if (!session && !summary) return null;

  function dismiss() {
    clearStoredNativeSession();
    setSession(null);
    setSummary(null);
  }

  const hasErrors = errors.length > 0;
  const currentStepLabel = progress?.step ? (STEP_LABELS[progress.step] || progress.step) : '';

  return (
    <div
      className={`uploader__message message ${hasErrors ? 'message--error' : 'message--info'} native-return-notice`}
      role="status"
    >
      <div className="native-return-notice__content">
        <span aria-hidden="true">{hasErrors ? '⚠️' : '📱'}</span>
        <div>
          <strong>Cámara Android:</strong>{' '}
          {importing && (
            <span>
              Importando par #{progress?.pairNumber || '…'} · {currentStepLabel}{' '}
              {progress ? `(${progress.processed}/${progress.total})` : ''}
            </span>
          )}
          {!importing && summary && (
            <span>
              {summary.totalPairs} pares tomados · {summary.importedCount} incorporados a la cola
              {summary.availableCount > 0 && ` · ${summary.availableCount} disponibles para incorporar`}
              {summary.allReady
                ? ' · Todos listos y verificados en fotos.'
                : summary.availableCount === 0 && summary.sessionState !== 'completed'
                  ? ' · Esperando nuevas capturas del teléfono…'
                  : ''}
            </span>
          )}
          {hasErrors && (
            <div className="native-return-notice__errors" style={{ marginTop: '0.4rem', fontSize: '0.9em' }}>
              {errors.map((err, idx) => (
                <div key={idx} className="native-return-error-item">
                  <strong>Par #{err.pairNumber}</strong> ({err.step}): {err.error}
                  {err.isPermanent && <span style={{ color: '#d32f2f' }}> [Error permanente]</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="native-return-notice__actions" style={{ display: 'flex', gap: '0.5rem' }}>
        {hasErrors && (
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={() => checkAndImport(true)}
            disabled={importing || manualRetrying}
          >
            {manualRetrying ? 'Reintentando…' : 'Reintentar'}
          </button>
        )}
        <button type="button" className="btn btn--small btn--ghost" onClick={dismiss}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
