import { useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import {
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUSES,
  listHistoryItems,
} from '../lib/complaintHistory';
import { buildRegistryCsv, downloadRegistryXlsx } from '../lib/complaintReport';
import { downloadTextFile, uploadComplaintPhotoFile } from '../lib/complaints';
import { formatDayLabel, formatMoney } from '../lib/metrics';
import ComplaintEvidenceUpload from './ComplaintEvidenceUpload';

const STATUS_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: COMPLAINT_STATUSES.queja, label: 'Queja' },
  { id: COMPLAINT_STATUSES.refutado, label: 'Refutado' },
  { id: COMPLAINT_STATUSES.refutado_aceptado, label: 'Ref. aceptado' },
  { id: COMPLAINT_STATUSES.refutado_rechazado, label: 'Ref. rechazado' },
];

export default function MetricsComplaintsList({
  history,
  range,
  aggregator,
  busy,
  onDelete,
  onClear,
  onPhoto,
  onError,
  onNotice,
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const items = useMemo(
    () =>
      listHistoryItems(history, {
        from: range.from,
        to: range.to,
        aggregator,
        search,
        status,
      }),
    [history, range, aggregator, search, status],
  );
  const total = Object.keys(history.items || {}).length;

  async function handlePhoto(item, file) {
    try {
      const photo = await uploadComplaintPhotoFile(file, item, item.aggregator);
      await onPhoto(item, photo);
      onNotice(`Foto cargada en ${item.orderCode}.`);
    } catch (err) {
      onError(err.message || 'No se pudo subir la foto.');
    }
  }

  function handleClear() {
    if (!total) return;
    if (!window.confirm(`Se van a borrar ${total} quejas del historial. Las fotos no se borran.`)) return;
    onClear();
  }

  function handleDelete(item) {
    if (!window.confirm(`¿Borrar la queja ${item.orderCode}?`)) return;
    onDelete(item.id);
  }

  return (
    <div className="metrics-registry">
      <div className="complaints__history-tools">
        <label className="complaints__field complaints__search">
          <span>Buscar</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Código, combo, motivo…"
          />
        </label>
        <div className="gallery__view-toggle complaints__filters" role="group" aria-label="Estado">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`gallery__view-btn${status === item.id ? ' gallery__view-btn--active' : ''}`}
              onClick={() => setStatus(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="complaints__summary">
        <p className="gallery__count">
          {items.length} queja{items.length !== 1 ? 's' : ''} en este período · {total} en el historial
        </p>
        <div className="complaints__batch">
          <button
            type="button"
            className="btn btn--primary btn--small report-btn-excel"
            onClick={() => downloadRegistryXlsx(items, 'quejas.xlsx')}
            disabled={!items.length}
            title="Descargar listado de quejas formateado en Excel (.xlsx)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="8" y1="13" x2="16" y2="13"></line>
              <line x1="8" y1="17" x2="16" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Exportar Excel (.xlsx)
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => downloadTextFile('quejas.csv', buildRegistryCsv(items))}
            disabled={!items.length}
          >
            CSV
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={handleClear} disabled={!total || busy}>
            Vaciar historial
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="gallery__state gallery__state--empty">
          <p>No hay quejas en este período. Cruzá el Excel del día en Reclamos.</p>
        </div>
      ) : (
        <div className="metrics-table-wrap">
          <table className="metrics-table metrics-table--rows">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Día</th>
                <th>Combo</th>
                <th>Motivo</th>
                <th>Monto</th>
                <th>Estado</th>
                <th>Foto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.orderCode}</strong>
                    <small>{getAggregatorLabel(item.aggregator)}</small>
                  </td>
                  <td>{item.day ? formatDayLabel(item.day) : '—'}</td>
                  <td>{item.combo || '—'}</td>
                  <td>
                    {item.reason || '—'}
                    {item.fields && Object.keys(item.fields).length > 0 && (
                      <small>
                        {Object.entries(item.fields)
                          .slice(0, 4)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' · ')}
                      </small>
                    )}
                  </td>
                  <td>{formatMoney(item.amount)}</td>
                  <td>{COMPLAINT_STATUS_LABELS[item.status] || item.status}</td>
                  <td>{item.photoUrl ? 'Sí' : 'No'}</td>
                  <td>
                    <div className="metrics-registry__actions">
                      {!item.photoUrl && (
                        <ComplaintEvidenceUpload
                          disabled={busy}
                          onFile={(file) => handlePhoto(item, file)}
                        />
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => handleDelete(item)}
                        disabled={busy}
                      >
                        Borrar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
