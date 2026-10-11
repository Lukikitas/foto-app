import Dialog from './Dialog';
import { useEffect, useId, useRef, useState } from 'react';
import { argentinaToday } from '../lib/metrics.js';
import { previewPhotoCleanup, removePhotoFiles } from '../lib/photoCleanupStore.js';

export default function PhotoCleanupModal({ onClose, onCompleted }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const [dateTo, setDateTo] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!busy) dialogRef.current?.querySelector('button.btn--danger:not(:disabled), input:not(:disabled), button:not(:disabled)')?.focus();
  }, [preview, result, busy]);

  async function calculate(event) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setResult(null);
    try {
      setPreview(await previewPhotoCleanup({ dateTo }));
    } catch (failure) {
      setError(failure.message || 'No se pudo calcular la cantidad. No se borró ninguna foto.');
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function confirm() {
    if (busyRef.current || !preview?.photos.length) return;
    busyRef.current = true;
    setBusy(true); setError('');
    try {
      const next = await removePhotoFiles(preview, setProgress);
      setResult(next); setPreview(null);
      onCompleted?.(next);
    } catch (failure) {
      setError(failure.message || 'No se pudo completar la limpieza.');
    } finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <Dialog labelledBy={titleId} onClose={onClose} busy={busy}>
      <div ref={dialogRef} className="release-modal__dialog photo-retention-modal">
        <header className="photo-retention-modal__header"><h3 id={titleId}>Borrar fotos antiguas</h3></header>
        <div className="retention-confirm__body">
          <p>Se borran solo las imágenes. Los pedidos y sus métricas se conservan.
            Las fotos con reclamos, refutadas, evidencias y pedidos sin código quedan protegidas.</p>
          {!preview && !result && <form onSubmit={calculate} className="photo-cleanup-form">
            <label htmlFor={`${titleId}-date`}>Borrar fotos hasta esta fecha</label>
            <div className="photo-cleanup-form__controls">
              <input id={`${titleId}-date`} type="date" max={argentinaToday()} required value={dateTo}
                aria-describedby={`${titleId}-date-help`}
                disabled={busy} onChange={event => setDateTo(event.target.value)} />
              <button className="btn btn--primary btn--small" disabled={busy}>
                {busy ? 'Calculando…' : 'Ver cantidad'}
              </button>
            </div>
            <p id={`${titleId}-date-help`}><strong>La fecha seleccionada está incluida.</strong>
              {' '}Se borrarán las fotos de ese día y de todos los días anteriores, según la hora de Argentina.</p>
            <p>Esta fecha se usa solo para esta limpieza; no cambia el ajuste automático.
              Se revisa toda la galería de pedidos, independientemente de los filtros o la página.</p>
          </form>}
          {preview && <>
            <p role="status"><strong>Se borrarán {preview.photos.length.toLocaleString('es-AR')} fotos</strong>
              {' '}de pedidos del {preview.dateTo.split('-').reverse().join('/')} y de fechas anteriores
              {' '}(fecha seleccionada incluida).</p>
            <p>Las imágenes se eliminan de forma permanente. Los pedidos seguirán visibles con «Foto eliminada».</p>
            {preview.photos.length === 0 && <p>No hay fotos elegibles hasta esa fecha inclusive.</p>}
          </>}
          {busy && progress && <p role="status">Procesadas {progress.processed} de {progress.total} fotos…</p>}
          {result && <div role="status">
            <p>{result.removed.toLocaleString('es-AR')} fotos borradas. Las métricas se conservan.</p>
            {result.skipped > 0 && <p>{result.skipped} fotos omitidas porque cambiaron o quedaron protegidas.</p>}
            {(result.failed > 0 || result.pending > 0) && <p className="message message--error">
              {result.failed} fotos con errores; {result.pending} pendientes. Podés volver a calcular y reintentar.
              {' '}{result.errors[0] || ''}
            </p>}
          </div>}
          {error && <p className="message message--error" role="alert">{error}</p>}
        </div>
        <footer className="retention-confirm__actions">
          <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={onClose}>
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {(preview || result) && <button type="button" className="btn btn--ghost btn--small" disabled={busy}
            onClick={() => { setPreview(null); setResult(null); setProgress(null); setError(''); }}>
            Cambiar fecha
          </button>}
          {preview?.photos.length > 0 && <button type="button" className="btn btn--danger btn--small"
            disabled={busy} onClick={confirm}>
            {busy ? 'Borrando…' : `Confirmar borrado de ${preview.photos.length.toLocaleString('es-AR')} fotos`}
          </button>}
        </footer>
      </div>
    </Dialog>
  );
}
