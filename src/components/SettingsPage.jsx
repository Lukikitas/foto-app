import Dialog from './Dialog';
import StoragePanel from './StoragePanel';
import { confirmAction } from '../lib/confirmAction';
import { clearComplaintHistory, loadComplaintHistory } from '../lib/complaintHistoryStore';
import PhotoLightbox from './PhotoLightbox';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AGGREGATOR_OPTIONS, detectAggregator, getAggregatorLabel } from '../lib/aggregators';
import { formatNumber, setRefutadoDays, setTargetAwtPct, setTargetComplaintPct } from '../lib/metrics';
import { loadMetricsHeader, saveMetricsStore } from '../lib/metricsStore';
import { fetchPhotosByIds, UNIDENTIFIED_ORDER_NAME } from '../lib/photos';
import {
  countPhotoRetentionCandidates,
  loadPhotoCleanupSettings,
  savePhotoCleanupSettings,
} from '../lib/photoCleanupSettings';
import {
  normalizeRetentionDays,
  PHOTO_RETENTION_MAX_DAYS,
  PHOTO_RETENTION_MIN_DAYS,
} from '../lib/photoRetention';
import PhotoRetentionConfirmModal from './PhotoRetentionConfirmModal';
import PhotoCleanupModal from './PhotoCleanupModal';
import './SettingsPage.css';
import {
  normalizeRefutadoDays,
  REFUTADO_DAYS_MAX,
  REFUTADO_DAYS_MIN,
} from '../lib/refutadoDeadline';
import {
  RECOVERY_MODES, confirmRecoveredCode, loadRecoveryEvents,
  loadRecoveryProgress, loadRecoverySettings, saveRecoverySettings,
} from '../lib/recoverySettings';
import { APP_VERSION, RELEASE_GROUPS } from '../lib/version.js';

function argentinaDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short', timeStyle: 'short',
  });
}

const RUN_STATUS = {
  running: 'En curso', complete: 'Terminada',
  quota_exhausted: 'Cuota agotada', paused: 'Pausada',
};

const CATEGORIES = [
  { id: 'operation', label: 'Operación', description: 'Objetivos, plazos y revisión de pedidos.' },
  { id: 'storage', label: 'Fotos y espacio', description: 'Conservación de imágenes y almacenamiento remoto.' },
  { id: 'general', label: 'General y ayuda', description: 'Personalizá tu experiencia y consultá las guías.' },
  { id: 'admin', label: 'Administración', description: 'Gestioná el historial compartido del local.' },
];
const PAGE_SIZE = 10;
const SETTINGS_DATA = {
  loadRecoverySettings, loadMetricsStore: loadMetricsHeader, loadPhotoCleanupSettings, loadRecoveryProgress,
  saveRecoverySettings, saveMetricsStore, savePhotoCleanupSettings, countPhotoRetentionCandidates,
  fetchPhotosByIds, confirmRecoveredCode, loadRecoveryEvents, loadComplaintHistory, clearComplaintHistory,
};

function Feedback({ error, notice }) {
  return <>{error && <p className="message message--error" role="alert">{error}</p>}
    {notice && <p className="message message--success" role="status">{notice}</p>}</>;
}

function toDeadlineDraft(days) {
  return Object.fromEntries(
    Object.entries(normalizeRefutadoDays(days)).map(([key, value]) => [key, String(value)]),
  );
}

