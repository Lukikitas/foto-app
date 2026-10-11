import { subscribePeyaImport } from '../lib/peyaImportService';
import { useEffect, useMemo, useState } from 'react';
import {
  cachedComplaintHistory,
  complaintHistoryReadStatus,
  deleteHistoryItemById,
  loadComplaintHistory,
  setHistoryPhoto,
  subscribeComplaintHistory,
} from '../lib/complaintHistoryStore';
import MetricsQualityPanel from './MetricsQualityPanel';
import { metricsReadStatus } from '../lib/metricsStore';
import { confirmAction } from '../lib/confirmAction';
import { argentinaToday, emptyStore, METRIC_PAGE_TABS, resolvePeriod } from '../lib/metrics';
import {
  getMetricsView,
  getSavedPeriod,
  loadMetricsStore,
  saveMetricsStore,
  saveMetricsView,
  savePeriod,
} from '../lib/metricsStore';
import MetricsComplaintsList from './MetricsComplaintsList';
import MetricsDashboard, { MetricsPeriodBar } from './MetricsDashboard';
import MetricsEntry from './MetricsEntry';
import MetricsReport from './MetricsReport';
import MetricsStaff from './MetricsStaff';

function useMetricsPeriod() {
  const savedPeriod = getSavedPeriod();
  const [preset, setPreset] = useState(savedPeriod.preset || 'week');
  const [customFrom, setCustomFrom] = useState(savedPeriod.customFrom || '');
  const [customTo, setCustomTo] = useState(savedPeriod.customTo || '');
  const today = argentinaToday();
  const period = useMemo(
    () => resolvePeriod(preset, today, customFrom, customTo),
    [preset, today, customFrom, customTo],
  );

  function applyPreset(id) {
    setPreset(id);
    savePeriod({ preset: id, customFrom, customTo });
    if (id === 'custom') {
      const next = resolvePeriod(preset === 'custom' ? 'week' : preset, today, customFrom, customTo);
      setCustomFrom(customFrom || next.from);
      setCustomTo(customTo || next.to);
    }
  }

  function changeCustomFrom(value) {
    setCustomFrom(value);
    savePeriod({ preset, customFrom: value, customTo });
  }

  function changeCustomTo(value) {
    setCustomTo(value);
    savePeriod({ preset, customFrom, customTo: value });
  }

  return {
    preset,
    customFrom,
    customTo,
    period,
    applyPreset,
    changeCustomFrom,
    changeCustomTo,
  };
}

