import { useEffect, useState } from 'react';
import { PHOTO_GALLERY_KINDS } from './lib/photos';
import { startDailyImportScheduler } from './lib/complaintDailyImport';
import { setUploadCompleteHandler } from './lib/uploadQueue';
import { getTheme, toggleTheme } from './lib/theme';
import { getNavCollapsed, saveNavCollapsed } from './lib/storage';
import { APP_VERSION } from './lib/version';
import ComplaintsInbox from './components/ComplaintsInbox';
import InstallPrompt from './components/InstallPrompt';
import MetricsPage from './components/MetricsPage';
import NavIcon from './components/NavIcon';
import UpdatePrompt from './components/UpdatePrompt';
import PhotoGallery from './components/PhotoGallery';
import PhotoUploader from './components/PhotoUploader';
import UploadQueueStatus from './components/UploadQueueStatus';
import './App.css';

const TABS = {
  capture: 'capture',
  orders: 'orders',
  complaints: 'complaints',
  history: 'history',
  files: 'files',
  metrics: 'metrics',
};

const NAV_ITEMS = [
  { id: TABS.metrics, label: 'Métricas', short: 'Métricas', icon: 'metrics' },
  { id: TABS.capture, label: 'Sacar foto', short: 'Foto', icon: 'capture' },
  { id: TABS.orders, label: 'Galería de pedidos', short: 'Galería', icon: 'gallery' },
  { id: TABS.complaints, label: 'Reclamos', short: 'Reclamos', icon: 'complaints' },
  { id: TABS.history, label: 'Historial', short: 'Historial', icon: 'history' },
  { id: TABS.files, label: 'Archivos', short: 'Archivos', icon: 'files' },
];

export default function App() {
  const [tab, setTab] = useState(TABS.metrics);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState(getTheme);
  const [navCollapsed, setNavCollapsed] = useState(getNavCollapsed);

  useEffect(() => {
    setUploadCompleteHandler(() => {
      setRefreshKey((k) => k + 1);
    });
  }, []);

  useEffect(() => startDailyImportScheduler(), []);

  function handleThemeToggle() {
    setTheme(toggleTheme(theme));
  }

  function handleNavCollapse() {
    const next = !navCollapsed;
    setNavCollapsed(next);
    saveNavCollapsed(next);
  }

  const complaintsOpen = tab === TABS.complaints || tab === TABS.history;

  return (
    <div className={`app${navCollapsed ? ' app--nav-collapsed' : ''}`}>
      <nav className="app-nav" aria-label="Navegacion principal">
        <div className="app-nav__top">
          <p className="app-nav__brand">
            Delivery
            <span>La Plata</span>
          </p>
          <button
            type="button"
            className="app-nav__collapse"
            onClick={handleNavCollapse}
            aria-pressed={navCollapsed}
            aria-label={navCollapsed ? 'Mostrar menú' : 'Replegar menú'}
            title={navCollapsed ? 'Mostrar menú' : 'Replegar menú'}
          >
            <NavIcon name={navCollapsed ? 'expand' : 'collapse'} />
          </button>
        </div>

        <div className="app-nav__buttons">
          {NAV_ITEMS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`app-nav__btn${active ? ' app-nav__btn--active' : ''}`}
                onClick={() => setTab(item.id)}
                aria-current={active ? 'page' : undefined}
                title={navCollapsed ? item.label : undefined}
              >
                <NavIcon name={item.icon} />
                <span className="app-nav__btn-label app-nav__btn-label--full">{item.label}</span>
                <span className="app-nav__btn-label app-nav__btn-label--short">{item.short}</span>
              </button>
            );
          })}
        </div>

        <div className="app-nav__end">
          <button
            type="button"
            className="app-nav__theme"
            onClick={handleThemeToggle}
            aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          >
            <span className="app-nav__theme-label">{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
          </button>
          <span className="app__version">v{APP_VERSION}</span>
        </div>
      </nav>

      <div className="app__shell">
        <UpdatePrompt />
        <InstallPrompt />

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
              title="Galería de pedidos"
              itemLabel="pedido"
              emptyMessage="Todavia no hay fotos de pedidos registradas. Subi la primera."
              searchLabel="Pedido"
              searchPlaceholder="PEYA12345 o 4696"
            />
          )}
          <div hidden={!complaintsOpen} className="app__panel">
            <ComplaintsInbox
              view={tab === TABS.history ? 'historial' : 'cruzar'}
              onRequestCruzar={() => setTab(TABS.complaints)}
              onRequestHistory={() => setTab(TABS.history)}
            />
          </div>
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
