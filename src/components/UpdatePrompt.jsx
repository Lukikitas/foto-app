import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getPendingCount, subscribe } from '../lib/uploadQueue';

const CHECK_MS = 60 * 1000;

function checkForUpdate(registration) {
  if (!registration || !navigator.onLine) return;
  registration.update().catch(() => {});
}

export default function UpdatePrompt() {
  const registrationRef = useRef(null);
  const updateFnRef = useRef(null);
  const applyWhenIdleRef = useRef(false);
  const [waitingForQueue, setWaitingForQueue] = useState(false);

  function applyUpdate() {
    applyWhenIdleRef.current = false;
    setWaitingForQueue(false);
    const registration = registrationRef.current;
    const updateServiceWorker = updateFnRef.current;
    Promise.resolve()
      .then(async () => {
        try {
          registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
          await updateServiceWorker?.(true);
        } catch {
          // si el SW no responde, igual recargamos
        }
        window.setTimeout(() => {
          window.location.reload();
        }, 250);
      });
  }

  function tryApplyUpdate() {
    if (getPendingCount() > 0) {
      applyWhenIdleRef.current = true;
      setWaitingForQueue(true);
      return;
    }
    applyUpdate();
  }

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onNeedReload() {
      tryApplyUpdate();
    },
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration || null;
      checkForUpdate(registration);
    },
  });

  updateFnRef.current = updateServiceWorker;

  useEffect(() => {
    const check = () => checkForUpdate(registrationRef.current);
    const intervalId = window.setInterval(check, CHECK_MS);

    function onVisible() {
      if (document.visibilityState === 'visible') check();
    }

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', check);
    };
  }, []);

  useEffect(() => subscribe(() => {
    if (applyWhenIdleRef.current && getPendingCount() === 0) {
      applyUpdate();
    }
  }), []);

  if (!needRefresh && !waitingForQueue) return null;

  return (
    <div className="install-banner" role="status" aria-live="polite" aria-label="Actualización disponible">
      <div>
        <strong>Actualización disponible</strong>
        <p>
          {waitingForQueue
            ? 'Hay pedidos en cola. La app se actualiza cuando se terminen de leer.'
            : 'Hay una versión nueva de la app. Actualizá para usar los últimos cambios.'}
        </p>
      </div>
      <div className="install-banner__actions">
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={tryApplyUpdate}
          disabled={waitingForQueue}
        >
          {waitingForQueue ? 'Esperando la cola…' : 'Actualizar'}
        </button>
      </div>
    </div>
  );
}