export default function MetricsPage({ onManage, onDirtyChange, refreshKey = 0, entryRequest }) {
  const [view, setView] = useState(getMetricsView);
  const [store, setStore] = useState(emptyStore);
  const [history, setHistory] = useState(cachedComplaintHistory);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [focusDay, setFocusDay] = useState('');
  const [caseStatus, setCaseStatus] = useState('all');
  const [dirty, setDirty] = useState(false);
  const [readStatus, setReadStatus] = useState({});
  const [aggregator, setAggregator] = useState('all');
  const periodState = useMetricsPeriod();
  const range = focusDay ? { from: focusDay, to: focusDay } : periodState.period;
  const hasData = useMemo(() => Object.keys(store.days || {}).length > 0, [store]);

  useEffect(() => {
    if (!entryRequest) return;
    const timer = window.setTimeout(() => { setView('entry'); saveMetricsView('entry'); setNotice(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [entryRequest]);

  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty,onDirtyChange]);
  useEffect(() => subscribeComplaintHistory(setHistory), []);
  useEffect(() => {
    let cancelled = false;
    const off = subscribePeyaImport(result => {
      if (!result?.metricsSaved) return;
      if (result.metrics) {
        setStore(result.metrics);
        return;
      }
      // An already-committed import can lack a snapshot. Keep the current
      // store while reading the saved metrics instead of rendering undefined.
      loadMetricsStore({ strict: true }).then(next => {
        if (!cancelled) setStore(next);
      }).catch(() => {
        if (!cancelled) setError('Los datos se guardaron; no se pudo actualizar la vista de métricas. Volvé a intentar desde Métricas.');
      });
    });
    return () => { cancelled = true; off(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextStore = await loadMetricsStore();
        await loadComplaintHistory({force:true});
        if (!cancelled) { setStore(nextStore); setReadStatus(metricsReadStatus()); }
      } catch (err) {
        if (!cancelled) setError(err.message || 'No se pudieron leer las métricas.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!refreshKey) return undefined;
    let cancelled = false;
    loadMetricsStore({strict:true}).then(next=>{if(!cancelled){setStore(next);setReadStatus(metricsReadStatus());}}).catch(err=>{if(!cancelled)setError(err.message || 'No se pudieron actualizar los objetivos.');});
    return ()=>{cancelled=true;};
  },[refreshKey]);

  async function changeView(next) {
    if (dirty && next !== view && !await confirmAction('Hay cambios sin guardar. ¿Querés cambiar de sección y descartar el borrador?', {danger:false, title:'Cambios pendientes', confirmLabel:'Salir sin guardar'})) return;
    setDirty(false);
    setView(next);
    saveMetricsView(next);
    setNotice(null);
  }

  async function persist(next, message) {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMetricsStore(next);
      setStore(saved); setReadStatus(metricsReadStatus());
      if (message) setNotice(message);
      return true;
    } catch (err) {
      setError(err.message || 'No se pudieron guardar las métricas.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function persistHistory(job, message) {
    setSaving(true);
    setError(null);
    try {
      const saved = await job();
      const next = saved?.store || saved;
      setHistory(next);
      if (message) setNotice(message);
      return true;
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el historial de quejas.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="metrics">
      <header className="metrics__header">
        <div>
          <h2 className="gallery__title">Métricas</h2>
          <p className="metrics__lead">
            Operación y recuperaciones · consultá los totales, revisá sus fuentes y abrí el detalle.
          </p>
        </div>
        <div className="tab-bar metrics__views metrics__views--tabs" role="tablist" aria-label="Métricas">
          {METRIC_PAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab-bar__btn${view === tab.id ? ' tab-bar__btn--active' : ''}`}
              onClick={() => changeView(tab.id)}
              role="tab"
              aria-selected={view === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message message--success" role="status">
          {notice}
        </p>
      )}

      <div className="metrics-refresh"><span>{readStatus.cached || complaintHistoryReadStatus().cached ? '⚠ Datos de caché; no se pudo consultar el servidor. ' : 'Datos compartidos · '}{store.updatedAt ? 'Actualizados '+new Date(store.updatedAt).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}) : 'Sin fecha de actualización'}</span>
        <button className="btn btn--ghost btn--small" disabled={loading || saving} onClick={async()=>{
          setSaving(true); setError(null);
          try { const next=await loadMetricsStore({strict:true}); await loadComplaintHistory({force:true,strict:true}); setStore(next); setReadStatus(metricsReadStatus()); }
          catch(err){setError(err.message || 'No se pudo actualizar. Se conserva la vista actual.');}
          finally{setSaving(false);}
        }}>Actualizar</button></div>
      {loading ? (
        <div className="gallery__state">
          <div className="spinner" aria-hidden="true" />
          <p>Cargando métricas…</p>
        </div>
      ) : (
        <>
          {view !== 'entry' && (
            <MetricsPeriodBar
              preset={periodState.preset}
              customFrom={periodState.customFrom}
              customTo={periodState.customTo}
              period={periodState.period}
              focusDay={focusDay}
              aggregator={aggregator}
              onPreset={(id) => {
                periodState.applyPreset(id);
                setFocusDay('');
              }}
              onCustomFrom={value=>{periodState.changeCustomFrom(value);setFocusDay('');}}
              onCustomTo={value=>{periodState.changeCustomTo(value);setFocusDay('');}}
              onAggregator={setAggregator}
              onClearDay={() => setFocusDay('')}
            />
          )}
          {view === 'entry' ? (
            <MetricsEntry entryRequest={entryRequest} store={store} saving={saving} onSave={persist} onImportBusy={setSaving} onDirty={setDirty} onManage={onManage} />
          ) : view === 'staff' ? (
            <MetricsStaff history={history} range={range} aggregator={aggregator} store={store} onSave={persist} onManage={onManage} />
          ) : view === 'complaints' ? (
            <MetricsComplaintsList
              history={history}
              range={range}
              aggregator={aggregator}
              busy={saving}
              initialStatus={caseStatus} store={store} onManage={onManage}
              onDelete={(id) => persistHistory(() => deleteHistoryItemById(id), 'Queja borrada.')}
              onPhoto={(item, photo) => persistHistory(() => setHistoryPhoto(item, photo))}
              onError={setError}
              onNotice={setNotice}
            />
          ) : view === 'report' ? (
            <MetricsReport history={history} range={range} aggregator={aggregator} store={store} preset={focusDay ? "" : periodState.preset} />
          ) : (
            <MetricsDashboard
              store={store}
              history={history}
              hasData={hasData}
              period={periodState.period}
              focusDay={focusDay}
              aggregator={aggregator}
              preset={periodState.preset}
              onCases={status=>{setCaseStatus(status);changeView('complaints');}}
              onChangeView={changeView}
              onFocusDay={setFocusDay}
              onAggregator={setAggregator}
            />
          )}
          {view !== 'entry' && view !== 'overview' && <MetricsQualityPanel store={store} history={history} range={range} aggregator={aggregator}/>}
        </>
      )}
    </section>
  );
}
