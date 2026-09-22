import { useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { COMPLAINT_STATUS_LABELS } from '../lib/complaintHistory';
import { extraFieldKeys } from '../lib/complaintReport';
import { formatDayLabel, formatMoney, formatNumber, formatPct } from '../lib/metrics';
import { openReportInNewTab, printReportDocument } from '../lib/pdfReportGenerator';

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
    ? `${formatDayLabel(report.from)}${report.from !== report.to ? ` al ${formatDayLabel(report.to)}` : ''}`
    : 'Período completo';

  const emissionDate = new Date().toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Calculate Insights
  const topAggregator = report.aggregators?.[0];
  const topCombo = report.combos?.[0];
  const topReason = report.reasons?.[0];

  const totalAmount = totals.complaintAmount || 0;
  const pctUndisputed = totalAmount ? ((totals.undisputedAmount || 0) / totalAmount) * 100 : 0;
  const pctInProgress = totalAmount ? ((totals.inProgressAmount || 0) / totalAmount) * 100 : 0;
  const pctRejected = totalAmount ? ((totals.confirmedLostAmount || 0) / totalAmount) * 100 : 0;
  const pctRecovered = totalAmount ? ((totals.recoveredAmount || 0) / totalAmount) * 100 : 0;

  function handlePrint() {
    printReportDocument(report, { includeDetail });
  }

  function handleOpenNewTab() {
    openReportInNewTab(report, { includeDetail });
  }

  return (
    <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pdf-modal-title">
      <div className="report-modal">
        <header className="report-modal__header">
          <div>
            <h3 id="pdf-modal-title">Exportar informe en PDF</h3>
            <p className="report-modal__subtitle">
              Configurá y previsualizá el documento antes de imprimir o guardar como PDF.
            </p>
          </div>
          <div className="report-modal__controls">
            <div className="report-modal__scope-selector" role="radiogroup" aria-label="Alcance del informe">
              <button
                type="button"
                className={`report-modal__scope-btn${!includeDetail ? ' is-active' : ''}`}
                onClick={() => setIncludeDetail(false)}
              >
                Resumen Ejecutivo (1-2 págs)
              </button>
              <button
                type="button"
                className={`report-modal__scope-btn${includeDetail ? ' is-active' : ''}`}
                onClick={() => setIncludeDetail(true)}
              >
                Completo con Detalle ({formatNumber(items.length)})
              </button>
            </div>

            <button type="button" className="btn btn--primary" onClick={handlePrint} title="Imprimir o guardar directamente como PDF">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9V2h12v7"></path>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              Guardar como PDF / Imprimir
            </button>

            <button type="button" className="btn btn--ghost" onClick={handleOpenNewTab} title="Abrir informe independiente en pestaña nueva">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              Abrir en pestaña
            </button>

            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </header>

        <div className="report-modal__body">
          {/* Printable Document Root */}
          <article className="report-pdf-doc">
            <div className="report-top-stripe" />

            {/* Header / Brand */}
            <header className="report-pdf-doc__header">
              <div className="report-pdf-doc__brand">
                <span className="report-pdf-doc__logo-pill">DELIVERY LA PLATA</span>
                <h1 className="report-pdf-doc__title">Informe Gerencial de Quejas y Recuperos</h1>
                <p className="report-pdf-doc__docname">Control de calidad operativo, reclamos y efectividad de refutaciones</p>
              </div>
              <div className="report-pdf-doc__meta">
                <div className="report-pdf-doc__meta-item">
                  <span className="report-pdf-doc__meta-label">Período analizado:</span>
                  <strong className="report-pdf-doc__meta-val">{periodLabel}</strong>
                </div>
                <div className="report-pdf-doc__meta-item">
                  <span className="report-pdf-doc__meta-label">Filtro aplicado:</span>
                  <strong className="report-pdf-doc__meta-val">{aggLabel}</strong>
                </div>
                <div className="report-pdf-doc__meta-item">
                  <span className="report-pdf-doc__meta-label">Fecha de emisión:</span>
                  <span className="report-pdf-doc__meta-val">{emissionDate}</span>
                </div>
              </div>
            </header>

            {/* KPI Cards Strip */}
            <section className="report-pdf-doc__kpis">
              <div className="report-pdf-kpi report-pdf-kpi--total">
                <span className="report-pdf-kpi__label">$ Reclamado Total</span>
                <strong className="report-pdf-kpi__val">{formatMoney(totals.complaintAmount)}</strong>
                <span className="report-pdf-kpi__hint">Plata dada al cliente en reclamos</span>
              </div>
              <div className="report-pdf-kpi report-pdf-kpi--good">
                <span className="report-pdf-kpi__label">$ Recuperado</span>
                <strong className="report-pdf-kpi__val">{formatMoney(totals.recoveredAmount)}</strong>
                <span className="report-pdf-kpi__badge">
                  {formatPct(totals.recoveredPct)} de efectividad
                </span>
              </div>
              <div className="report-pdf-kpi report-pdf-kpi--dispute">
                <span className="report-pdf-kpi__label">Dinero en Disputa</span>
                <strong className="report-pdf-kpi__val">{formatMoney(totals.inProgressAmount ?? totals.disputedAmount)}</strong>
                <span className="report-pdf-kpi__hint">Refutados en trámite</span>
              </div>
              <div className="report-pdf-kpi report-pdf-kpi--bad">
                <span className="report-pdf-kpi__label">$ Pérdida Neta</span>
                <strong className="report-pdf-kpi__val">{formatMoney(totals.lostAmount)}</strong>
                <span className="report-pdf-kpi__hint">Rechazados o sin refutar</span>
              </div>
              <div className="report-pdf-kpi report-pdf-kpi--count">
                <span className="report-pdf-kpi__label">Pedidos con Reclamo</span>
                <strong className="report-pdf-kpi__val">{formatNumber(totals.count)}</strong>
                <span className="report-pdf-kpi__hint">
                  {totals.refutadoAceptado ? `${formatNumber(totals.refutadoAceptado)} recuperados con éxito` : 'Quejas registradas'}
                </span>
              </div>
            </section>

            {/* Status Breakdown Bar */}
            <section className="report-pdf-status-panel">
              <div className="report-pdf-status-title">Estado de Trámites y Gestión de Disputas</div>
              <div className="report-pdf-progress-bar">
                <div className="report-pdf-progress-seg seg-undisputed" style={{ width: `${pctUndisputed}%` }} />
                <div className="report-pdf-progress-seg seg-inprogress" style={{ width: `${pctInProgress}%` }} />
                <div className="report-pdf-progress-seg seg-rejected" style={{ width: `${pctRejected}%` }} />
                <div className="report-pdf-progress-seg seg-recovered" style={{ width: `${pctRecovered}%` }} />
              </div>
              <div className="report-pdf-doc__split">
                <div className="report-pdf-split-item">
                  <span className="report-pdf-split-item__dot report-pdf-split-item__dot--pending" />
                  <span>
                    Sin disputar: <strong>{formatMoney(totals.undisputedAmount)}</strong> <small>({formatNumber(totals.queja || 0)})</small>
                  </span>
                </div>
                <div className="report-pdf-split-item">
                  <span className="report-pdf-split-item__dot report-pdf-split-item__dot--process" />
                  <span>
                    En trámite: <strong>{formatMoney(totals.inProgressAmount)}</strong> <small>({formatNumber(totals.refutado || 0)})</small>
                  </span>
                </div>
                <div className="report-pdf-split-item">
                  <span className="report-pdf-split-item__dot report-pdf-split-item__dot--rejected" />
                  <span>
                    Rechazada: <strong>{formatMoney(totals.confirmedLostAmount)}</strong> <small>({formatNumber(totals.refutadoRechazado || 0)})</small>
                  </span>
                </div>
                <div className="report-pdf-split-item">
                  <span className="report-pdf-split-item__dot report-pdf-split-item__dot--accepted" />
                  <span>
                    Aceptada: <strong>{formatMoney(totals.recoveredAmount)}</strong> <small>({formatNumber(totals.refutadoAceptado || 0)})</small>
                  </span>
                </div>
              </div>
            </section>

            {/* Executive Insights Panel */}
            <section className="report-pdf-insights">
              <div className="report-pdf-insight-col">
                <span className="report-pdf-insight-title">Plataforma Principal</span>
                <strong className="report-pdf-insight-val">{topAggregator ? topAggregator.label || topAggregator.id : 'N/A'}</strong>
                <small>{topAggregator ? `${formatMoney(topAggregator.complaintAmount)} (${formatNumber(topAggregator.count)} quejas)` : 'Sin datos'}</small>
              </div>
              <div className="report-pdf-insight-col">
                <span className="report-pdf-insight-title">Combo Más Reclamado</span>
                <strong className="report-pdf-insight-val">{topCombo ? topCombo.combo || 'Sin combo' : 'N/A'}</strong>
                <small>{topCombo ? `${formatNumber(topCombo.count)} reclamos (${formatPct(topCombo.sharePct)} del total)` : 'Sin datos'}</small>
              </div>
              <div className="report-pdf-insight-col">
                <span className="report-pdf-insight-title">Causa Principal</span>
                <strong className="report-pdf-insight-val">{topReason ? topReason.key : 'N/A'}</strong>
                <small>{topReason ? `${formatNumber(topReason.count)} quejas · ${formatMoney(topReason.complaintAmount)}` : 'Sin datos'}</small>
              </div>
            </section>

            {/* Section: Por Agregador */}
            {report.aggregators?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Desglose por Agregador</h2>
                <div className="report-pdf-table-wrap">
                  <table className="report-pdf-table">
                    <thead>
                      <tr>
                        <th>Agregador</th>
                        <th className="report-pdf-col--num">Quejas</th>
                        <th className="report-pdf-col--num">% Quejas</th>
                        <th className="report-pdf-col--num">% Recup.</th>
                        <th className="report-pdf-col--num">$ Reclamado</th>
                        <th className="report-pdf-col--num">$ Recuperado</th>
                        <th className="report-pdf-col--num">$ En Disputa</th>
                        <th className="report-pdf-col--num">$ Pérdida Neta</th>
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
                          <td className="report-pdf-col--num">{formatMoney(row.inProgressAmount || 0)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total General</td>
                        <td className="report-pdf-col--num">{formatNumber(totals.count)}</td>
                        <td className="report-pdf-col--num">100%</td>
                        <td className="report-pdf-col--num">{formatPct(totals.recoveredPct)}</td>
                        <td className="report-pdf-col--num">{formatMoney(totals.complaintAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(totals.recoveredAmount)}</td>
                        <td className="report-pdf-col--num">{formatMoney(totals.inProgressAmount || 0)}</td>
                        <td className="report-pdf-col--num">{formatMoney(totals.lostAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            )}

            {/* Section: Combos con mayor % de quejas */}
            {report.combos?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Top Combos con Mayor Porcentaje de Reclamos</h2>
                <div className="report-pdf-table-wrap">
                  <table className="report-pdf-table">
                    <thead>
                      <tr>
                        <th>Combo / Producto</th>
                        <th className="report-pdf-col--num">Quejas</th>
                        <th className="report-pdf-col--num">% del Total</th>
                        <th className="report-pdf-col--num">$ Reclamado</th>
                        <th className="report-pdf-col--num">$ Recuperado</th>
                        <th className="report-pdf-col--num">$ En Disputa</th>
                        <th className="report-pdf-col--num">$ Pérdida Neta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.combos.slice(0, 12).map((row) => (
                        <tr key={row.combo}>
                          <td>{row.combo || 'Sin combo'}</td>
                          <td className="report-pdf-col--num">{formatNumber(row.count)}</td>
                          <td className="report-pdf-col--num">{formatPct(row.sharePct)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.complaintAmount)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.recoveredAmount)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.inProgressAmount || 0)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Section: Por Motivo */}
            {report.reasons?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Distribución por Causa / Motivo de Reclamo</h2>
                <div className="report-pdf-table-wrap">
                  <table className="report-pdf-table">
                    <thead>
                      <tr>
                        <th>Motivo</th>
                        <th className="report-pdf-col--num">Quejas</th>
                        <th className="report-pdf-col--num">% Quejas</th>
                        <th className="report-pdf-col--num">% Recup.</th>
                        <th className="report-pdf-col--num">$ Reclamado</th>
                        <th className="report-pdf-col--num">$ Recuperado</th>
                        <th className="report-pdf-col--num">$ En Disputa</th>
                        <th className="report-pdf-col--num">$ Pérdida Neta</th>
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
                          <td className="report-pdf-col--num">{formatMoney(row.inProgressAmount || 0)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Section: Por Día */}
            {report.days?.length > 0 && (
              <section className="report-pdf-section">
                <h2 className="report-pdf-section__title">Evolución Cronológica Diaria</h2>
                <div className="report-pdf-table-wrap">
                  <table className="report-pdf-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th className="report-pdf-col--num">Quejas</th>
                        <th className="report-pdf-col--num">% Recup.</th>
                        <th className="report-pdf-col--num">$ Reclamado</th>
                        <th className="report-pdf-col--num">$ Recuperado</th>
                        <th className="report-pdf-col--num">$ En Disputa</th>
                        <th className="report-pdf-col--num">$ Pérdida Neta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.days.map((row) => (
                        <tr key={row.key}>
                          <td><strong>{formatDayLabel(row.key)}</strong></td>
                          <td className="report-pdf-col--num">{formatNumber(row.count)}</td>
                          <td className="report-pdf-col--num">{formatPct(row.recoveredPct)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.complaintAmount)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.recoveredAmount)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.inProgressAmount || 0)}</td>
                          <td className="report-pdf-col--num">{formatMoney(row.lostAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Optional Section: Detalle de Quejas */}
            {includeDetail && items.length > 0 && (
              <section className="report-pdf-section report-pdf-section--page-break">
                <h2 className="report-pdf-section__title">
                  Anexo: Detalle Exhaustivo de Reclamos ({formatNumber(items.length)} pedidos)
                </h2>
                <div className="report-pdf-table-wrap">
                  <table className="report-pdf-table report-pdf-table--dense">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Fecha / Hora</th>
                        <th>Agregador</th>
                        <th>Combo</th>
                        <th>Motivo</th>
                        <th className="report-pdf-col--num">Monto</th>
                        <th className="report-pdf-col--center">Estado</th>
                        <th className="report-pdf-col--center">Foto</th>
                        {extras.map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const statusClass =
                          item.status === 'refutado_aceptado'
                            ? 'badge-status--accepted'
                            : item.status === 'refutado_rechazado'
                            ? 'badge-status--rejected'
                            : 'badge-status--pending';
                        return (
                          <tr key={item.id}>
                            <td><strong>{item.orderCode}</strong></td>
                            <td>{item.day ? formatDayLabel(item.day) : '—'} {item.timeOfDay || ''}</td>
                            <td>{getAggregatorLabel(item.aggregator)}</td>
                            <td>{item.combo || '—'}</td>
                            <td>{item.reason || '—'}</td>
                            <td className="report-pdf-col--num"><strong>{formatMoney(item.amount)}</strong></td>
                            <td className="report-pdf-col--center">
                              <span className={`badge-status ${statusClass}`}>
                                {COMPLAINT_STATUS_LABELS[item.status] || item.status}
                              </span>
                            </td>
                            <td className="report-pdf-col--center">{item.photoUrl ? 'Sí' : 'No'}</td>
                            {extras.map((key) => (
                              <td key={key}>{item.fields?.[key] || '—'}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Document Footer */}
            <footer className="report-pdf-doc__footer">
              <p>Delivery La Plata · Sistema Oficial de Registro y Control de Métricas</p>
              <p>Generado el {emissionDate} · Documento Confidencial</p>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
