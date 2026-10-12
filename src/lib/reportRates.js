import { getAggregatorLabel } from './aggregators.js';
import { groupHistoryFlags } from './complaintHistory.js';
import { AWT_AGGREGATOR, METRIC_AGGREGATORS, complaintRate, enumerateDays, resolveDayAggregator } from './metrics.js';

export const REPORT_RATES_NOTE = '% quejas = quejas / pedidos × 100. % sin refutadas aceptadas = (quejas − refutadas aceptadas) / pedidos × 100. AWT = demorados / pedidos de PedidosYa × 100. — indica datos sin cargar o sin pedidos como base.';

export function buildReportRates(metrics, history, { from, to, aggregator = 'all' }) {
  if (!metrics) return { aggregators: [], daily: [] };
  const ids = aggregator === 'all' ? METRIC_AGGREGATORS : METRIC_AGGREGATORS.filter(id => id === aggregator);
  const flags = groupHistoryFlags(history, from, to);
  const daily = enumerateDays(from, to).flatMap(day => ids.map(id => {
    const row = resolveDayAggregator(metrics, {}, day, id, flags);
    const stats = metrics.days?.[day]?.[id];
    return {
      day, id, label: getAggregatorLabel(id),
      orders: !stats || stats.reported?.orders === false ? null : row.orders,
      complaints: !stats || stats.reported?.complaints === false ? null : row.complaints,
      accepted: row.refutadoAceptado,
      awt: id !== AWT_AGGREGATOR || !stats || stats.reported?.awt === false ? null : row.awt,
    };
  }));
  const sum = (rows, key) => rows.some(row => row[key] == null) ? null : rows.reduce((total, row) => total + row[key], 0);
  const rates = row => ({
    ...row,
    complaintPct: row.complaints == null ? null : complaintRate(row.orders, row.complaints),
    adjustedComplaintPct: row.complaints == null ? null : complaintRate(row.orders, Math.max(0, row.complaints - row.accepted)),
    awtPct: row.awt == null ? null : complaintRate(row.orders, row.awt),
  });
  return {
    aggregators: ids.map(id => {
      const rows = daily.filter(row => row.id === id);
      return rates({ id, label: getAggregatorLabel(id), ...Object.fromEntries(['orders', 'complaints', 'accepted', 'awt'].map(key => [key, sum(rows, key)])) });
    }),
    daily: daily.map(rates),
  };
}
