import { dismissUpload, retryUpload } from '../lib/uploadQueue';
import { useUploadQueue } from '../hooks/useUploadQueue';

const STATUS_LABEL = {
  pending: 'En cola',
  uploading: 'Subiendo…',
  done: 'Guardado',
  error: 'Error',
};

export default function UploadQueueStatus() {
  const items = useUploadQueue();

  if (items.length === 0) return null;

  const activeCount = items.filter(
    (item) => item.status === 'pending' || item.status === 'uploading'
  ).length;

  return (
    <section className="upload-queue" aria-live="polite">
      <div className="upload-queue__header">
        <strong>Guardado en segundo plano</strong>
        {activeCount > 0 && (
          <span className="upload-queue__badge">{activeCount} activa{activeCount !== 1 ? 's' : ''}</span>
        )}
      </div>

      <ul className="upload-queue__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`upload-queue__item upload-queue__item--${item.status}`}
          >
            <span className="upload-queue__order">#{item.orderDigits}</span>
            <span className="upload-queue__status">{STATUS_LABEL[item.status]}</span>
            {item.error && (
              <span className="upload-queue__error">{item.error}</span>
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
                  onClick={() => dismissUpload(item.id)}
                >
                  Cerrar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
