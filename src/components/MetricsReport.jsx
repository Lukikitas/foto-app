import { useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { COMPLAINT_STATUS_LABELS } from '../lib/complaintHistory';
import {
  buildComplaintReport,
  buildRegistryCsv,
  buildReportCsv,
  downloadRegistryXlsx,
  downloadReportXlsx,
  extraFieldKeys,
} from '../lib/complaintReport';
import { downloadTextFile } from '../lib/complaints';
import { formatDayLabel, formatMoney, formatNumber, formatPct } from '../lib/metrics';
import { openReportInNewTab } from '../lib/pdfReportGenerator';
import ReportPdfModal from './ReportPdfModal';

function MoneyTable({ title, rows, nameKey, pctLabel = '% rec.' }) {
  if (!rows.length) return null;
  return (
    <section className="metrics-report__block">
      <h3>{title}</h3>
      <div className="metrics-table-wrap">
        <table className="metrics-table">
          <thead>
            <tr>
              <th>{nameKey}</th>
              <th>Quejas</th>
              <th>{pctLabel}</th>
              <th>$ quejas</th>
              <th>$ recuperado</th>
              <th>En disputa</th>
              <th>$ perdido</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key || row.combo || row.label}>
                <td>{row.label || row.combo || row.key}</td>
                <td>{formatNumber(row.count)}</td>
                <td>{formatPct(row.sharePct ?? row.recoveredPct)}</td>
                <td>{formatMoney(row.complaintAmount)}</td>
                <td>{formatMoney(row.recoveredAmount)}</td>
                <td>{formatMoney(row.inProgressAmount)}</td>
                <td>{formatMoney(row.lostAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function MetricsReport({ history, range, aggregator }) {
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const report = useMemo(
    () => buildComplaintReport(history, { from: range.from, to: range.to, aggregator }),
    [history, range, aggregator],
  );
  const totals = report.totals;
  const extras = useMemo(() => extraFieldKeys(report.items).slice(0, 6), [report.items]);

  return (
    <div className="metrics-report">
      <header className="metrics-report__hero">
        <div>
          <p className="metrics__lead">
            {formatDayLabel(range.from)}
            {range.from !== range.to ? ` → ${formatDayLabel(range.to)}` : ''}
            {` · ${formatNumber(totals.count)} quejas`}
          </p>
          <div className="metrics-kpis">
            <article className="metrics-kpi">
              <p>$ quejas</p>
              <strong>{formatMoney(totals.complaintAmount)}</strong>
              <span>Plata dada al cliente</span>
            </article>
            <article className={`metrics-kpi${totals.recoveredAmount > 0 ? ' metrics-kpi--good' : ''}`}>
              <p>$ recuperado</p>
              <strong>{formatMoney(totals.recoveredAmount)}</strong>
              <span>Volvió con Ref. aceptado</span>
            </article>
            <article className="metrics-kpi">
              <p>Dinero en disputa</p>
              <strong>{formatMoney(totals.inProgressAmount)}</strong>
              <span>Refutados pendientes</span>
            </article>
            <article
              className={`metrics-kpi${
                totals.lostAmount > 0 ? ' metrics-kpi--bad' : totals.complaintAmount ? ' metrics-kpi--good' : ''
              }`}
            >
              <p>$ perdido</p>
              <strong>{formatMoney(totals.lostAmount)}</strong>
              <span>Rechazados o sin refutar</span>
            </article>
          </div>
          <p className="metrics-money-split">
            Sin disputar {formatMoney(totals.undisputedAmount)} · En trámite{' '}
            {formatMoney(totals.inProgressAmount)} · Rechazado {formatMoney(totals.confirmedLostAmount)}
            {` · ${formatPct(totals.recoveredPct)} recuperado`}
          </p>
        </div>
        <div className="complaints__batch metrics-report__actions">
          <button
            type="button"
            className="btn btn--primary btn--small report-btn-excel"
            onClick={() => downloadReportXlsx(report)}
            disabled={!totals.count}
            title="Descargar libro de Excel completo con múltiples pestañas y estilos"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            className="btn btn--ghost btn--small report-btn-pdf"
            onClick={() => setShowPdfModal(true)}
            disabled={!totals.count}
            title="Generar y previsualizar informe ejecutivo en PDF listo para imprimir o compartir"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V2h12v7"></path>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            Exportar PDF
          </button>

          <div className="report-more-wrap">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              disabled={!totals.count}
              aria-expanded={showMoreMenu}
            >
              Más opciones ▾
            </button>

            {showMoreMenu && (
              <div className="report-more-menu" role="menu">
                <button
                  type="button"
                  className="report-more-menu__item"
                  role="menuitem"
                  onClick={() => {
                    openReportInNewTab(report, { includeDetail: false });
                    setShowMoreMenu(false);
                  }}
                >
                  Ver PDF en pestaña nueva
                </button>
                <button
                  type="button"
                  className="report-more-menu__item"
                  role="menuitem"
                  onClick={() => {
                    downloadRegistryXlsx(report.items);
                    setShowMoreMenu(false);
                  }}
                >
                  Detalle de quejas (.xlsx)
                </button>
                <button
                  type="button"
                  className="report-more-menu__item"
                  role="menuitem"
                  onClick={() => {
                    downloadTextFile('informe-quejas.csv', buildReportCsv(report));
                    setShowMoreMenu(false);
                  }}
                >
                  Descargar CSV resumen
                </button>
                <button
                  type="button"
                  className="report-more-menu__item"
                  role="menuitem"
                  onClick={() => {
                    downloadTextFile('registro-quejas.csv', buildRegistryCsv(report.items));
                    setShowMoreMenu(false);
                  }}
                >
                  Descargar CSV detalle
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showPdfModal && (
        <ReportPdfModal report={report} onClose={() => setShowPdfModal(false)} />
      )}

      {!totals.count ? (
        <div className="gallery__state gallery__state--empty">
          <p>No hay quejas en este período para armar el informe.</p>
        </div>
      ) : (
        <>
          <MoneyTable title="Por agregador" rows={report.aggregators} nameKey="Agregador" pctLabel="% rec." />
          <MoneyTable
            title="Combos con mayor % de quejas"
            rows={report.combos}
            nameKey="Combo"
            pctLabel="% de quejas"
          />
          <MoneyTable title="Por motivo" rows={report.reasons} nameKey="Motivo" pctLabel="% rec." />
          <MoneyTable
            title="Por día"
            rows={report.days.map((row) => ({ ...row, label: formatDayLabel(row.key) }))}
            nameKey="Día"
            pctLabel="% rec."
          />

          <section className="metrics-report__block">
            <h3>Detalle</h3>
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
                    {extras.map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.orderCode}</strong>
                        <small>{getAggregatorLabel(item.aggregator)}</small>
                      </td>
                      <td>{item.day ? formatDayLabel(item.day) : '—'}</td>
                      <td>{item.combo || '—'}</td>
                      <td>{item.reason || '—'}</td>
                      <td>{formatMoney(item.amount)}</td>
                      <td>{COMPLAINT_STATUS_LABELS[item.status] || item.status}</td>
                      <td>{item.photoUrl ? 'Sí' : 'No'}</td>
                      {extras.map((key) => (
                        <td key={key}>{item.fields?.[key] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
