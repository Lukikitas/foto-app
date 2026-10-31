import { useEffect, useState } from 'react';
import { enqueue, restorePersistedQueue } from '../lib/uploadQueue';
import { recoverCompletedCaptureDrafts } from '../lib/captureDraftStore.js';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { APP_VERSION } from '../lib/version';
import ConfirmationHost from './ConfirmationHost';
import UpdatePrompt from './UpdatePrompt';
import UploadQueueStatus from './UploadQueueStatus';

export default function TemporaryClosure() {
  const [showQueue, setShowQueue] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState('');
  const items = useUploadQueue();
  useEffect(() => {
    let active = true;
    void restorePersistedQueue()
      .then(() => recoverCompletedCaptureDrafts(enqueue))
      .catch(() => { if (active) setError('No se pudieron leer todos los pendientes. Conservá los datos de este navegador y volvé a intentarlo.'); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);
  return (
    <div className="temporary-closure">
      <ConfirmationHost />
      <UpdatePrompt />
      <main className="temporary-closure__main" aria-labelledby="closure-title">
        <p className="temporary-closure__brand">DELIVERY STAR</p>
        <h1 id="closure-title">La app se encuentra momentáneamente cerrada</h1>
        <p className="temporary-closure__thanks">Gracias por haberla usado y por ayudarnos en su desarrollo. Cada prueba y cada aporte nos ayudaron a mejorarla.</p>
        <p className="temporary-closure__hint">Las fotos y los envíos pendientes se conservan. Podés consultar su estado desde acá.</p>
        <button className="btn btn--ghost" type="button" aria-expanded={showQueue} aria-controls="closure-pending" onClick={() => setShowQueue(value => !value)}>
          {showQueue ? 'Ocultar envíos pendientes' : 'Ver envíos pendientes'}
        </button>
        {error && <p role="alert">{error}</p>}
        {showQueue && <section id="closure-pending" className="temporary-closure__queue" aria-label="Envíos pendientes guardados">
          {restoring ? <p role="status">Comprobando pendientes…</p> : items.length ? <UploadQueueStatus /> : <p>No hay envíos pendientes en este navegador.</p>}
        </section>}
      </main>
      <footer className="temporary-closure__footer">Delivery Star · v{APP_VERSION}</footer>
    </div>
  );
}
