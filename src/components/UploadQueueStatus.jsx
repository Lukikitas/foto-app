import { useState } from 'react';
import { dismissUpload, restorePersistedQueue, retryUpload } from '../lib/uploadQueue';
import { useUploadQueue } from '../hooks/useUploadQueue';

const STATUS_LABEL = {
  saving_local: 'Guardando en este dispositivo…',
  pending: 'En cola',
  analyzing: 'Leyendo el código…',
  uploading: 'Subiendo…',
  done: 'Guardado',
  error: 'Error',
};

export default function UploadQueueStatus() {
  const items = useUploadQueue();
  const [confirmDismissId, setConfirmDismissId] = useState(null);
  const [reloadingStore, setReloadingStore] = useState(false);

  const storeError = items.storeError;

  if (items.length === 0 && !storeError) return null;

  const activeCount = items.filter(
    (item) => item.status === 'saving_local' || item.status === 'pending' || item.status === 'analyzing' || item.status === 'uploading'
  ).length;

  async function handleRetryStore() {
    setReloadingStore(true);
    try {
      await restorePersistedQueue();
    } finally {
      setReloadingStore(false);
    }
  }

  return (
    <section className="upload-queue" aria-live="polite">
      {storeError && (
        <div className="uploader__message message message--error upload-queue__store-error" style={{ marginBottom: '0.8rem' }}>
          <span>⚠️ {storeError}</span>
          <button
            type="button"
            className="btn btn--small btn--primary"
            onClick={handleRetryStore}
            disabled={reloadingStore}
            style={{ marginLeft: '0.5rem' }}
          >
            {reloadingStore ? 'Reintentando…' : 'Reintentar lectura'}
          </button>
        </div>
      )}

      <div className="upload-queue__header">
        <strong>Guardado en segundo plano</strong>
        {activeCount > 0 && (
          <span className="upload-queue__badge">{activeCount} activa{activeCount !== 1 ? 's' : ''}</span>
        )}
      </div>
      {activeCount > 0 && (
        <p className="upload-queue__hint">Podés cambiar de app; la cola sigue subiendo.</p>
      )}

      <ul className="upload-queue__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`upload-queue__item upload-queue__item--${item.status}`}
          >
            <span className="upload-queue__order">{item.label}</span>
            <span className="upload-queue__status">{STATUS_LABEL[item.status] || item.status}</span>
            {item.error && (
              <span className="upload-queue__error">{item.error}</span>
            )}

            {confirmDismissId === item.id ? (
              <div className="upload-queue__confirm-dismiss" style={{ marginTop: '0.5rem', background: '#ffebee', padding: '0.5rem', borderRadius: '4px' }}>
                <p style={{ margin: '0 0 0.4rem 0', color: '#c62828', fontSize: '0.85em' }}>
                  Esta foto aún no se subió al servidor. Si la cerrás ahora, se eliminará la única copia local de este dispositivo.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn--small btn--danger"
                    onClick={() => {
                      dismissUpload(item.id);
                      setConfirmDismissId(null);
                    }}
                  >
                    Confirmar descarte
                  </button>
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => setConfirmDismissId(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
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
                {item.status === 'error' && (
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => setConfirmDismissId(item.id)}
                  >
                    Cerrar
                  </button>
                )}
                {item.status === 'done' && (
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => dismissUpload(item.id)}
                  >
                    Cerrar
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
