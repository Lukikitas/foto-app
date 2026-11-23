import { useEffect } from 'react';
import { enqueue, restorePersistedQueue } from '../lib/uploadQueue';
import { recoverCompletedCaptureDrafts } from '../lib/captureDraftStore.js';
import { APP_VERSION } from '../lib/version';
import UpdatePrompt from './UpdatePrompt';

export default function TemporaryClosure() {
  useEffect(() => {
    void restorePersistedQueue()
      .then(() => recoverCompletedCaptureDrafts(enqueue))
      // A failed restore leaves the stored records intact for the next opening.
      .catch(() => {});
  }, []);
  return (
    <div className="temporary-closure">
      <UpdatePrompt />
      <main className="temporary-closure__main" aria-labelledby="closure-title">
        <p className="temporary-closure__brand">DELIVERY STAR</p>
        <h1 id="closure-title">La app se encuentra momentáneamente cerrada</h1>
        <p className="temporary-closure__thanks">Gracias por haberla usado y por ayudarnos en su desarrollo. Cada prueba y cada aporte nos ayudaron a mejorarla.</p>
      </main>
      <footer className="temporary-closure__footer">Delivery Star · v{APP_VERSION}</footer>
    </div>
  );
}
