import { useCallback, useEffect, useState } from 'react';
import { AGGREGATOR_OPTIONS, detectAggregator, getAggregatorLabel } from '../lib/aggregators';
import { setTargetAwtPct, setTargetComplaintPct } from '../lib/metrics';
import { loadMetricsStore, saveMetricsStore } from '../lib/metricsStore';
import { fetchPhotosByIds, UNIDENTIFIED_ORDER_NAME } from '../lib/photos';
import {
  RECOVERY_MODES, confirmRecoveredCode, loadRecoveryEvents,
  loadRecoveryProgress, loadRecoverySettings, saveRecoverySettings,
} from '../lib/recoverySettings';

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

export default function SettingsPage({ theme, onThemeChange, onTargetsSaved }) {
  const [settings, setSettings] = useState(null);
  const [targets, setTargets] = useState(null);
  const [progress, setProgress] = useState(null);
  const [photos, setPhotos] = useState({});
  const [drafts, setDrafts] = useState({});
  const [events, setEvents] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshProgress = useCallback(async () => {
    const nextProgress = await loadRecoveryProgress();
    const items = nextProgress.proposals;
    const found = await fetchPhotosByIds(items.map((item) => item.photo_id));
    setProgress(nextProgress);
    setPhotos(Object.fromEntries(found.map((photo) => [photo.id, photo])));
    setDrafts((current) => Object.fromEntries(items.map((item) => [
      item.photo_id, current[item.photo_id] || {
        code: item.code || '',
        aggregator: item.aggregator || detectAggregator(item.code) || '',
      },
    ])));
  }, []);

  const refresh = useCallback(async () => {
    const [nextSettings, nextTargets] = await Promise.all([
      loadRecoverySettings(), loadMetricsStore(),
    ]);
    setSettings(nextSettings);
    setTargets(nextTargets);
    await refreshProgress();
  }, [refreshProgress]);

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
    const timer = window.setInterval(() => {
      refreshProgress().catch((failure) => setError(failure.message || 'No se pudo actualizar el progreso.'));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshProgress]);

  async function saveOperation(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await saveRecoverySettings({
        enabled: settings.enabled,
        start_time: settings.start_time,
        mode: settings.mode,
      });
      setSettings(saved);
      setNotice('Revisión automática actualizada.');
    } catch (failure) {
      setError(failure.message || 'No se pudieron guardar los ajustes.');
    } finally { setBusy(false); }
  }

  async function saveTargets(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      let current = await loadMetricsStore({ strict: true });
      current = setTargetComplaintPct(current, targets.targetComplaintPct);
      current = setTargetAwtPct(current, targets.targetAwtPct);
      const saved = await saveMetricsStore(current);
      setTargets(saved);
      onTargetsSaved();
      setNotice('Objetivos actualizados.');
    } catch (failure) {
      setError(failure.message || 'No se pudieron guardar los objetivos.');
    } finally { setBusy(false); }
  }

  async function applyProposal(item, clear = false) {
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
    try {
      const history = await loadRecoveryEvents(photoId);
      setEvents((current) => ({ ...current, [photoId]: history }));
    } catch (failure) {
      setError(failure.message || 'No se pudo leer el historial.');
    }
  }

  return (
    <section className="settings">
      <header className="settings__header"><h2>Ajustes</h2><p>Preferencias y revisión de pedidos sin código.</p></header>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {notice && <p className="message message--success" role="status">{notice}</p>}

      <div className="settings__grid">
        <section className="settings__card">
          <h3>Revisión automática de “Sin código”</h3>
          {!settings ? <p>Cargando…</p> : (
            <form onSubmit={saveOperation}>
              <label className="settings__check"><input type="checkbox" checked={settings.enabled}
                onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
                Activar revisión diaria
              </label>
              <label>Hora de inicio · Argentina
                <input type="time" required value={String(settings.start_time).slice(0, 5)}
                  onChange={(event) => setSettings({ ...settings, start_time: event.target.value })} />
              </label>
              <label>Acción
                <select value={settings.mode}
                  onChange={(event) => setSettings({ ...settings, mode: event.target.value })}>
                  {RECOVERY_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                </select>
              </label>
              <p>Las propuestas dudosas quedan para revisión manual. La tarea continúa en el servidor con la app cerrada.</p>
              <button className="btn btn--primary" disabled={busy}>Guardar revisión</button>
            </form>
          )}
        </section>

        <section className="settings__card">
          <h3>Objetivos de Métricas</h3>
          {!targets ? <p>Cargando…</p> : (
            <form onSubmit={saveTargets}>
              <label>Quejas · % máximo
                <input type="number" min="0" max="100" step="0.1" required
                  value={targets.targetComplaintPct}
                  onChange={(event) => setTargets({ ...targets, targetComplaintPct: event.target.value })} />
              </label>
              <label>AWT PedidosYa · % máximo
                <input type="number" min="0" max="100" step="0.1" required
                  value={targets.targetAwtPct}
                  onChange={(event) => setTargets({ ...targets, targetAwtPct: event.target.value })} />
              </label>
              <button className="btn btn--primary" disabled={busy}>Guardar objetivos</button>
            </form>
          )}
        </section>

        <section className="settings__card">
          <h3>Apariencia</h3>
          <label>Tema
            <select value={theme} onChange={(event) => onThemeChange(event.target.value)}>
              <option value="light">Claro</option><option value="dark">Oscuro</option>
            </select>
          </label>
          <p>Esta preferencia se guarda en este dispositivo.</p>
        </section>
      </div>

      <section className="settings__card">
        <div className="settings__section-head">
          <h3>Progreso y revisión</h3>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => {
            refresh().catch((failure) => setError(failure.message));
          }}>Actualizar</button>
        </div>
        {progress && (
          <>
            <p>Google Vision: {progress.usage.toLocaleString('es-AR')} / 6.000 imágenes este mes UTC.
              La tarea automática se detiene en 5.500.</p>
            <p>{progress.pending} pedidos todavía sin código ·
              {' '}{progress.proposals.filter((item) => item.status === 'proposed').length} propuestas recientes pendientes.</p>
            {progress.runs.length ? progress.runs.map((run) => (
              <p key={run.day}>{run.day} · {RUN_STATUS[run.status] || run.status} · {run.analyzed} analizados ·
                {' '}{run.proposed} propuestos · {run.confirmed} confirmados ·
                {' '}{run.no_code} sin lectura · {run.failed} errores
                {run.last_error ? ` · ${run.last_error}` : ''}</p>
            )) : <p>Todavía no hay ejecuciones programadas.</p>}
            <div className="settings__results">
              {progress.proposals.map((item) => {
                const photo = photos[item.photo_id];
                if (!photo) return null;
                const draft = drafts[item.photo_id] || { code: '', aggregator: '' };
                return (
                  <article className="settings__result" key={item.photo_id}>
                    <a href={photo.public_url} target="_blank" rel="noreferrer">
                      <img src={photo.public_url} alt="Foto del pedido analizado" loading="lazy" />
                    </a>
                    <div>
                      <strong>{item.status === 'confirmed' ? 'Confirmado' :
                        item.status === 'manual_override' ? 'Corregido manualmente' : 'Propuesta pendiente'}</strong>
                      <small>{item.source || 'evidencia'} · {argentinaDate(item.analyzed_at)}</small>
                      <label>Código
                        <input value={draft.code} onChange={(event) => setDrafts({
                          ...drafts, [item.photo_id]: {
                            ...draft, code: event.target.value.toUpperCase(),
                            aggregator: detectAggregator(event.target.value) || draft.aggregator,
                          },
                        })} />
                      </label>
                      <label>Agregador
                        <select value={draft.aggregator} onChange={(event) => setDrafts({
                          ...drafts, [item.photo_id]: { ...draft, aggregator: event.target.value },
                        })}>
                          <option value="">Elegir agregador</option>
                          {AGGREGATOR_OPTIONS.map((agg) => <option key={agg.id} value={agg.id}>{agg.label}</option>)}
                        </select>
                      </label>
                      <p>Actual: {photo.name === UNIDENTIFIED_ORDER_NAME
                        ? 'Sin código' : `${photo.name} · ${getAggregatorLabel(photo.aggregator)}`}</p>
                      <button type="button" className="btn btn--small btn--primary" disabled={busy}
                        onClick={() => applyProposal(item)}>
                        {item.status === 'confirmed' || item.status === 'manual_override' ? 'Corregir' : 'Confirmar'}
                      </button>
                      {item.status === 'proposed' && <button type="button"
                        className="btn btn--small btn--ghost" disabled={busy}
                        onClick={() => applyProposal(item, true)}>Descartar propuesta</button>}
                      {item.status === 'confirmed' && <button type="button"
                        className="btn btn--small btn--ghost" disabled={busy}
                        onClick={() => applyProposal(item, true)}>Volver a Sin código</button>}
                      <button type="button" className="btn btn--small btn--ghost"
                        onClick={() => showEvents(item.photo_id)}>Ver registro</button>
                      {events[item.photo_id]?.map((entry) => <p key={entry.id}>
                        {argentinaDate(entry.created_at)} · {entry.kind} ·
                        {' '}{entry.old_code || 'Sin código'} → {entry.new_code || 'Sin código'}
                        {entry.details?.readings?.length > 0 && ` · Lecturas: ${entry.details.readings.map(
                          (reading) => `${reading.source}: ${reading.code || 'sin código'}`,
                        ).join(', ')}`}
                        {entry.details?.message && ` · ${entry.details.message}`}
                      </p>)}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </section>
  );
}
