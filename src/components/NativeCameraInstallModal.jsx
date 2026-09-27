import { useEffect, useState } from 'react';
import { NATIVE_PACKAGE_NAME } from '../lib/nativeCameraSession';

export default function NativeCameraInstallModal({ isOpen, onClose, onContinueWeb, onOpenIntent }) {
  const [manifest, setManifest] = useState({
    versionName: '1.0.0',
    downloadUrl: '/android-camera/fotoapp-camera-v1.0.0-debug.apk',
    releaseNotes: 'Acceso nativo al lente gran angular y captura continua de tickets y pedidos.',
  });

  useEffect(() => {
    fetch('/android-camera/latest.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setManifest((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {});
  }, []);

  if (!isOpen) return null;

  return (
    <div className="release-modal" role="dialog" aria-modal="true" aria-labelledby="native-camera-title">
      <div className="release-modal__dialog native-install-dialog">
        <div className="release-modal__head">
          <h2 id="native-camera-title">Cámara Android Especializada</h2>
          <button type="button" className="btn btn--small btn--ghost" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <p className="native-install-intro">
          Agrega acceso directo al lente <strong>gran angular físico</strong> de tu teléfono para capturar tickets y pedidos completos de cerca y sin retroceder.
        </p>

        <div className="native-install-specs">
          <div><span>Versión:</span> <strong>v{manifest.versionName}</strong></div>
          <div><span>Tamaño:</span> <strong>~8 MB</strong></div>
          <div><span>Requisitos:</span> <strong>Android 8.0 o superior</strong></div>
          <div><span>Permisos:</span> <strong>Cámara</strong> (notificaciones opcionales para subida en segundo plano)</div>
        </div>

        <div className="native-install-steps">
          <h4>Pasos para instalar:</h4>
          <ol>
            <li>Descargá el archivo APK tocando el botón de abajo.</li>
            <li>Abrí el archivo descargado. Si Android te lo pide, permití <em>Instalar aplicaciones desconocidas</em> en Chrome.</li>
            <li>Confirmá la instalación y volvé a Foto-app para abrirla.</li>
          </ol>
        </div>

        <div className="native-install-actions">
          <a
            href={manifest.downloadUrl}
            className="btn btn--primary btn--large"
            download
            target="_blank"
            rel="noreferrer"
          >
            📥 Descargar cámara Android (APK)
          </a>

          {onOpenIntent && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onOpenIntent}
            >
              🚀 Ya la instalé · Abrir cámara nativa
            </button>
          )}

          <button
            type="button"
            className="btn btn--ghost"
            onClick={onContinueWeb}
          >
            📷 Continuar con la cámara web actual
          </button>
        </div>
      </div>
    </div>
  );
}
