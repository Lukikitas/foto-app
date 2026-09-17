import { useEffect, useMemo, useState } from 'react';
import { emptyStore, METRIC_PAGE_TABS } from '../lib/metrics';
import {
  getMetricsView,
  loadMetricsStore,
  saveMetricsStore,
  saveMetricsView,
} from '../lib/metricsStore';
import MetricsDashboard from './MetricsDashboard';
import MetricsEntry from './MetricsEntry';

export default function MetricsPage() {
  const [view, setView] = useState(getMetricsView);
  const [store, setStore] = useState(emptyStore);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const next = await loadMetricsStore();
        if (!cancelled) setStore(next);
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

  const hasData = useMemo(() => Object.keys(store.days || {}).length > 0, [store]);

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

  return (
    <section className="metrics">
      <header className="metrics__header">
        <div>
          <h2 className="gallery__title">Métricas</h2>
          <p className="metrics__lead">
            Cada agregador se mide solo, sobre sus propios pedidos. PedidosYa también muestra AWT
            (demorados).
          </p>
        </div>
        <div className="metrics__views metrics__views--tabs" role="tablist" aria-label="Agregadores">
          {METRIC_PAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`gallery__view-btn${view === tab.id ? ' gallery__view-btn--active' : ''}`}
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
      ) : view === 'entry' ? (
        <MetricsEntry store={store} saving={saving} onSave={persist} />
      ) : (
        <MetricsDashboard
          store={store}
          hasData={hasData}
          saving={saving}
          view={view}
          onSave={persist}
          onChangeView={changeView}
        />
      )}
    </section>
  );
}
