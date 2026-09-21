import { useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { COMPLAINT_STATUS_LABELS } from '../lib/complaintHistory';
import { extraFieldKeys } from '../lib/complaintReport';
import { formatDayLabel, formatMoney, formatNumber, formatPct } from '../lib/metrics';

export default function ReportPdfModal({ report, onClose }) {
  const [includeDetail, setIncludeDetail] = useState(false);
  const totals = report?.totals || {};
  const items = report?.items || [];
  const extras = extraFieldKeys(items).slice(0, 4);

  const aggLabel =
    report?.aggregator && report.aggregator !== 'all'
      ? getAggregatorLabel(report.aggregator)
      : 'Todos los agregadores';

  const periodLabel = report?.from
    ? `${formatDayLabel(report.from)}${report.from !== report.to ? ` → ${formatDayLabel(report.to)}` : ''}`
    : 'Período completo';

  const emissionDate = new Date().toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  function handlePrint() {
    window.print();
  }

  return (
    <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pdf-modal-title">
      <div className="report-modal">
        <header className="report-modal__header">
          <div>
            <h3 id="pdf-modal-title">Exportar informe en PDF</h3>
            <p className="report-modal__subtitle">
              Previsualizá el documento antes de imprimir o guardar como PDF.
            </p>
          </div>
          <div className="report-modal__controls">
            <div className="report-modal__toggle">
              <label className="report-modal__toggle-label">
                <input
                  type="checkbox"
                  checked={includeDetail}
                  onChange={(e) => setIncludeDetail(e.target.checked)}
                />
                <span>Incluir detalle de quejas ({formatNumber(items.length)} filas)</span>
              </label>
            </div>
            <button type="button" className="btn btn--primary" onClick={handlePrint}>
              Guardar como PDF / Imprimir
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </header>

        <div className="report-modal__body">
          {/* Printable Document Root */}
          <article className="report-pdf-doc">
            {/* Header / Brand */}
            <header className="report-pdf-doc__header">
              <div className="report-pdf-doc__brand">
                <div className="report-pdf-doc__logo-pill">DELIVERY</div>
                <div>
                  <h1 className="report-pdf-doc__title">Delivery La Plata</h1>
                  <p className="report-pdf-doc__docname">Informe de Métricas y Reclamos</p>
                </div>
              </div>
              <div className="report-pdf-doc__meta">
                <div className="report-pdf-doc__meta-item">
                  <span className="report-pdf-doc__meta-label">Período</span>
                  <strong className="report-pdf-doc__meta-val">{periodLabel}</strong>
                </div>
                <div className="report-pdf-doc__meta-item">
                  <span className="report-pdf-doc__meta-label">Filtro</span>
                  <strong className="report-pdf-doc__meta-val">{aggLabel}</strong>
                </div>
                <div className="report-pdf-doc__meta-item">
                  <span className="report-pdf-doc__meta-label">Emisión</span>
                  <span className="report-pdf-doc__meta-val">{emissionDate}</span>
                </div>
              </div>
            </header>

            {/* KPI Cards Strip */}
            <section className="report-pdf-doc__kpis">
              <div className="report-pdf-kpi">
                <span className="report-pdf-kpi__label">Reclamos Totales</span>
                <strong className="report-pdf-kpi__val">{formatNumber(totals.count)}</strong>
                <span className="report-pdf-kpi__hint">Pedidos afectados</span>
              </div>
              <div className="report-pdf-kpi">
                <span className="report-pdf-kpi__label">$ Reclamado Total</span>
                <strong className="report-pdf-kpi__val">{formatMoney(totals.complaintAmount)}</strong>
                <span className="report-pdf-kpi__hint">Importe de quejas</span>
              </div>
              <div className="report-pdf-kpi report-pdf-kpi--good">
                <span className="report-pdf-kpi__label">$ Recuperado</span>
                <strong className="report-pdf-kpi__val">{formatMoney(totals.recoveredAmount)}</strong>
                <span className="report-pdf-kpi__badge">
                  {formatPct(totals.recoveredPct)} recuperado
                </span>
              </div>
              <div className="report-pdf-kpi report-pdf-kpi--bad">
                <span className="report-pdf-kpi__label">$ Pérdida Neta</span>
                <strong className="report-pdf-kpi__val">{formatMoney(totals.lostAmount)}</strong>
                <span className="report-pdf-kpi__hint">Reclamos menos recuperos</span>
              </div>
            </section>

            {/* Status Breakdown Bar */}
            <section className="report-pdf-doc__split">
              <div className="report-pdf-split-item">
                <span className="report-pdf-split-item__dot report-pdf-split-item__dot--pending" />
                <span>
                  Sin disputar: <strong>{formatMoney(totals.undisputedAmount)}</strong> ({formatNumber(totals.queja || 0)})
                </span>
              </div>
              <div className="report-pdf-split-item">
                <span className="report-pdf-split-item__dot report-pdf-split-item__dot--process" />
                <span>
                  En trámite: <strong>{formatMoney(totals.inProgressAmount)}</strong> ({formatNumber(totals.refutado || 0)})
                </span>
              </div>
              <div className="report-pdf-split-item">
                <span className="report-pdf-split-item__dot report-pdf-split-item__dot--rejected" />
                <span>
                  Ref. rechazada: <strong>{formatMoney(totals.confirmedLostAmount)}</strong> ({formatNumber(totals.refutadoRechazado || 0)})
                </span>
              </div>
              <div className="report-pdf-split-item">
                <span className="report-pdf-split-item__dot report-pdf-split-item__dot--accepted" />
                <span>
                  Ref. aceptada: <strong>{formatMoney(totals.recoveredAmount)}</strong> ({formatNumber(totals.refutadoAceptado || 0)})
                </span>
              </div>
            </section>

            {/* Section: Por Agregador */}
            {report.aggregators?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Desglose por Agregador</h2>
                <table className="report-pdf-table">
                  <thead>
                    <tr>
                      <th>Agregador</th>
                      <th className="report-pdf-col--num">Quejas</th>
                      <th className="report-pdf-col--num">% Quejas</th>
                      <th className="report-pdf-col--num">% Recup.</th>
                      <th className="report-pdf-col--num">$ Reclamado</th>
                      <th className="report-pdf-col--num">$ Recuperado</th>
                      <th className="report-pdf-col--num">$ Perdido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.aggregators.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.label || row.id}</strong></td>
                        <td className="report-pdf-col--num">{formatNumber(row.count)}</td>
                        <td className="report-pdf-col--num">
                          {formatPct(totals.count ? (row.count / totals.count) * 100 : 0)}
                        </td>
                        <td className="report-pdf-col--num">{formatPct(row.recoveredPct)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.complaintAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.recoveredAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="report-pdf-col--num">{formatNumber(totals.count)}</td>
                      <td className="report-pdf-col--num">100%</td>
                      <td className="report-pdf-col--num">{formatPct(totals.recoveredPct)}</td>
                      <td className="report-pdf-col--num">{formatMoney(totals.complaintAmount)}</td>
                      <td className="report-pdf-col--num">{formatMoney(totals.recoveredAmount)}</td>
                      <td className="report-pdf-col--num">{formatMoney(totals.lostAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </section>
            )}

            {/* Section: Combos con mayor % de quejas */}
            {report.combos?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Combos con mayor porcentaje de quejas</h2>
                <table className="report-pdf-table">
                  <thead>
                    <tr>
                      <th>Combo / Producto</th>
                      <th className="report-pdf-col--num">Quejas</th>
                      <th className="report-pdf-col--num">% del Total</th>
                      <th className="report-pdf-col--num">$ Reclamado</th>
                      <th className="report-pdf-col--num">$ Recuperado</th>
                      <th className="report-pdf-col--num">$ Perdido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.combos.slice(0, 15).map((row) => (
                      <tr key={row.combo}>
                        <td>{row.combo || 'Sin combo'}</td>
                        <td className="report-pdf-col--num">{formatNumber(row.count)}</td>
                        <td className="report-pdf-col--num">{formatPct(row.sharePct)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.complaintAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.recoveredAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Section: Por Motivo */}
            {report.reasons?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Desglose por Motivo de Reclamo</h2>
                <table className="report-pdf-table">
                  <thead>
                    <tr>
                      <th>Motivo</th>
                      <th className="report-pdf-col--num">Quejas</th>
                      <th className="report-pdf-col--num">% Quejas</th>
                      <th className="report-pdf-col--num">% Recup.</th>
                      <th className="report-pdf-col--num">$ Reclamado</th>
                      <th className="report-pdf-col--num">$ Recuperado</th>
                      <th className="report-pdf-col--num">$ Perdido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.reasons.map((row) => (
                      <tr key={row.key}>
                        <td>{row.key}</td>
                        <td className="report-pdf-col--num">{formatNumber(row.count)}</td>
                        <td className="report-pdf-col--num">
                          {formatPct(totals.count ? (row.count / totals.count) * 100 : 0)}
                        </td>
                        <td className="report-pdf-col--num">{formatPct(row.recoveredPct)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.complaintAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.recoveredAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Section: Por Día */}
            {report.days?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Evolución Diaria</h2>
                <table className="report-pdf-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th className="report-pdf-col--num">Quejas</th>
                      <th className="report-pdf-col--num">% Recup.</th>
                      <th className="report-pdf-col--num">$ Reclamado</th>
                      <th className="report-pdf-col--num">$ Recuperado</th>
                      <th className="report-pdf-col--num">$ Perdido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((row) => (
                      <tr key={row.key}>
                        <td>{formatDayLabel(row.key)}</td>
                        <td className="report-pdf-col--num">{formatNumber(row.count)}</td>
                        <td className="report-pdf-col--num">{formatPct(row.recoveredPct)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.complaintAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.recoveredAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Optional Section: Detalle de Quejas */}
            {includeDetail && items.length > 0 && (
              <section className="report-pdf-section report-pdf-section--page-break">
                <h2 className="report-pdf-section__title">
                  Anexo: Detalle de Reclamos ({formatNumber(items.length)} pedidos)
                </h2>
                <table className="report-pdf-table report-pdf-table--dense">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Fecha</th>
                      <th>Agregador</th>
                      <th>Combo</th>
                      <th>Motivo</th>
                      <th className="report-pdf-col--num">Monto</th>
                      <th>Estado</th>
                      <th>Foto</th>
                      {extras.map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.orderCode}</strong></td>
                        <td>{item.day ? formatDayLabel(item.day) : '—'}</td>
                        <td>{getAggregatorLabel(item.aggregator)}</td>
                        <td>{item.combo || '—'}</td>
                        <td>{item.reason || '—'}</td>
                        <td className="report-pdf-col--num">{formatMoney(item.amount)}</td>
                        <td>{COMPLAINT_STATUS_LABELS[item.status] || item.status}</td>
                        <td>{item.photoUrl ? 'Sí' : 'No'}</td>
                        {extras.map((key) => (
                          <td key={key}>{item.fields?.[key] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Document Footer */}
            <footer className="report-pdf-doc__footer">
              <p>Delivery La Plata · Sistema de Registro y Control de Métricas</p>
              <p>Generado automáticamente el {emissionDate}</p>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
