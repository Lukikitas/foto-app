import { useEffect, useState } from 'react';
import { PHOTO_GALLERY_KINDS } from './lib/photos';
import { startDailyImportScheduler } from './lib/complaintDailyImport';
import { setUploadCompleteHandler } from './lib/uploadQueue';
import { getTheme, toggleTheme } from './lib/theme';
import { APP_VERSION } from './lib/version';
import ComplaintsInbox from './components/ComplaintsInbox';
import InstallPrompt from './components/InstallPrompt';
import MetricsPage from './components/MetricsPage';
import UpdatePrompt from './components/UpdatePrompt';
import PhotoGallery from './components/PhotoGallery';
import PhotoUploader from './components/PhotoUploader';
import UploadQueueStatus from './components/UploadQueueStatus';
import './App.css';

const TABS = {
  capture: 'capture',
  orders: 'orders',
  complaints: 'complaints',
  files: 'files',
  metrics: 'metrics',
};

export default function App() {
  const [tab, setTab] = useState(TABS.metrics);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    setUploadCompleteHandler(() => {
      setRefreshKey((k) => k + 1);
    });
  }, []);

  useEffect(() => startDailyImportScheduler(), []);

  function handleThemeToggle() {
    setTheme(toggleTheme(theme));
  }

  return (
    <div className="app">
      <nav className="app-nav" aria-label="Navegacion principal">
        <p className="app-nav__brand">
          Delivery
          <span>La Plata</span>
        </p>
        <span className="app__version">v{APP_VERSION}</span>
        <div className="app-nav__buttons">
          <button
            type="button"
            className={`app-nav__btn${tab === TABS.metrics ? ' app-nav__btn--active' : ''}`}
            onClick={() => setTab(TABS.metrics)}
            aria-current={tab === TABS.metrics ? 'page' : undefined}
          >
            Métricas
          </button>
          <button
            type="button"
            className={`app-nav__btn${tab === TABS.capture ? ' app-nav__btn--active' : ''}`}
            onClick={() => setTab(TABS.capture)}
            aria-current={tab === TABS.capture ? 'page' : undefined}
          >
            Sacar foto
          </button>
          <button
            type="button"
            className={`app-nav__btn${tab === TABS.orders ? ' app-nav__btn--active' : ''}`}
            onClick={() => setTab(TABS.orders)}
            aria-current={tab === TABS.orders ? 'page' : undefined}
          >
            Pedidos
          </button>
          <button
            type="button"
            className={`app-nav__btn${tab === TABS.complaints ? ' app-nav__btn--active' : ''}`}
            onClick={() => setTab(TABS.complaints)}
            aria-current={tab === TABS.complaints ? 'page' : undefined}
          >
            Reclamos
          </button>
          <button
            type="button"
            className={`app-nav__btn${tab === TABS.files ? ' app-nav__btn--active' : ''}`}
            onClick={() => setTab(TABS.files)}
            aria-current={tab === TABS.files ? 'page' : undefined}
          >
            Archivos
          </button>
        </div>
      </nav>

      <div className="app__shell">
        <UpdatePrompt />
        <InstallPrompt />

        <button
          type="button"
          className="app__theme-toggle"
          onClick={handleThemeToggle}
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        <main className="app__main">
          {tab === TABS.capture && (
            <>
              <PhotoUploader />
              <UploadQueueStatus />
            </>
          )}
          {tab === TABS.orders && (
            <PhotoGallery
              key="orders-gallery"
              refreshKey={refreshKey}
              kind={PHOTO_GALLERY_KINDS.orders}
              title="Pedidos"
              itemLabel="pedido"
              emptyMessage="Todavia no hay fotos de pedidos registradas. Subi la primera."
              searchLabel="Pedido"
              searchPlaceholder="PEYA12345 o 4696"
            />
          )}
          {tab === TABS.complaints && <ComplaintsInbox />}
          <div hidden={tab !== TABS.metrics}>
            <MetricsPage />
          </div>
          {tab === TABS.files && (
            <PhotoGallery
              key="files-gallery"
              refreshKey={refreshKey}
              kind={PHOTO_GALLERY_KINDS.files}
              title="Archivos"
              itemLabel="archivo"
              emptyMessage="Todavia no hay archivos generales registrados. Subi el primero."
              searchLabel="Archivo"
              searchPlaceholder="remito, factura..."
            />
          )}
        </main>
      </div>
    </div>
  );
}
