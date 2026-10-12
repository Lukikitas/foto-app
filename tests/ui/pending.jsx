import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import '../../src/App.css';
import DailyPendingPage from '../../src/components/DailyPendingPage';
import MetricsEntry from '../../src/components/MetricsEntry';
import { emptyStore, METRIC_AGGREGATORS } from '../../src/lib/metrics';
import { applyTheme } from '../../src/lib/theme';

const complete = { orders: 100, complaints: 0, awt: 0, reported: { orders: true, complaints: true, awt: true } };
const platformDay = () => Object.fromEntries(METRIC_AGGREGATORS.map(id => [id, { ...complete }]));
const initialMetrics = { ...emptyStore(), refutadoDays: { default: 0, pedidosya: 3 }, days: {
  '2026-09-30': platformDay(), '2026-10-08': { ...platformDay(), pedidosya: { ...complete, complaints: 2, sources: { orders: 'excel_pedidosya', complaints: 'excel_pedidosya', awt: 'excel_pedidosya' } }, rappi: undefined },
  '2026-10-09': { ...platformDay(), pedidosya: { ...complete, complaints: 1, sources: { orders: 'manual', complaints: 'excel_pedidosya', awt: 'manual' } }, rappi_turbo: { orders: 10, complaints: 0, awt: 0 } },
  '2026-10-10': { ...platformDay(), pedidosya: { ...complete, complaints: 2 }, mercadopago: { ...complete, complaints: 1 } },
} };
const initialHistory = { items: {
  old: { id: 'old', day: '2026-09-30', orderCode: 'PEYA100001', aggregator: 'pedidosya', status: 'queja', amount: 9500, reason: 'missing item' },
  open: { id: 'open', day: '2026-10-08', orderCode: 'PEYA100002', aggregator: 'pedidosya', status: 'queja', amount: null, reason: 'Pendiente de cargar detalles del reclamo', detailOrigin: 'photo' },
  review: { id: 'review', day: '2026-10-08', orderCode: 'PEYA100003', aggregator: 'pedidosya', status: 'refutado', amount: 15000, reason: 'wrong item', detailOrigin: 'excel_pedidosya', timeOfDay: '14:15', comment: 'Recibí un producto diferente al que pedí.' },
  today: { id: 'today', day: '2026-10-09', orderCode: 'PEYA100004', aggregator: 'pedidosya', status: 'queja', amount: 20000, reason: 'food quality', detailOrigin: 'excel_pedidosya', timeOfDay: '19:42', comment: 'El pedido llegó frío.', combo: 'Combo de prueba' },
  undated: { id: 'undated', day: '', orderCode: 'RAPPI100005', aggregator: 'rappi', status: 'refutado', amount: 0 },
} };

export function Preview() {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [history, setHistory] = useState(initialHistory);
  const [failure, setFailure] = useState(false);
  const [saveFailure, setSaveFailure] = useState(false);
  const [entry, setEntry] = useState(null);
  const [selected, setSelected] = useState(null);
  const dataSource = useMemo(() => ({
    loadMetricsStore: async () => { if (failure) throw new Error('Fallo de conexión simulado.'); return metrics; },
    saveMetricsStore: async next => { if (saveFailure) throw new Error('Fallo de guardado simulado. El borrador se conserva.'); setMetrics(next); return next; },
    loadComplaintHistory: async () => history,
    complaintHistoryReadStatus: () => ({ cached: false }),
    subscribeComplaintHistory: () => () => {},
  }), [metrics, history, failure, saveFailure]);
  return <div className="app--pending" style={{ minHeight: '100vh' }}><main style={{ padding: '1.5rem', maxWidth: 1400, margin: 'auto' }}><p>Prueba local · Datos ficticios. No modifica producción.</p>
    <div className="metrics-entry-selector"><button className="btn btn--ghost" onClick={() => applyTheme('light')}>Tema claro</button><button className="btn btn--ghost" onClick={() => applyTheme('dark')}>Tema oscuro</button>
      <button className="btn btn--ghost" onClick={() => setFailure(value => !value)}>{failure ? 'Restablecer conexión' : 'Simular fallo'}</button><button className="btn btn--ghost" onClick={() => setSaveFailure(value => !value)}>{saveFailure ? 'Permitir guardado' : 'Simular fallo al guardar'}</button></div>
    {entry ? <><button className="btn btn--ghost" onClick={() => setEntry(null)}>← Volver a pendientes</button><MetricsEntry store={metrics} entryRequest={entry} onSave={async next => { setMetrics(next); return true; }} /></> : <DailyPendingPage dataSource={dataSource} now={new Date('2026-10-11T15:00:00-03:00')} onLoadDay={(day, aggregator, mode) => setEntry({ day, aggregator, mode })} onLoadComplaints={(day, aggregator) => setSelected({ orderCode: `Cargar ${aggregator}`, day })} onCase={setSelected} />}
    {selected && <aside className="message message--success"><p>Caso seleccionado: {selected.orderCode} · {selected.day || 'Sin fecha'}</p><button className="btn btn--ghost" onClick={() => { setHistory(current => ({ ...current, items: { ...current.items, [selected.id]: { ...selected, status: 'refutado_aceptado' } } })); setSelected(null); }}>Resolver caso de prueba</button></aside>}
  </main></div>;
}
createRoot(document.getElementById('root')).render(<Preview />);
