import { useEffect, useMemo, useState } from 'react';
import { emptyStore } from '../lib/metrics';
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
            Cargá pedidos y quejas por día. El tablero te muestra el % contra el objetivo y
            cuántas se refutaron.
          </p>
        </div>
        <div className="metrics__views" role="tablist" aria-label="Secciones de métricas">
          <button
            type="button"
            className={`gallery__view-btn${view === 'dashboard' ? ' gallery__view-btn--active' : ''}`}
            onClick={() => changeView('dashboard')}
            role="tab"
            aria-selected={view === 'dashboard'}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`gallery__view-btn${view === 'entry' ? ' gallery__view-btn--active' : ''}`}
            onClick={() => changeView('entry')}
            role="tab"
            aria-selected={view === 'entry'}
          >
            Cargar
          </button>
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
      ) : view === 'dashboard' ? (
        <MetricsDashboard
          store={store}
          hasData={hasData}
          saving={saving}
          onSave={persist}
          onGoToEntry={() => changeView('entry')}
        />
      ) : (
        <MetricsEntry store={store} saving={saving} onSave={persist} />
      )}
    </section>
  );
}
