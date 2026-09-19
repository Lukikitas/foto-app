import { useMemo } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { COMPLAINT_STATUS_LABELS } from '../lib/complaintHistory';
import { buildComplaintReport, buildRegistryCsv, buildReportCsv, extraFieldKeys } from '../lib/complaintReport';
import { downloadTextFile } from '../lib/complaints';
import { formatDayLabel, formatMoney, formatNumber, formatPct } from '../lib/metrics';

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
            <article className="metrics-kpi metrics-kpi--good">
              <p>$ recuperado</p>
              <strong>{formatMoney(totals.recoveredAmount)}</strong>
              <span>Volvió con Ref. aceptado</span>
            </article>
            <article className="metrics-kpi metrics-kpi--bad">
              <p>$ perdido</p>
              <strong>{formatMoney(totals.lostAmount)}</strong>
              <span>Quejas menos recuperado</span>
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
            className="btn btn--primary btn--small"
            onClick={() => downloadTextFile('informe-quejas.csv', buildReportCsv(report))}
            disabled={!totals.count}
          >
            Exportar informe
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => downloadTextFile('registro-quejas.csv', buildRegistryCsv(report.items))}
            disabled={!totals.count}
          >
            Exportar detalle
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </header>

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
