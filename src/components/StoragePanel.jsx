import { useCallback, useEffect, useState } from 'react';
import { formatBytes, loadStorageUsage } from '../lib/storageUsage';
import './StoragePanel.css';

const CATEGORIES = [['orders', 'Fotos de pedidos'], ['files', 'Archivos'], ['tickets', 'Tickets remotos'], ['other', 'Otros objetos del sistema']];
const EMPTY = { count: 0, bytes: 0, unknownSizeCount: 0 };
function size(row) {
  if (row.count && row.unknownSizeCount === row.count) return 'Sin tamaño conocido';
  return `${formatBytes(row.bytes)}${row.unknownSizeCount ? ' (parcial)' : ''}`;
}

export default function StoragePanel({ retention, onCleanup, refreshKey, loadUsage = loadStorageUsage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try { setData(await loadUsage(retention?.retention_days || 30)); }
    catch (failure) { setError(failure.message || 'No se pudo consultar el almacenamiento.'); }
    finally { setBusy(false); }
  }, [retention, loadUsage]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh, refreshKey]);
  const currentRetention = data?.retention || retention;
  const eligible = data?.selections?.eligible || EMPTY;
  const protectedFiles = data?.selections?.protected || EMPTY;
  return <section className="storage-panel storage-panel--compact" aria-label="Almacenamiento remoto">
    <div className="storage-panel__header"><div><h3>Almacenamiento remoto</h3><p>Fotos, archivos y tickets de la app.</p></div><button type="button" className="btn btn--ghost btn--small" onClick={refresh} disabled={busy}>{busy ? 'Consultando…' : 'Actualizar'}</button></div>
    {error && <p className="message message--error" role="alert">{error} {data ? 'Los valores anteriores pueden estar desactualizados.' : ''}</p>}
    {!data && busy && <p role="status">Calculando espacio ocupado…</p>}
    {data && <>
      <div className="storage-summary">
        <div><span>Espacio ocupado</span><strong>{size(data.total)}</strong><small>{data.total.count.toLocaleString('es-AR')} objetos</small></div>
        <div><span>Espacio liberable</span><strong>{size(eligible)}</strong><small>{eligible.count.toLocaleString('es-AR')} fotos · plazo de {currentRetention?.retention_days || 30} días</small></div>
        <div><span>Fotos protegidas</span><strong>{protectedFiles.count.toLocaleString('es-AR')}</strong><small>{size(protectedFiles)} conservados</small></div>
      </div>
      <div className="storage-breakdown" aria-hidden="true">{CATEGORIES.map(([key]) => <span key={key} style={{ width: `${data.total.bytes ? (data.categories[key]?.bytes || 0) / data.total.bytes * 100 : 0}%` }} />)}</div>
      {data.total.unknownSizeCount > 0 && <p className="storage-partial">{data.total.unknownSizeCount} objetos sin tamaño informado. El espacio mostrado es parcial.</p>}
      <details className="storage-details"><summary>Ver desglose y registros</summary>
        <div className="storage-category-list">{CATEGORIES.map(([key, label]) => {
          const row = data.categories[key] || EMPTY;
          return <div key={key}><span><i className={`storage-dot storage-dot--${key}`} aria-hidden="true" />{label}<small>{row.count.toLocaleString('es-AR')} objetos{row.unknownSizeCount ? ` · ${row.unknownSizeCount} sin tamaño conocido` : ''}</small></span><strong>{size(row)}</strong></div>;
        })}</div>
        <p>{data.retainedRecords.toLocaleString('es-AR')} registros con imagen · {data.recordsWithoutImage.toLocaleString('es-AR')} registros conservados sin imagen.</p>
        <p className="metric-source">Consultado {new Date(data.snapshotAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}. No incluye cachés ni tickets guardados solamente en este dispositivo. Las candidatas se vuelven a validar al confirmar.</p>
      </details>
    </>}
    {onCleanup && <button type="button" className="btn btn--danger btn--small" onClick={onCleanup}>Elegir fecha y limpiar fotos</button>}
  </section>;
}
