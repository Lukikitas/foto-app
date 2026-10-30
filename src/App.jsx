import { confirmAction } from './lib/confirmAction';
import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react';
import { PHOTO_GALLERY_KINDS } from './lib/photos';
import { activity } from './lib/activity';
import { enqueue, restorePersistedQueue, setUploadCompleteHandler } from './lib/uploadQueue';
import { recoverCompletedCaptureDrafts } from './lib/captureDraftStore.js';
import { getTheme, saveTheme } from './lib/theme';
import { isPhoneViewport, PHONE_MEDIA_QUERY } from './lib/viewport';
import { APP_VERSION } from './lib/version';
import { purgeExpiredUnresolvedTickets } from './lib/unresolvedTicketStore';
import InstallPrompt from './components/InstallPrompt';
import ConfirmationHost from './components/ConfirmationHost';
import NavIcon from './components/NavIcon';
import UpdatePrompt from './components/UpdatePrompt';
const PhotoGallery = lazy(() => import('./components/PhotoGallery'));
import PhotoUploader from './components/PhotoUploader';
import UploadQueueStatus from './components/UploadQueueStatus';
import './App.css';

const MetricsPage=lazy(()=>import('./components/MetricsPage'));
const ComplaintsInbox=lazy(()=>import('./components/ComplaintsInbox'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const DailyPendingPage = lazy(() => import('./components/DailyPendingPage'));

const StableMetricsPage=memo(MetricsPage);
const StableComplaintsInbox=memo(ComplaintsInbox);

const TABS = {
  capture: 'capture',
  orders: 'orders',
  complaints: 'complaints',
  history: 'history',
  files: 'files',
  metrics: 'metrics',
  settings: 'settings',
  pending: 'pending',
};

const NAV_ITEMS = [
  { id: TABS.pending, label: 'Pendientes', short: 'Pendientes', icon: 'pending', desktopOnly: true },
  { id: TABS.metrics, label: 'Métricas', short: 'Métricas', icon: 'metrics' },
  { id: TABS.capture, label: 'Sacar foto', short: 'Foto', icon: 'capture' },
  { id: TABS.orders, label: 'Galería de pedidos', short: 'Galería', icon: 'gallery' },
  { id: TABS.complaints, label: 'Reclamos', short: 'Reclamos', icon: 'complaints' },
  { id: TABS.history, label: 'Historial', short: 'Historial', icon: 'history' },
  { id: TABS.files, label: 'Archivos', short: 'Archivos', icon: 'files' },
  { id: TABS.settings, label: 'Ajustes', short: 'Ajustes', icon: 'settings' },
];

export default function App() {
  const [metricsDirty,setMetricsDirty] = useState(false);
  const [focusedCase,setFocusedCase] = useState(null);
  const [metricsRequest, setMetricsRequest] = useState(null);
  const [complaintLoadRequest, setComplaintLoadRequest] = useState(null);
  const [desktop, setDesktop] = useState(() => !isPhoneViewport());
  const [metricsVisited,setMetricsVisited]=useState(()=>!isPhoneViewport());
  const [complaintsVisited,setComplaintsVisited]=useState(false);
  const [pendingVisited, setPendingVisited] = useState(false);
  const [pendingReturn, setPendingReturn] = useState(false);
  const [pendingDirty, setPendingDirty] = useState(false);
  const [tab, setTab] = useState(() => (isPhoneViewport() ? TABS.capture : TABS.metrics));
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState(getTheme);
  const [sessionAuthor, setSessionAuthor] = useState('');
  const [metricsRefreshKey, setMetricsRefreshKey] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(true);

  useEffect(() => {
    const media = window.matchMedia(PHONE_MEDIA_QUERY);
    function resize() {
      setDesktop(!media.matches);
      if (media.matches) setTab(current => current === TABS.pending ? TABS.capture : current);
    }
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);

  useEffect(() => {
    setUploadCompleteHandler(() => {
      setRefreshKey((k) => k + 1);
    });
    restorePersistedQueue();
    void recoverCompletedCaptureDrafts(enqueue).catch(error => console.error('Se conserva el borrador pendiente de recuperación.', error));
  }, []);

  useEffect(() => {
    let stop;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void activity.wait(abort.signal).then(() => import('./lib/complaintDailyImport'))
        .then(module => { if (!abort.signal.aborted) stop = module.startDailyImportScheduler(); })
        .catch(error => { if (error.name !== 'AbortError') console.warn(error); });
    }, 1000);
    return () => { clearTimeout(timer); abort.abort(); stop?.(); };
  }, []);

  useEffect(() => {
    let lastPurge = 0;
    const purge = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastPurge < 60 * 60 * 1000) return;
      lastPurge = Date.now();
      void activity.wait().then(() => purgeExpiredUnresolvedTickets()).catch(console.warn);
    };
    purge();
    document.addEventListener('visibilitychange', purge);
    return () => document.removeEventListener('visibilitychange', purge);
  }, []);

  const navigate=useCallback(async (next, { fromPending = false } = {}) => {
    if (next === TABS.pending && !desktop) return false;
    if (next !== tab && (metricsDirty || pendingDirty) && !await confirmAction(pendingDirty ? 'Hay una carga sin guardar en Pendientes. Podés volver para continuar el borrador.' : 'Hay cambios sin guardar en Métricas. Podés volver a Cargar para continuar el borrador.', { danger: false, title: 'Cambios pendientes', confirmLabel: 'Cambiar de sección' })) return false;
    if(next===TABS.metrics)setMetricsVisited(true);
    if(next===TABS.complaints||next===TABS.history)setComplaintsVisited(true);
    if (next === TABS.pending) setPendingVisited(true);
    setPendingReturn(fromPending);
    setTab(next);
    return true;
  },[desktop,metricsDirty,pendingDirty,tab]);
  const manageMetricCase=useCallback(item=>{setFocusedCase(item?.id ? item : null);void navigate(item?.id ? TABS.history : TABS.complaints);},[navigate]);
  const requestCruzar=useCallback(()=>setTab(TABS.complaints),[]);
  const requestHistory=useCallback(()=>setTab(TABS.history),[]);
  async function openPendingDay(day, aggregator, mode = 'day') {
    if (await navigate(TABS.metrics, { fromPending: true })) setMetricsRequest({ day, aggregator, mode, id: crypto.randomUUID() });
  }
  async function openPendingCase(item) {
    if (await navigate(TABS.history, { fromPending: true })) setFocusedCase({ ...item, requestId: crypto.randomUUID() });
  }
  async function openPendingComplaints(day, aggregator) {
    if (await navigate(TABS.complaints, { fromPending: true })) setComplaintLoadRequest({ day, aggregator, id: crypto.randomUUID() });
  }
  function handleThemeChange(nextTheme) {
    saveTheme(nextTheme);
    setTheme(nextTheme);
  }

  function handleNavCollapse() {
    setNavCollapsed(current => !current);
  }

  const complaintsOpen = tab === TABS.complaints || tab === TABS.history;

  return (
    <div className={`app${navCollapsed ? ' app--nav-collapsed' : ''}`}>
      <nav className="app-nav" aria-label="Navegacion principal">
        <div className="app-nav__top">
          <p className="app-nav__brand">
            STAR-APP Delivery
            <span>Local: La Plata</span>
          </p>
          <button
            type="button"
            className="app-nav__collapse"
            onClick={handleNavCollapse}
            aria-pressed={!navCollapsed}
            aria-label={navCollapsed ? 'Fijar menú abierto' : 'Activar menú automático'}
            title={navCollapsed ? 'Fijar menú abierto' : 'Activar menú automático'}
          >
            <NavIcon name={navCollapsed ? 'expand' : 'collapse'} />
          </button>
        </div>

        <div className="app-nav__buttons">
          {NAV_ITEMS.filter(item => !item.desktopOnly || desktop).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`app-nav__btn app-nav__btn--${item.id}${active ? ' app-nav__btn--active' : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
              >
                <NavIcon name={item.icon} />
                <span className="app-nav__btn-label app-nav__btn-label--full">{item.label}</span>
                <span className="app-nav__btn-label app-nav__btn-label--short">{item.short}</span>
              </button>
            );
          })}
        </div>

        <div className="app-nav__end">
          <span className="app__version">v{APP_VERSION}</span>
        </div>
      </nav>

      <div className="app__shell">
        <ConfirmationHost />
        <UpdatePrompt />
        <InstallPrompt />

        <main className={`app__main${tab === TABS.capture ? ' app__main--capture' : ''}`}>
          <UploadQueueStatus />
          {desktop && pendingReturn && (tab === TABS.metrics || complaintsOpen) && <button className="btn btn--ghost pending-return" onClick={() => navigate(TABS.pending)}>← Volver a pendientes</button>}
          {pendingVisited && <div hidden={!desktop || tab !== TABS.pending}><Suspense fallback={<p className="gallery__state">Cargando pendientes…</p>}>
            <DailyPendingPage active={desktop && tab === TABS.pending} onLoadDay={openPendingDay} onLoadComplaints={openPendingComplaints} onCase={openPendingCase} onDirtyChange={setPendingDirty} />
          </Suspense></div>}
          {tab === TABS.capture && (
            <PhotoUploader author={sessionAuthor} onAuthorChange={setSessionAuthor} />
          )}
          {tab === TABS.orders && (
            <Suspense fallback={<p className="gallery__state">Cargando galería…</p>}><PhotoGallery
              key="orders-gallery"
              refreshKey={refreshKey}
              kind={PHOTO_GALLERY_KINDS.orders}
              title="Galería de pedidos"
              itemLabel="pedido"
              emptyMessage="Todavia no hay fotos de pedidos registradas. Subi la primera."
              searchLabel="Pedido"
              searchPlaceholder="PEYA12345 o 4696"
            /></Suspense>
          )}
          {complaintsVisited && <div hidden={!complaintsOpen} className="app__panel">
            <Suspense fallback={<p className="gallery__state">Cargando reclamos…</p>}>
            <StableComplaintsInbox
              active={complaintsOpen}
              loadRequest={complaintLoadRequest}
              focusedCase={focusedCase}
              view={tab === TABS.history ? 'historial' : 'cruzar'}
              refreshKey={metricsRefreshKey}
              onRequestCruzar={requestCruzar}
              onRequestHistory={requestHistory}
            />
            </Suspense>
          </div>}
          {metricsVisited && <div hidden={tab !== TABS.metrics}>
            <Suspense fallback={<p className="gallery__state">Cargando métricas…</p>}>
            <StableMetricsPage active={tab === TABS.metrics} entryRequest={metricsRequest} refreshKey={metricsRefreshKey} onDirtyChange={setMetricsDirty} onManage={manageMetricCase} />
            </Suspense>
          </div>}
          {tab === TABS.settings && (
            <Suspense fallback={<p className="gallery__state">Cargando ajustes…</p>}>
              <SettingsPage theme={theme} onThemeChange={handleThemeChange}
                onTargetsSaved={() => setMetricsRefreshKey((value) => value + 1)} />
            </Suspense>
          )}
          {tab === TABS.files && (
            <Suspense fallback={<p className="gallery__state">Cargando archivos…</p>}><PhotoGallery
              key="files-gallery"
              refreshKey={refreshKey}
              kind={PHOTO_GALLERY_KINDS.files}
              title="Archivos"
              itemLabel="archivo"
              emptyMessage="Todavia no hay archivos generales registrados. Subi el primero."
              searchLabel="Archivo"
              searchPlaceholder="remito, factura..."
            /></Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
