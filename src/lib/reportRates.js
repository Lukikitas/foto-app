import { getAggregatorLabel } from './aggregators.js';
import { groupHistoryFlags } from './complaintHistory.js';
import { AWT_AGGREGATOR, METRIC_AGGREGATORS, complaintRate, enumerateDays, resolveDayAggregator } from './metrics.js';

export const REPORT_RATES_NOTE = '% quejas = quejas / pedidos × 100. % sin refutadas aceptadas = (quejas − refutadas aceptadas) / pedidos × 100. AWT = demorados / pedidos de PedidosYa × 100. Los totales parciales incluyen únicamente los días cargados; las aceptadas se descuentan de esos mismos días. — indica que falta la base para calcular.';

export function buildReportRates(metrics, history, { from, to, aggregator = 'all' }) {
  if (!metrics) return { aggregators: [], daily: [] };
  const ids = aggregator === 'all' ? METRIC_AGGREGATORS : METRIC_AGGREGATORS.filter(id => id === aggregator);
  const flags = groupHistoryFlags(history, from, to);
  const daily = enumerateDays(from, to).flatMap(day => ids.map(id => {
    const row = resolveDayAggregator(metrics, {}, day, id, flags);
    const stats = metrics.days?.[day]?.[id];
    return {
      day, id, label: getAggregatorLabel(id),
      loaded: Boolean(stats),
      orders: !stats || stats.reported?.orders === false ? null : row.orders,
      complaints: !stats || stats.reported?.complaints === false ? null : row.complaints,
      accepted: row.refutadoAceptado,
      awt: id !== AWT_AGGREGATOR || !stats || stats.reported?.awt === false ? null : row.awt,
    };
  }));
  const sum = (rows, key) => !rows.length || rows.some(row => row[key] == null) ? null : rows.reduce((total, row) => total + row[key], 0);
  const rates = row => ({
    ...row,
    complaintPct: row.complaints == null ? null : complaintRate(row.orders, row.complaints),
    adjustedComplaintPct: row.complaints == null ? null : complaintRate(row.orders, Math.max(0, row.complaints - row.accepted)),
    awtPct: row.awt == null ? null : complaintRate(row.orders, row.awt),
  });
  return {
    aggregators: ids.map(id => {
      const rows = daily.filter(row => row.id === id);
      // A day with no saved load cannot erase the rates of the loaded days.
      // Keep accepted cases on the same dates as the orders used as the base.
      const loadedRows = rows.filter(row => row.loaded);
      return rates({
        id, label: getAggregatorLabel(id),
        loadedDays: loadedRows.length, totalDays: rows.length,
        partial: loadedRows.length > 0 && loadedRows.length < rows.length,
        ...Object.fromEntries(['orders', 'complaints', 'accepted', 'awt'].map(key => [key, sum(loadedRows, key)])),
      });
    }),
    daily: daily.map(rates),
  };
}
