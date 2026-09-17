import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_MS = 60 * 1000;

function checkForUpdate(registration) {
  if (!registration || !navigator.onLine) return;
  registration.update().catch(() => {});
}

export default function UpdatePrompt() {
  const registrationRef = useRef(null);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration || null;
      checkForUpdate(registration);
    },
  });

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

  if (!needRefresh) return null;

  return (
    <div className="install-banner" role="status" aria-live="polite" aria-label="Actualización disponible">
      <div>
        <strong>Actualización disponible</strong>
        <p>Hay una versión nueva de la app. Actualizá para usar los últimos cambios.</p>
      </div>
      <div className="install-banner__actions">
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={() => updateServiceWorker(true)}
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}
