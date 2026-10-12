import { formatDayLabel, formatNumber, formatPct } from '../lib/metrics';

export default function ReportRatesTable({ rows, daily = false }) {
  if (!rows?.length) return null;
  const showAwt = rows.some(row => row.id === 'pedidosya');
  const count = value => value == null ? 'Sin cargar' : formatNumber(value);
  return <details className="metrics-report__block" open>
    <summary>{daily ? 'Porcentajes diarios por agregador' : 'Porcentajes del rango por agregador'}</summary>
    <div className="metrics-table-wrap"><table className="metrics-table">
      <thead><tr>{daily && <th>Día</th>}<th>Agregador</th><th>Pedidos</th><th>Quejas</th><th>% quejas</th><th>Refutadas aceptadas</th><th>% sin refutadas aceptadas</th>{showAwt && <th>AWT Peya (%)</th>}</tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.day || 'range'}-${row.id}`}>
        {daily && <td>{formatDayLabel(row.day)}</td>}<td>{row.label}{!daily && <small>{row.partial ? 'Parcial · ' : ''}{row.loadedDays}/{row.totalDays} días cargados</small>}</td><td>{count(row.orders)}</td><td>{count(row.complaints)}</td><td>{formatPct(row.complaintPct)}</td><td>{count(row.accepted)}</td><td>{formatPct(row.adjustedComplaintPct)}</td>{showAwt && <td>{row.id === 'pedidosya' ? formatPct(row.awtPct) : 'No aplica'}</td>}
      </tr>)}</tbody>
    </table></div>
  </details>;
}
