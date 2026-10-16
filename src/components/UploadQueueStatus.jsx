import { dismissUpload, retryUpload, retryAllFailedUploads } from '../lib/uploadQueue';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { confirmAction } from '../lib/confirmAction';
import { IMAGE_READ_ERROR } from '../lib/readImage';

const STATUS_LABEL = {
  pending: 'En cola',
  analyzing: 'Leyendo el código…',
  preparing: 'Preparando foto…',
  uploading: 'Subiendo…',
  done: 'Guardado',
  error: 'Error',
};

export default function UploadQueueStatus() {
  const items = useUploadQueue();

  if (items.length === 0) return null;

  const activeCount = items.filter(
    (item) => item.status === 'pending' || item.status === 'analyzing' || item.status === 'preparing' || item.status === 'uploading'
  ).length;

  const failedCount = items.filter(item => item.status === 'error').length;

  return (
    <section className="upload-queue" aria-live="polite">
      <div className="upload-queue__header">
        <strong>Guardado en segundo plano</strong>
        {activeCount > 0 && (
          <span className="upload-queue__badge">{activeCount} activa{activeCount !== 1 ? 's' : ''}</span>
        )}
      </div>
      {activeCount > 0 && (
        <p className="upload-queue__hint">Podés cambiar de app; la cola sigue subiendo.</p>
      )}

      {failedCount > 0 && <div className="upload-queue__hint"><p>{failedCount} foto{failedCount === 1 ? '' : 's'} con error. Reintentá con la app abierta; los pendientes se conservan hasta confirmar la subida.</p><button type="button" className="btn btn--small btn--ghost" onClick={retryAllFailedUploads}>Reintentar todas ({failedCount})</button></div>}
      <ul className="upload-queue__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`upload-queue__item upload-queue__item--${item.status}`}
          >
            <span className="upload-queue__order">{item.label}</span>
            <span className="upload-queue__status">{STATUS_LABEL[item.status]}</span>
            {item.error && (
              <span className="upload-queue__error">{item.error.includes('createImageBitmap') ? IMAGE_READ_ERROR : item.error}</span>
            )}
            <div className="upload-queue__actions">
              {item.status === 'error' && (
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => retryUpload(item.id)}
                >
                  Reintentar
                </button>
              )}
              {(item.status === 'done' || item.status === 'error') && (
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={async () => {
                    if (item.status === 'error' && !await confirmAction('Esta foto todavía no se subió. Descartar elimina este pendiente del dispositivo y puede perderse la captura.', {title:'¿Descartar la foto pendiente?',confirmLabel:'Descartar pendiente'})) return;
                    dismissUpload(item.id);
                  }}
                >
                  {item.status === 'error' ? 'Descartar pendiente' : 'Cerrar'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
