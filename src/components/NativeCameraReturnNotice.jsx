import { useEffect, useState } from 'react';
import {
  clearStoredNativeSession,
  getStoredNativeSession,
} from '../lib/nativeCameraSession';
import { processNativeSessionReturn } from '../lib/nativeCaptureBridge';

export default function NativeCameraReturnNotice({ onDone }) {
  const [session, setSession] = useState(getStoredNativeSession);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const active = getStoredNativeSession();
    if (!active) return;

    let mounted = true;
    let timer = null;

    async function checkAndImport() {
      if (!mounted) return;
      setImporting(true);
      setError(null);
      try {
        const result = await processNativeSessionReturn(active, {
          onProgress: (p) => {
            if (mounted) setProgress(p);
          },
        });
        if (mounted) {
          setSummary(result);
          if (result.sessionState !== 'completed') {
            timer = setTimeout(checkAndImport, 6000);
          } else {
            onDone?.();
          }
        }
      } catch (err) {
        if (mounted) setError(err.message || 'Error al recuperar fotos de la cámara.');
      } finally {
        if (mounted) setImporting(false);
      }
    }

    checkAndImport();

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [onDone]);

  if (!session && !summary) return null;

  function dismiss() {
    clearStoredNativeSession();
    setSession(null);
    setSummary(null);
  }

  return (
    <div className="uploader__message message message--info native-return-notice" role="status">
      <div className="native-return-notice__content">
        <span aria-hidden="true">📱</span>
        <div>
          <strong>Cámara Android:</strong>{' '}
          {importing && <span>Importando pares capturados… {progress ? `(${progress.processed}/${progress.total})` : ''}</span>}
          {!importing && summary && (
            <span>
              {summary.totalPairs} pares tomados · {summary.importedCount} incorporados a la cola
              {summary.sessionState === 'completed'
                ? ' · Todos listos.'
                : ` · ${summary.remainingCount} disponibles; esperando la sincronización del teléfono…`}
            </span>
          )}
          {error && <span className="message--error"> {error}</span>}
        </div>
      </div>
      <button type="button" className="btn btn--small btn--ghost" onClick={dismiss}>
        Cerrar
      </button>
    </div>
  );
}
