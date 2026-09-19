import { useEffect, useMemo, useState } from 'react';
import {
  cachedComplaintHistory,
  clearComplaintHistory,
  deleteHistoryItemById,
  loadComplaintHistory,
  setHistoryPhoto,
  subscribeComplaintHistory,
} from '../lib/complaintHistoryStore';
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

export default function MetricsPage() {
  const [view, setView] = useState(getMetricsView);
  const [store, setStore] = useState(emptyStore);
  const [history, setHistory] = useState(cachedComplaintHistory);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [focusDay, setFocusDay] = useState('');
  const [aggregator, setAggregator] = useState('all');
  const periodState = useMetricsPeriod();
  const range = focusDay ? { from: focusDay, to: focusDay } : periodState.period;
  const hasData = useMemo(() => Object.keys(store.days || {}).length > 0, [store]);

  useEffect(() => subscribeComplaintHistory(setHistory), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextStore = await loadMetricsStore();
        await loadComplaintHistory();
        if (!cancelled) setStore(nextStore);
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

  function changeView(next) {
    setView(next);
    saveMetricsView(next);
    setNotice(null);
  }

  async function persist(next, message) {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveMetricsStore(next);
      setStore(saved);
      if (message) setNotice(message);
    } catch (err) {
      setError(err.message || 'No se pudieron guardar las métricas.');
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
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el historial de quejas.');
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
            Pedidos y AWT se cargan por día. La plata perdida y recuperada sale de cada queja del
            Excel.
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

      {loading ? (
        <div className="gallery__state">
          <div className="spinner" aria-hidden="true" />
          <p>Cargando métricas…</p>
        </div>
      ) : (
        <>
          {view !== 'entry' && (
            <MetricsPeriodBar
              store={store}
              saving={saving}
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
              onCustomFrom={periodState.changeCustomFrom}
              onCustomTo={periodState.changeCustomTo}
              onAggregator={setAggregator}
              onClearDay={() => setFocusDay('')}
              onSave={persist}
            />
          )}
          {view === 'entry' ? (
            <MetricsEntry store={store} saving={saving} onSave={persist} />
          ) : view === 'complaints' ? (
            <MetricsComplaintsList
              history={history}
              range={range}
              aggregator={aggregator}
              busy={saving}
              onDelete={(id) => persistHistory(() => deleteHistoryItemById(id), 'Queja borrada.')}
              onClear={() => persistHistory(() => clearComplaintHistory(), 'Historial de quejas vacío.')}
              onPhoto={(item, photo) => persistHistory(() => setHistoryPhoto(item, photo))}
              onError={setError}
              onNotice={setNotice}
            />
          ) : view === 'report' ? (
            <MetricsReport history={history} range={range} aggregator={aggregator} />
          ) : (
            <MetricsDashboard
              store={store}
              history={history}
              hasData={hasData}
              period={periodState.period}
              focusDay={focusDay}
              aggregator={aggregator}
              onChangeView={changeView}
              onFocusDay={setFocusDay}
              onAggregator={setAggregator}
            />
          )}
        </>
      )}
    </section>
  );
}
