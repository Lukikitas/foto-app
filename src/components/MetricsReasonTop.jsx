import { Fragment, useState } from 'react';
import { formatMoney, formatNumber, formatPct } from '../lib/metrics';

/**
 * Bloque «Top de motivos» de Métricas (Ref. rechazada / No refutables):
 * ranking con posición, cantidad, % sobre el estado, $ perdido, barra
 * proporcional y comentarios libres expandibles por fila.
 */
export default function MetricsReasonTop({ title, rows = [], emptyMessage }) {
  const [openComments, setOpenComments] = useState(() => new Set());

  function toggleComments(key) {
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="metrics-report__block metrics-reason-top">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <div className="gallery__state gallery__state--empty">
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <div className="metrics-table-wrap">
          <table className="metrics-table metrics-reason-top__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Motivo</th>
                <th>Quejas</th>
                <th>% del estado</th>
                <th>$ perdido</th>
                <th aria-label="Proporción"></th>
                <th aria-label="Comentarios"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const isOpen = openComments.has(row.key);
                return (
                  <Fragment key={row.key}>
                    <tr>
                      <td>{index + 1}</td>
                      <td>
                        <strong>{row.key}</strong>
                      </td>
                      <td>{formatNumber(row.count)}</td>
                      <td>{formatPct(row.sharePct)}</td>
                      <td>{formatMoney(row.lostAmount)}</td>
                      <td className="metrics-reason-top__bar-cell">
                        <span className="metrics-reason-top__bar" aria-hidden="true">
                          <span
                            className="metrics-reason-top__bar-fill"
                            style={{ width: `${Math.max(4, Math.min(100, row.sharePct || 0))}%` }}
                          />
                        </span>
                      </td>
                      <td>
                        {row.comments.length > 0 ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--small"
                            aria-expanded={isOpen}
                            onClick={() => toggleComments(row.key)}
                          >
                            {isOpen ? 'Ocultar' : `Comentarios (${row.comments.length})`}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                    {isOpen && row.comments.length > 0 ? (
                      <tr className="metrics-reason-top__comments">
                        <td colSpan={7}>
                          <ul>
                            {row.comments.map((comment) => (
                              <li key={comment}>{comment}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