export default function SettingsPage({ theme, onThemeChange, onTargetsSaved, dataSource = SETTINGS_DATA }) {
  const { loadRecoverySettings, loadMetricsStore, loadPhotoCleanupSettings, loadRecoveryProgress,
    saveRecoverySettings, saveMetricsStore, savePhotoCleanupSettings, countPhotoRetentionCandidates,
    fetchPhotosByIds, confirmRecoveredCode, loadRecoveryEvents, loadComplaintHistory, clearComplaintHistory } = dataSource;
  const [category, setCategory] = useState('operation');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('proposed');
  const [reviewPage, setReviewPage] = useState(1);
  const [feedbackScope, setFeedbackScope] = useState('load');
  const [loadErrors, setLoadErrors] = useState({});
  const [savedValues, setSavedValues] = useState({});
  const [settings, setSettings] = useState(null);
  const [targets, setTargets] = useState(null);
  // Borrador en crudo (strings) de los plazos de refutación, para que borrar
  // un campo no lo reemplace solo con el default mientras se escribe.
  const [deadlines, setDeadlines] = useState(null);
  // «Liberación de fotos»: fila del servidor, borrador editable y el popup de
  // confirmación con el conteo de fotos que se borrarían con el plazo nuevo.
  const [retention, setRetention] = useState(null);
  const [retentionDraft, setRetentionDraft] = useState(null);
  const [retentionPreview, setRetentionPreview] = useState(null);
  const [retentionCounting, setRetentionCounting] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [storageRefresh, setStorageRefresh] = useState(0);
  const [progress, setProgress] = useState(null);
  const [photos, setPhotos] = useState({});
  const [drafts, setDrafts] = useState({});
  const [events, setEvents] = useState({});
  const [eventErrors, setEventErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const releaseButtonRef = useRef(null);
  const releaseCloseRef = useRef(null);

  const refreshProgress = useCallback(async () => {
    const nextProgress = await loadRecoveryProgress();
    const items = nextProgress.proposals;
    setProgress(nextProgress);
    setLoadErrors(current => ({ ...current, review: '' }));
    setDrafts((current) => Object.fromEntries(items.map((item) => [
      item.photo_id, current[item.photo_id] || {
        code: item.code || '',
        aggregator: item.aggregator || detectAggregator(item.code || '') || '',
      },
    ])));
  }, [loadRecoveryProgress]);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      loadRecoverySettings(), loadMetricsStore({ strict: true }), loadPhotoCleanupSettings(), refreshProgress(),
    ]);
    const scopes = ['operation', 'targets', 'retention', 'review'];
    const failures = {};
    results.forEach((result, index) => {
      if (result.status === 'rejected') failures[scopes[index]] = result.reason.message || 'No se pudo cargar. Volvé a intentar.';
    });
    setLoadErrors(failures);
    if (results[0].status === 'fulfilled') {
      const next = results[0].value;
      setSavedValues(current => ({ ...current, operation: current.operation ?? next }));
      setSettings(current => current ?? next);
    }
    if (results[1].status === 'fulfilled') {
      const next = results[1].value;
      setSavedValues(current => ({ ...current, targets: current.targets ?? next, deadlines: current.deadlines ?? toDeadlineDraft(next.refutadoDays) }));
      setTargets(current => current ?? next);
      setDeadlines(current => current ?? toDeadlineDraft(next.refutadoDays));
    }
    if (results[2].status === 'fulfilled') {
      const next = results[2].value;
      setSavedValues(current => ({ ...current, retention: current.retention ?? { enabled: next.enabled, retention_days: String(next.retention_days) } }));
      setRetention(current => current ?? next);
      setRetentionDraft(current => current ?? { enabled: next.enabled, retention_days: String(next.retention_days) });
    }
  }, [loadRecoverySettings, loadMetricsStore, loadPhotoCleanupSettings, refreshProgress]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      refresh().catch((failure) => {
        if (active) setError(failure.message || 'No se pudieron cargar los ajustes.');
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    if (category !== 'operation') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshProgress().catch((failure) => setLoadErrors(current => ({ ...current, review: failure.message || 'No se pudo actualizar el progreso.' })));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshProgress, category]);

  async function saveOperation(event) {
    event.preventDefault();
    setFeedbackScope('operation');
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await saveRecoverySettings({
        enabled: settings.enabled,
        start_time: settings.start_time,
        mode: settings.mode,
      });
      setSettings(saved);
      setSavedValues(current => ({ ...current, operation: saved }));
      setNotice('Revisión automática actualizada.');
    } catch (failure) {
      setError(failure.message || 'No se pudieron guardar los ajustes.');
    } finally { setBusy(false); }
  }

  async function saveTargets(event) {
    event.preventDefault();
    setFeedbackScope('targets');
    setBusy(true); setError(''); setNotice('');
    try {
      let current = await loadMetricsStore({ strict: true });
      current = setTargetComplaintPct(current, targets.targetComplaintPct);
      current = setTargetAwtPct(current, targets.targetAwtPct);
      const saved = await saveMetricsStore(current);
      setTargets(saved);
      setSavedValues(current => ({ ...current, targets: saved }));
      onTargetsSaved();
      setNotice('Objetivos actualizados.');
    } catch (failure) {
      setError(failure.message || 'No se pudieron guardar los objetivos.');
    } finally { setBusy(false); }
  }

  async function saveDeadlines(event) {
    event.preventDefault();
    setFeedbackScope('deadlines');
    setBusy(true); setError(''); setNotice('');
    try {
      let current = await loadMetricsStore({ strict: true });
      current = setRefutadoDays(current, deadlines);
      const saved = await saveMetricsStore(current);
      setTargets(current => ({ ...current, refutadoDays: saved.refutadoDays }));
      setDeadlines(toDeadlineDraft(saved.refutadoDays));
      setSavedValues(current => ({ ...current, deadlines: toDeadlineDraft(saved.refutadoDays) }));
      onTargetsSaved();
      setNotice('Plazos de refutación actualizados.');
    } catch (failure) {
      setError(failure.message || 'No se pudieron guardar los plazos.');
    } finally { setBusy(false); }
  }

  async function persistRetention(patch, message) {
    setFeedbackScope('retention');
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await savePhotoCleanupSettings(patch);
      setRetention(saved);
      setRetentionDraft({
        enabled: saved.enabled,
        retention_days: String(saved.retention_days),
      });
      setSavedValues(current => ({ ...current, retention: { enabled: saved.enabled, retention_days: String(saved.retention_days) } }));
      setNotice(message);
    } catch (failure) {
      setError(failure.message || 'No se pudo guardar la liberación de fotos.');
    } finally { setBusy(false); }
  }

  async function saveRetention(event) {
    event.preventDefault();
    setFeedbackScope('retention');
    if (!retention || !retentionDraft || retentionCounting || busy) return;
    const days = normalizeRetentionDays(retentionDraft.retention_days);
    const currentDays = normalizeRetentionDays(retention.retention_days);
    const enabledChanged = retentionDraft.enabled !== retention.enabled;

    if (days === currentDays) {
      if (!enabledChanged) {
        setRetentionDraft({ enabled: retention.enabled, retention_days: String(retention.retention_days) });
        setNotice('Sin cambios en la conservación de fotos.'); return;
      }
      await persistRetention({ enabled: retentionDraft.enabled }, 'Limpieza automática actualizada.');
      return;
    }

    // Plazo nuevo: primero calculamos cuántas fotos se borrarían con él (mismo
    // criterio que la limpieza) y recién ahí pedimos confirmación.
    setRetentionCounting(true); setError(''); setNotice('');
    let count = null;
    let currentCount = null;
    let countFailed = false;
    try {
      count = await countPhotoRetentionCandidates({ days });
      if (count > 0 && currentDays !== days) {
        currentCount = await countPhotoRetentionCandidates({ days: currentDays });
      }
    } catch {
      countFailed = true;
    } finally {
      setRetentionCounting(false);
    }

    if (!countFailed && count === 0) {
      await persistRetention(
        { retention_days: days, enabled: retentionDraft.enabled },
        `Plazo actualizado a ${days} días. Todavía no hay fotos candidatas.`,
      );
      return;
    }

    setRetentionPreview({
      days,
      currentDays,
      count,
      currentCount,
      countFailed,
      enabled: retentionDraft.enabled,
    });
  }

  async function confirmRetentionPreview() {
    const preview = retentionPreview;
    if (!preview) return;
    setRetentionPreview(null);
    await persistRetention(
      { retention_days: preview.days, enabled: preview.enabled },
      `Liberación de fotos: plazo de ${preview.days} días. Las fotos se borran en la próxima limpieza.`,
    );
  }

  async function applyProposal(item, clear = false) {
    setFeedbackScope('review');
    const photo = photos[item.photo_id];
    const draft = drafts[item.photo_id];
    if (!photo || (!clear && (!draft?.code.trim() || !draft.aggregator))) {
      setError('Elegí un código y su agregador.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      await confirmRecoveredCode(
        item.photo_id, photo.name, clear ? null : draft.code.trim(),
        clear ? null : draft.aggregator,
        { correction: clear || item.status !== 'proposed', source: item.source },
      );
      await refreshProgress();
      setNotice(clear ? 'Pedido devuelto a Sin código.' : 'Código y agregador guardados.');
    } catch (failure) {
      setError(failure.message || 'No se pudo actualizar el pedido.');
    } finally { setBusy(false); }
  }

  async function showEvents(photoId) {
    setFeedbackScope('review');
    setEventErrors(current => ({ ...current, [photoId]: '' }));
    try {
      const history = await loadRecoveryEvents(photoId);
      setEvents((current) => ({ ...current, [photoId]: history }));
    } catch (failure) {
      setEventErrors(current => ({ ...current, [photoId]: failure.message || 'No se pudo leer el historial.' }));
    }
  }

  const filteredItems = (progress?.proposals || []).filter(item => reviewFilter === 'all' || item.status === reviewFilter);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(reviewPage, pageCount);
  const visibleItems = filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const visibleIds = category === 'operation' && reviewOpen ? visibleItems.map(item => item.photo_id).join(',') : '';
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!visibleIds) { setPhotosLoading(false); setPhotoError(''); return; }
      setPhotosLoading(true); setPhotoError('');
      fetchPhotosByIds(visibleIds.split(',')).then(found => {
        if (active) setPhotos(current => ({ ...current, ...Object.fromEntries(found.map(photo => [photo.id, photo])) }));
      }).catch(failure => { if (active) setPhotoError(failure.message || 'No se pudieron cargar las fotos.'); })
        .finally(() => { if (active) setPhotosLoading(false); });
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [visibleIds, storageRefresh, fetchPhotosByIds]);

  function changed(scope, value, keys = Object.keys(value || {})) {
    const saved = savedValues[scope];
    return !!saved && keys.some(key => key === 'start_time'
      ? String(value?.[key]).slice(0, 5) !== String(saved[key]).slice(0, 5)
      : String(value?.[key]) !== String(saved[key]));
  }
  function editDraft(scope, setter, value, patch) {
    setter({ ...value, ...patch });
    if (feedbackScope === scope) { setNotice(''); setError(''); }
  }
  function feedback(scope) {
    return <Feedback error={loadErrors[scope] || (feedbackScope === scope ? error : '')}
      notice={feedbackScope === scope ? notice : ''} />;
  }
  async function updateProgress() {
    setFeedbackScope('review'); setError(''); setNotice('');
    try {
      await refreshProgress();
      setLoadErrors(current => ({ ...current, review: '' }));
      setStorageRefresh(value => value + 1);
    } catch (failure) { setError(failure.message || 'No se pudo actualizar la revisión.'); }
  }
  async function clearHistory() {
    setFeedbackScope('admin'); setError(''); setNotice(''); setBusy(true);
    try {
      const history = await loadComplaintHistory({ force: true, strict: true });
      const count = Object.keys(history.items || {}).length;
      if (!await confirmAction({ title: 'Vaciar historial de reclamos',
        message: `Se eliminarán ${count} casos de todos los períodos. Esto borra sus estados e importes de las métricas económicas. No elimina fotos ni totales diarios.`,
        confirmLabel: 'Eliminar historial' })) return;
      await clearComplaintHistory(); setNotice('Historial de reclamos eliminado.'); onTargetsSaved();
    } catch (failure) { setError(failure.message || 'No se pudo eliminar el historial.'); }
    finally { setBusy(false); }
  }
  const pendingCount = progress?.proposals.filter(item => item.status === 'proposed').length || 0;
  const activeCategory = CATEGORIES.find(item => item.id === category);

  return (
    <section className="settings settings--rework">
      <header className="settings__header">
        <div><span className="settings__eyebrow">Preferencias del local</span><h2>Ajustes</h2><p>{activeCategory.description}</p></div>
        <span className="settings__local">La Plata <span>· STAR-APP Delivery</span></span>
      </header>
      <nav className="settings__categories" aria-label="Categorías de ajustes">
        {CATEGORIES.map(item => <button key={item.id} type="button" className={category === item.id ? 'is-active' : ''}
          aria-current={category === item.id ? 'page' : undefined} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      </nav>
      <label className="settings__mobile-category">Categoría
        <select value={category} onChange={event => setCategory(event.target.value)}>
          {CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {Object.values(loadErrors).some(Boolean) && <div className="settings__load-error">
        <span>Algunos datos no se pudieron cargar.</span><button className="btn btn--ghost btn--small" onClick={() => void refresh()}>Volver a intentar</button>
      </div>}
      {feedbackScope === 'load' && <Feedback error={error} notice={notice} />}

      {category === 'operation' && !reviewOpen && <div className="settings__operation-layout">
        <div className="settings__stack">
          <section className="settings__card">
            <div className="settings__block-head"><div><h3>Objetivos de métricas</h3><p>Valores máximos para evaluar el desempeño.</p></div><span className="settings__scope">Compartido</span></div>
            {!targets ? <p>{loadErrors.targets ? 'Objetivos no disponibles.' : 'Cargando objetivos…'}</p> : <form onSubmit={saveTargets}>
              <div className="settings__fields-pair">
                <label><span>Quejas · máximo (%)</span><input type="number" min="0" max="100" step="0.1" required value={targets.targetComplaintPct} disabled={busy}
                  onChange={event => editDraft('targets', setTargets, targets, { targetComplaintPct: event.target.value })} /></label>
                <label><span>AWT PedidosYa · máximo (%)</span><input type="number" min="0" max="100" step="0.1" required value={targets.targetAwtPct} disabled={busy}
                  onChange={event => editDraft('targets', setTargets, targets, { targetAwtPct: event.target.value })} /></label>
              </div>
              <div className="settings__form-footer"><span>{changed('targets', targets, ['targetComplaintPct', 'targetAwtPct']) ? 'Cambios sin guardar' : 'Se aplica a las métricas del local'}</span>
                <button className="btn btn--primary btn--small" disabled={busy || !changed('targets', targets, ['targetComplaintPct', 'targetAwtPct'])}>{busy && feedbackScope === 'targets' ? 'Guardando…' : 'Guardar objetivos'}</button></div>
            </form>}{feedback('targets')}
          </section>
          <section className="settings__card">
            <div className="settings__block-head"><div><h3>Plazos de refutación</h3><p>Días desde el pedido. <strong>0 = sin límite.</strong></p></div><span className="settings__scope">Compartido</span></div>
            {!deadlines ? <p>{loadErrors.targets ? 'Plazos no disponibles.' : 'Cargando plazos…'}</p> : <form onSubmit={saveDeadlines}>
              <div className="settings__deadline-rows">
                {[{ id: 'default', label: 'General' }, ...AGGREGATOR_OPTIONS].map(option => <label key={option.id}>
                  <span>{option.label}</span><span className="settings__days-field"><input type="number" min={REFUTADO_DAYS_MIN} max={REFUTADO_DAYS_MAX} required
                    aria-label={`Plazo de ${option.label}`} disabled={busy} value={deadlines[option.id] ?? deadlines.default}
                    onChange={event => editDraft('deadlines', setDeadlines, deadlines, { [option.id]: event.target.value })} /><span aria-hidden="true">días</span></span>
                </label>)}
              </div>
              <details className="settings__help"><summary>Cómo funcionan los plazos</summary><p>Al vencer el plazo, el reclamo aparece como «Queja vencida» y deja de ofrecerse la refutación. Con 0, nunca vence. Los cambios se aplican al historial de todos los dispositivos del local.</p></details>
              <div className="settings__form-footer"><span>{changed('deadlines', deadlines) ? 'Cambios sin guardar' : 'Plazos por agregador'}</span><button className="btn btn--primary btn--small" disabled={busy || !changed('deadlines', deadlines)}>{busy && feedbackScope === 'deadlines' ? 'Guardando…' : 'Guardar plazos'}</button></div>
            </form>}{feedback('deadlines')}
          </section>
        </div>
        <section className="settings__card settings__recovery">
          <div className="settings__block-head"><div><h3>Pedidos sin código</h3><p>Revisión automática y propuestas para el equipo.</p></div></div>
          <div className="settings__automation-status"><span className={`settings__status${savedValues.operation?.enabled ? ' is-enabled' : ''}`}>{settings ? savedValues.operation?.enabled ? 'Activa' : 'Desactivada' : 'Cargando…'}</span>
            {settings && <span>{String(savedValues.operation?.start_time).slice(0, 5)} · Argentina</span>}</div>
          <details className="settings__configure"><summary>Configurar revisión diaria</summary>
            {!settings ? <p>Configuración no disponible.</p> : <form onSubmit={saveOperation}>
              <label className="settings__switch"><span>Activar revisión diaria</span><input type="checkbox" role="switch" disabled={busy} checked={settings.enabled} onChange={event => editDraft('operation', setSettings, settings, { enabled: event.target.checked })} /></label>
              <label>Hora de inicio · Argentina<input type="time" required disabled={busy} value={String(settings.start_time).slice(0, 5)} onChange={event => editDraft('operation', setSettings, settings, { start_time: event.target.value })} /></label>
              <label>Acción<select disabled={busy} value={settings.mode} onChange={event => editDraft('operation', setSettings, settings, { mode: event.target.value })}>{RECOVERY_MODES.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>
              <p className="settings__caption">Continúa en el servidor con la app cerrada. Las lecturas dudosas quedan para revisión manual.</p>
              <div className="settings__form-footer"><span>{changed('operation', settings, ['enabled', 'start_time', 'mode']) ? 'Cambios sin guardar' : 'Compartido con el local'}</span><button className="btn btn--primary btn--small" disabled={busy || !changed('operation', settings, ['enabled', 'start_time', 'mode'])}>{busy && feedbackScope === 'operation' ? 'Guardando…' : 'Guardar revisión'}</button></div>
            </form>}
          </details>{feedback('operation')}
          <div className="settings__review-summary">
            <div className="settings__counters"><div><strong>{progress ? formatNumber(progress.pending) : '—'}</strong><span>Sin código</span></div><div><strong>{progress ? formatNumber(pendingCount) : '—'}</strong><span>Propuestas pendientes</span></div></div>
            <button type="button" className="btn btn--primary" onClick={() => setReviewOpen(true)}>Revisar propuestas <span aria-hidden="true">→</span></button>
            {progress?.runs[0] && <p className="settings__caption">Última ejecución: {progress.runs[0].day.split('-').reverse().join('/')} · {RUN_STATUS[progress.runs[0].status] || progress.runs[0].status}
              {progress.runs[0].failed > 0 && <span className="settings__run-warning"> · {progress.runs[0].failed} errores · Ver detalle en revisión</span>}</p>}
          </div>{feedback('review')}
        </section>
      </div>}

      {category === 'operation' && reviewOpen && <section className="settings__card settings__review">
        <div className="settings__review-heading"><div><button className="settings__back" onClick={() => setReviewOpen(false)}>← Volver a operación</button><h3>Revisión de pedidos</h3><p>Propuestas y correcciones de los últimos 100 pedidos revisados.</p></div><button className="btn btn--ghost btn--small" disabled={busy} onClick={updateProgress}>Actualizar</button></div>
        {feedback('review')}
        <div className="settings__review-toolbar"><label>Mostrar<select value={reviewFilter} onChange={event => { setReviewFilter(event.target.value); setReviewPage(1); }}>
          <option value="proposed">Pendientes</option><option value="confirmed">Confirmados</option><option value="manual_override">Corregidos</option><option value="all">Todos</option>
        </select></label><span>{formatNumber(filteredItems.length)} resultados</span></div>
        {!progress && !loadErrors.review && <p role="status">Cargando revisión…</p>}
        {progress && !filteredItems.length && <div className="settings__empty"><span aria-hidden="true">✓</span><h4>{reviewFilter === 'proposed' ? 'No hay propuestas pendientes' : 'No hay pedidos en este filtro'}</h4><p>{reviewFilter === 'proposed' ? 'Podés consultar los confirmados y las correcciones desde el filtro.' : 'Elegí otro estado para consultar los pedidos recientes.'}</p></div>}
        {photoError && <div><Feedback error={photoError} /><button className="btn btn--ghost" onClick={() => setStorageRefresh(value => value + 1)}>Reintentar fotos</button></div>}
        {photosLoading && <p role="status">Cargando fotos…</p>}
        <div className="settings__results">{visibleItems.map(item => {
          const photo = photos[item.photo_id];
          const draft = drafts[item.photo_id] || { code: '', aggregator: '' };
          return <details className="settings__review-item" key={item.photo_id}>
            <summary><span className="settings__item-code">{item.code || 'Sin código'}</span><span className="settings__item-status">{item.status === 'confirmed' ? 'Confirmado' : item.status === 'manual_override' ? 'Corregido' : 'Pendiente'}</span><span className="settings__item-date">{argentinaDate(item.analyzed_at)}</span></summary>
            <div className="settings__item-body">
              {photo ? <button type="button" className="settings__photo-button" onClick={() => setLightboxPhoto(photo)} aria-label={`Ampliar foto de ${item.code || 'pedido sin código'}`}>{photo.public_url ? <img src={photo.public_url} alt="Foto del pedido analizado" loading="lazy" /> : <span>Imagen no disponible</span>}</button> : <p>{photosLoading ? 'Cargando foto…' : 'Pedido no disponible.'}</p>}
              <div className="settings__item-editor"><div className="settings__fields-pair"><label>Código<input value={draft.code} disabled={busy || !photo} onChange={event => setDrafts({ ...drafts, [item.photo_id]: { ...draft, code: event.target.value.toUpperCase(), aggregator: detectAggregator(event.target.value) || draft.aggregator } })} /></label>
                <label>Agregador<select value={draft.aggregator} disabled={busy || !photo} onChange={event => setDrafts({ ...drafts, [item.photo_id]: { ...draft, aggregator: event.target.value } })}><option value="">Elegir agregador</option>{AGGREGATOR_OPTIONS.map(agg => <option key={agg.id} value={agg.id}>{agg.label}</option>)}</select></label></div>
                <p className="settings__caption">Actual: {photo ? photo.name === UNIDENTIFIED_ORDER_NAME ? 'Sin código' : `${photo.name} · ${getAggregatorLabel(photo.aggregator)}` : '—'} · {item.source || 'evidencia'}</p>
                <div className="settings__item-actions"><button className="btn btn--small btn--primary" disabled={busy || !photo || !draft.code.trim() || !draft.aggregator} onClick={() => applyProposal(item)}>{item.status === 'proposed' ? 'Confirmar' : 'Guardar corrección'}</button>
                  {item.status !== 'manual_override' && <button className="btn btn--small btn--ghost" disabled={busy || !photo} onClick={() => applyProposal(item, true)}>{item.status === 'proposed' ? 'Descartar propuesta' : 'Volver a Sin código'}</button>}
                </div>
                <details className="settings__help" onToggle={event => { if (event.currentTarget.open && !events[item.photo_id]) void showEvents(item.photo_id); }}><summary>Registro de cambios</summary>
                  {eventErrors[item.photo_id] ? <><Feedback error={eventErrors[item.photo_id]} /><button className="btn btn--ghost btn--small" onClick={() => void showEvents(item.photo_id)}>Reintentar registro</button></> : events[item.photo_id] ? events[item.photo_id].length ? events[item.photo_id].map(entry => <p key={entry.id}>{argentinaDate(entry.created_at)} · {entry.kind} · {entry.old_code || 'Sin código'} → {entry.new_code || 'Sin código'}
                    {entry.details?.readings?.length > 0 && ` · Lecturas: ${entry.details.readings.map(reading => `${reading.source}: ${reading.code || 'sin código'}`).join(', ')}`}{entry.details?.message && ` · ${entry.details.message}`}</p>) : <p>Sin cambios registrados.</p> : <p>Cargando registro…</p>}
                </details>
              </div>
            </div>
          </details>;
        })}</div>
        {filteredItems.length > PAGE_SIZE && <nav className="settings__pagination" aria-label="Páginas de revisión"><button className="btn btn--ghost btn--small" disabled={currentPage === 1} onClick={() => setReviewPage(currentPage - 1)}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className="btn btn--ghost btn--small" disabled={currentPage === pageCount} onClick={() => setReviewPage(currentPage + 1)}>Siguiente</button></nav>}
        <details className="settings__help settings__run-detail"><summary>Uso y últimas ejecuciones</summary>
          {progress && <><p>Google Vision: {formatNumber(progress.usage)} / 6.000 imágenes este mes UTC. La tarea se detiene en 5.500.</p>
            {progress.runs.length ? progress.runs.map(run => <div className="settings__run" key={run.day}><strong>{run.day.split('-').reverse().join('/')} · {run.status === 'complete' && Number(run.failed) > 0 ? 'Terminada con errores' : RUN_STATUS[run.status] || run.status}</strong><p>{run.analyzed} analizados · {run.proposed} propuestos · {run.confirmed} confirmados · {run.no_code} sin lectura · {run.failed} errores</p>{run.last_error && <p className="settings__run-warning">{run.last_error}</p>}</div>) : <p>Todavía no hay ejecuciones programadas.</p>}</>}
        </details>
      </section>}

      {category === 'storage' && <div className="settings__stack settings__storage-layout">
        <StoragePanel retention={retention} refreshKey={storageRefresh} loadUsage={dataSource.loadStorageUsage} />
        <section className="settings__card">
          <div className="settings__block-head"><div><h3>Conservación de fotos</h3><p>Liberá espacio automáticamente después del plazo elegido.</p></div><span className="settings__scope">Compartido</span></div>
          {!retentionDraft ? <p>{loadErrors.retention ? 'Configuración no disponible.' : 'Cargando configuración…'}</p> : <form onSubmit={saveRetention}>
            <label className="settings__switch"><span>Activar limpieza automática</span><input type="checkbox" role="switch" disabled={busy || retentionCounting} checked={retentionDraft.enabled} onChange={event => editDraft('retention', setRetentionDraft, retentionDraft, { enabled: event.target.checked })} /></label>
            <label className="settings__retention-field"><span>Conservar fotos sin queja durante</span><span className="settings__days-field"><input type="number" aria-label="Días de conservación de fotos" min={PHOTO_RETENTION_MIN_DAYS} max={PHOTO_RETENTION_MAX_DAYS} required disabled={busy || retentionCounting} value={retentionDraft.retention_days} onChange={event => editDraft('retention', setRetentionDraft, retentionDraft, { retention_days: event.target.value })} /><span aria-hidden="true">días</span></span></label>
            <p className="settings__protection">Las fotos de reclamos, refutadas, evidencias y pedidos sin código quedan protegidas. Se conservan los pedidos y sus métricas.</p>
            <details className="settings__help"><summary>Qué se elimina y cuándo</summary><p>Se elimina solo el archivo de las fotos elegibles al superar el plazo. Los registros de pedidos permanecen guardados. Los tickets se liberan a las 72 horas. La limpieza manual usa su propia fecha y no cambia este plazo.</p></details>
            <div className="settings__form-footer"><span>{changed('retention', retentionDraft) ? 'Cambios sin guardar' : retention?.last_run_at ? `Última limpieza: ${argentinaDate(retention.last_run_at)} · ${formatNumber(retention.last_removed)} fotos` : 'Sin limpiezas automáticas registradas'}</span><button className="btn btn--primary btn--small" disabled={busy || retentionCounting || !changed('retention', retentionDraft)}>{retentionCounting ? 'Calculando fotos…' : busy && feedbackScope === 'retention' ? 'Guardando…' : 'Guardar conservación'}</button></div>
          </form>}{feedback('retention')}
        </section>
        <section className="settings__card settings__manual-cleanup"><div><h3>Limpieza manual</h3><p>Elegí hasta qué fecha liberar imágenes. Antes de borrar, vas a ver la cantidad y confirmar la acción.</p></div><button className="btn btn--danger btn--small" disabled={busy || retentionCounting} onClick={() => setCleanupOpen(true)}>Elegir fecha y limpiar</button></section>
      </div>}

      {category === 'general' && <section className="settings__card settings__general">
        <div className="settings__general-row"><div><h3>Apariencia</h3><p>El tema se guarda en este dispositivo.</p></div><div className="settings__theme" role="group" aria-label="Tema de la app">{[{ id: 'light', label: 'Claro' }, { id: 'dark', label: 'Oscuro' }].map(item => <button key={item.id} aria-pressed={theme === item.id} className={theme === item.id ? 'is-active' : ''} onClick={() => onThemeChange(item.id)}>{item.label}</button>)}</div></div>
        <div className="settings__general-row"><div><h3>Manual de uso</h3><p>Fotos, galería, reclamos y refutaciones. Podés guardarlo como PDF.</p></div><a className="btn btn--ghost btn--small" href={`${import.meta.env.BASE_URL}manual/index.html`} target="_blank" rel="noopener noreferrer">Abrir manual ↗</a></div>
        <div className="settings__general-row"><div><h3>STAR-APP Delivery <span className="settings__version-pill">v{APP_VERSION}</span></h3><p>Local: La Plata · Versión instalada</p></div><button ref={releaseButtonRef} className="btn btn--ghost btn--small" onClick={() => setReleaseOpen(true)}>Ver novedades</button></div>
      </section>}

      {category === 'admin' && <section className="settings__card settings__administration">
        <span className="settings__danger-label">Acción permanente</span><h3>Vaciar historial de reclamos</h3><p>Elimina los casos de todos los períodos, sus estados y sus importes. Esto modifica las métricas económicas compartidas del local.</p><p>Las fotos y los totales diarios se conservan.</p>
        <button className="btn btn--danger" disabled={busy} onClick={clearHistory}>{busy && feedbackScope === 'admin' ? 'Procesando…' : 'Vaciar historial de reclamos'}</button>{feedback('admin')}
      </section>}
      {retentionPreview && <PhotoRetentionConfirmModal days={retentionPreview.days} currentDays={retentionPreview.currentDays} count={retentionPreview.count} currentCount={retentionPreview.currentCount} countFailed={retentionPreview.countFailed} enabled={retentionPreview.enabled} onConfirm={confirmRetentionPreview} onClose={() => setRetentionPreview(null)} />}
      {cleanupOpen && <PhotoCleanupModal previewCleanup={dataSource.previewPhotoCleanup} removeFiles={dataSource.removePhotoFiles} onClose={() => { setCleanupOpen(false); setStorageRefresh(value => value + 1); }} />}
      {lightboxPhoto && <PhotoLightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />}
      {releaseOpen && <Dialog variant="wide" labelledBy="release-modal-title" onClose={() => setReleaseOpen(false)}>
        <section className="release-modal__dialog settings__release"><div className="release-modal__head"><h2 id="release-modal-title">Novedades de la versión {APP_VERSION}</h2><button ref={releaseCloseRef} className="btn btn--ghost btn--small" onClick={() => setReleaseOpen(false)} aria-label="Cerrar novedades">Cerrar</button></div><div>{RELEASE_GROUPS.map(group => <section className="release-modal__group" key={group.title}><h3>{group.title}</h3><ul>{group.notes.map(note => <li key={note}>{note}</li>)}</ul></section>)}</div></section>
      </Dialog>}
    </section>
  );
}
