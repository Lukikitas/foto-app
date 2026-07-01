import { useEffect, useState } from 'react';

function getStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [isStandalone] = useState(getStandaloneMode);

  useEffect(() => {
    function handleBeforeInstall(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  if (isStandalone || dismissed || !deferredPrompt) return null;

  async function handleInstall() {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <div className="install-banner" role="region" aria-label="Instalar aplicación">
      <div>
        <strong>Instalá la app</strong>
        <p>Accedé más rápido desde el inicio de tu celular.</p>
      </div>
      <div className="install-banner__actions">
        <button type="button" className="btn btn--primary btn--small" onClick={handleInstall}>
          Instalar
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setDismissed(true)}
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
