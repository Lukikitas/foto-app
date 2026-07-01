import { useEffect, useState } from 'react';
import InstallPrompt from './components/InstallPrompt';
import PhotoGallery from './components/PhotoGallery';
import PhotoUploader from './components/PhotoUploader';
import UploadQueueStatus from './components/UploadQueueStatus';
import { PHOTO_GALLERY_KINDS } from './lib/photos';
import { setUploadCompleteHandler } from './lib/uploadQueue';
import { getTheme, toggleTheme } from './lib/theme';
import './App.css';

const TABS = {
  capture: 'capture',
  orders: 'orders',
  files: 'files',
};

export default function App() {
  const [tab, setTab] = useState(TABS.capture);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    setUploadCompleteHandler(() => {
      setRefreshKey((k) => k + 1);
    });
  }, []);

  function handleThemeToggle() {
    setTheme(toggleTheme(theme));
  }

  return (
    <div className="app">
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
            searchPlaceholder="4821..."
          />
        )}
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

      <nav className="app-nav" aria-label="Navegacion principal">
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
          className={`app-nav__btn${tab === TABS.files ? ' app-nav__btn--active' : ''}`}
          onClick={() => setTab(TABS.files)}
          aria-current={tab === TABS.files ? 'page' : undefined}
        >
          Archivos
        </button>
      </nav>
    </div>
  );
}
