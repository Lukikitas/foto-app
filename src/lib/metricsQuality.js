import { enumerateDays, METRIC_AGGREGATORS } from './metrics.js';
import { listHistoryItems } from './complaintHistory.js';

export function buildMetricsQuality(store, history, range, aggregator = 'all') {
  const summarized = history?.quality?.[`${range.from}|${range.to}|${aggregator}`];
  if (summarized) return summarized;
  const items = listHistoryItems(history, { ...range, from: range.from, to: range.to, aggregator });
  const rows = [];
  for (const day of enumerateDays(range.from, range.to)) {
    for (const id of aggregator === 'all' ? METRIC_AGGREGATORS : [aggregator]) {
      const stats = store.days?.[day]?.[id];
      const cases = items.filter(item => item.day === day && item.aggregator === id).length;
      const state = !stats ? 'missing' : !stats.reported || Object.values(stats.reported).some(value=>value===null) ? 'legacy' :
        stats.reported.orders && stats.reported.complaints && (id !== 'pedidosya' || stats.reported.awt) ? 'complete' : 'partial';
      rows.push({ day, aggregator: id, state, reported: stats?.reported?.complaints === false ? null : stats?.complaints ?? null, cases,
        discrepancy: Boolean(stats && stats.reported?.complaints !== false && stats.complaints !== cases) });
    }
  }
  const missingAmounts = items.filter(item => item.amount == null).length;
  const missing = rows.filter(row => row.state === 'missing').length;
  const partial = rows.filter(row => row.state === 'partial').length;
  const legacy = rows.filter(row => row.state === 'legacy').length;
  const discrepancies = rows.filter(row => row.discrepancy);
  const warnings = [];
  if (missing) warnings.push(`${missing} cargas de día/agregador sin informar`);
  if (partial) warnings.push(`${partial} cargas parciales`);
  if (legacy) warnings.push(`${legacy} cargas anteriores sin detalle de completitud u origen`);
  if (discrepancies.length) warnings.push(`${discrepancies.length} diferencias entre quejas diarias y casos del historial`);
  if (missingAmounts) warnings.push(`${missingAmounts} casos sin monto informado`);
  return { rows, missing, partial, legacy, discrepancies, missingAmounts, warnings, cases: items.length };
}

export function validateMetricFields(day, fields, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day || day > today) return 'Elegí una fecha válida, hasta hoy inclusive.';
  for (const row of Object.values(fields)) {
    for (const value of Object.values(row)) {
      if (value !== '' && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)) return 'Las cantidades deben ser números enteros, no negativos.';
    }
    if (row.orders !== '' && row.complaints !== '' && Number(row.complaints) > Number(row.orders)) return 'Las quejas no pueden superar la cantidad de pedidos.';
    if (row.orders !== '' && row.awt !== '' && Number(row.awt) > Number(row.orders)) return 'Los demorados no pueden superar la cantidad de pedidos.';
  }
  return '';
}

export function translatedReason(value) {
  return ({ 'missing item': 'Producto faltante', 'wrong item': 'Producto incorrecto', 'food quality': 'Calidad de la comida' })[String(value || '').toLowerCase()] || value || 'Sin motivo';
}
