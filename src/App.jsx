import { useEffect, useState } from 'react';
import InstallPrompt from './components/InstallPrompt';
import PhotoGallery from './components/PhotoGallery';
import PhotoUploader from './components/PhotoUploader';
import UploadQueueStatus from './components/UploadQueueStatus';
import { setUploadCompleteHandler } from './lib/uploadQueue';
import { getTheme, toggleTheme } from './lib/theme';
import './App.css';

const TABS = {
  capture: 'capture',
  gallery: 'gallery',
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

      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark" aria-hidden="true" />
          <span className="app__brand-text">KFC Delivery</span>
        </div>
        <button
          type="button"
          className="app__theme-toggle"
          onClick={handleThemeToggle}
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <main className="app__main">
        {tab === TABS.capture && (
          <>
            <PhotoUploader />
            <UploadQueueStatus />
          </>
        )}
        {tab === TABS.gallery && <PhotoGallery refreshKey={refreshKey} />}
      </main>

      <nav className="app-nav" aria-label="Navegación principal">
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
          className={`app-nav__btn${tab === TABS.gallery ? ' app-nav__btn--active' : ''}`}
          onClick={() => setTab(TABS.gallery)}
          aria-current={tab === TABS.gallery ? 'page' : undefined}
        >
          Galería
        </button>
      </nav>
    </div>
  );
}
