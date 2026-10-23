import { subscribePeyaImport } from '../lib/peyaImportService';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  complaintHistoryReadStatus,
  deleteHistoryItemById,
  setHistoryPhoto,
  subscribeComplaintHistory,
} from '../lib/complaintHistoryStore';
import MetricsQualityPanel from './MetricsQualityPanel';
import { metricsReadStatus } from '../lib/metricsStore';
import { confirmAction } from '../lib/confirmAction';
import { argentinaToday, emptyStore, METRIC_PAGE_TABS, resolveAvailablePeriod } from '../lib/metrics';
import { emptyHistory } from '../lib/complaintHistory';
import { loadPerformanceData } from '../lib/performanceData';
import {
  getMetricsView,
  getSavedPeriod,
  loadMetricsStore,
  loadMetricsHeader,
  rememberMetricsView,
  saveMetricsStore,
  saveMetricsView,
  savePeriod,
} from '../lib/metricsStore';
import MetricsComplaintsList from './MetricsComplaintsList';
import MetricsDashboard, { MetricsPeriodBar } from './MetricsDashboard';
const MetricsEntry = lazy(() => import('./MetricsEntry'));
const MetricsReport = lazy(() => import('./MetricsReport'));
const MetricsStaff = lazy(() => import('./MetricsStaff'));

function useMetricsPeriod(store) {
  const savedPeriod = getSavedPeriod();
  const [preset, setPreset] = useState(savedPeriod.preset || 'week');
  const [customFrom, setCustomFrom] = useState(savedPeriod.customFrom || '');
  const [customTo, setCustomTo] = useState(savedPeriod.customTo || '');
  const today = argentinaToday();
  const period = useMemo(
    () => resolveAvailablePeriod(preset, store, today, customFrom, customTo),
    [preset, store, today, customFrom, customTo],
  );

  function applyPreset(id) {
    setPreset(id);
    savePeriod({ preset: id, customFrom, customTo });
    if (id === 'custom') {
      const next = resolveAvailablePeriod(preset === 'custom' ? 'week' : preset, store, today, customFrom, customTo);
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
    endsAtLastLoadedDay: ['week', 'month', 'days7'].includes(preset) && period.to < today,
    applyPreset,
    changeCustomFrom,
    changeCustomTo,
  };
}

export default function MetricsPage({ active = true, onManage, onDirtyChange, refreshKey = 0, entryRequest }) {
  const [view, setView] = useState(getMetricsView);
  const [store, setStore] = useState(emptyStore);
  const [header, setHeader] = useState(emptyStore);
  const [history, setHistory] = useState(emptyHistory);
  const [remote, setRemote] = useState(null);
  const [verified, setVerified] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [focusDay, setFocusDay] = useState('');
  const [caseStatus, setCaseStatus] = useState('all');
  const [dirty, setDirty] = useState(false);
  const [readStatus, setReadStatus] = useState({});
  const [aggregator, setAggregator] = useState('all');
  const periodState = useMetricsPeriod(header);
  const range = focusDay ? { from: focusDay, to: focusDay } : periodState.period;
  const hasData = useMemo(() => Object.keys(store.days || {}).length > 0, [store]);
  const viewKey = `${view}|${range.from}|${range.to}|${aggregator}|${periodState.preset}|${reload}|${refreshKey}`;
  const viewLoading = view !== 'entry' && (!verified || remote?.key !== viewKey);

  useEffect(() => {
    if (!entryRequest) return;
    const timer = window.setTimeout(() => { setView('entry'); saveMetricsView('entry'); setNotice(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [entryRequest]);

  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty,onDirtyChange]);
  useEffect(() => active ? subscribeComplaintHistory(() => setReload(value => value + 1)) : undefined, [active]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const off = subscribePeyaImport(result => {
      if (!result?.metricsSaved) return;
      if (result.metrics) {
        setStore(result.metrics);
        setReload(value => value + 1);
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
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (view === 'entry' && dirty) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextStore = await (view === 'entry' ? loadMetricsStore({ strict: true }) : loadMetricsHeader());
        if (!cancelled) { setHeader(nextStore); if (view === 'entry') setStore(nextStore); setReadStatus(metricsReadStatus()); }
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
  }, [active, view, dirty, refreshKey]);

  useEffect(() => {
    if (!active || view === 'entry') return;
    const controller = new AbortController();
    void loadPerformanceData({ view, from: range.from, to: range.to, aggregator, preset: focusDay ? '' : periodState.preset }, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        setStore(rememberMetricsView(data.metrics));
        setHistory(data.history || emptyHistory());
        setRemote({ key: viewKey, data });
        setVerified(true);
      }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { controller.abort(); setVerified(false); };
  }, [active, view, viewKey, range.from, range.to, aggregator, focusDay, periodState.preset]);

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
      setStore(saved); setHeader(saved); setReadStatus(metricsReadStatus());
      setReload(value => value + 1);
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
      setReload(value => value + 1);
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
          try { const next=await (view === 'entry' ? loadMetricsStore({strict:true}) : loadMetricsHeader()); setHeader(next); if (view === 'entry') setStore(next); setReload(value => value + 1); setReadStatus(metricsReadStatus()); }
          catch(err){setError(err.message || 'No se pudo actualizar. Se conserva la vista actual.');}
          finally{setSaving(false);}
        }}>Actualizar</button></div>
      <Suspense fallback={<p className="gallery__state">Cargando sección…</p>}>
      {((loading && !dirty) || viewLoading) && (
        <div className="gallery__state">
          <div className="spinner" aria-hidden="true" />
          <p>Cargando métricas…</p>
        </div>
      )}
      <div hidden={(loading && !dirty) || viewLoading}>
        <>
          {view !== 'entry' && (
            <MetricsPeriodBar
              preset={periodState.preset}
              customFrom={periodState.customFrom}
              customTo={periodState.customTo}
              period={periodState.period}
              endsAtLastLoadedDay={periodState.endsAtLastLoadedDay}
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
            <MetricsStaff history={history} range={range} aggregator={aggregator} store={store} onSave={persist} onManage={onManage} remoteReport={remote?.data.staff} remoteVariants={remote?.data.variants} serverMode />
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
            <MetricsReport history={history} range={range} aggregator={aggregator} store={store} preset={focusDay ? "" : periodState.preset} remoteReport={remote?.data.report} remoteTrend={remote?.data.trend} />
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
      </div>
      </Suspense>
    </section>
  );
}
