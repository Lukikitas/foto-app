import { getAggregatorLabel } from './aggregators.js';
import {
  addMoneyToFlags,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUSES,
  EMPTY_COMBO_LABEL,
  emptyHistoryFlags,
  listHistoryItems,
} from './complaintHistory.js';
import { formatPct, ratioPct } from './metrics.js';

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function countStatus(items) {
  const flags = emptyHistoryFlags();
  flags.count = items.length;
  items.forEach((item) => {
    if (item.status === COMPLAINT_STATUSES.refutado_aceptado) flags.refutadoAceptado += 1;
    else if (item.status === COMPLAINT_STATUSES.refutado_rechazado) flags.refutadoRechazado += 1;
    else if (item.status === COMPLAINT_STATUSES.refutado) flags.refutado += 1;
    else flags.queja += 1;
    addMoneyToFlags(flags, item);
  });
  flags.recoveredPct = ratioPct(flags.recoveredAmount, flags.complaintAmount);
  return flags;
}

function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()].map(([key, group]) => ({ key, items: group, ...countStatus(group) }));
}

export function comboRanking(items) {
  const informedCount = items.filter((item) => String(item.combo || '').trim()).length;
  return groupBy(items, (item) => String(item.combo || '').trim() || EMPTY_COMBO_LABEL)
    .map((row) => ({
      ...row,
      combo: row.key,
      sharePct:
        row.key === EMPTY_COMBO_LABEL
          ? ratioPct(row.count, items.length)
          : ratioPct(row.count, informedCount),
    }))
    .sort((left, right) => right.count - left.count || String(left.combo).localeCompare(right.combo));
}

export function buildComplaintReport(store, { from = '', to = '', aggregator = 'all' } = {}) {
  const items = listHistoryItems(store, { from, to, aggregator });
  const totals = countStatus(items);
  const aggregators = groupBy(items, (item) => item.aggregator || 'sin_agregador')
    .map((row) => ({
      ...row,
      id: row.key,
      label: row.key === 'sin_agregador' ? 'Sin agregador' : getAggregatorLabel(row.key),
    }))
    .sort((left, right) => right.complaintAmount - left.complaintAmount);

  const reasons = groupBy(items, (item) => String(item.reason || '').trim() || 'Sin motivo').sort(
    (left, right) => right.count - left.count,
  );

  const days = groupBy(items, (item) => item.day || 'sin-fecha').sort((left, right) =>
    String(left.key).localeCompare(String(right.key)),
  );

  return {
    from,
    to,
    aggregator,
    items,
    totals,
    aggregators,
    combos: comboRanking(items),
    reasons,
    days,
  };
}

export function extraFieldKeys(items) {
  const keys = new Set();
  items.forEach((item) => {
    Object.keys(item.fields || {}).forEach((key) => keys.add(key));
  });
  return [...keys];
}

export function buildRegistryCsv(items) {
  const extras = extraFieldKeys(items);
  const header = [
    'codigo',
    'fecha',
    'hora',
    'agregador',
    'combo',
    'motivo',
    'comentario',
    'monto',
    'estado',
    'foto',
    ...extras,
  ];
  const lines = [header.map(csvEscape).join(',')];
  items.forEach((item) => {
    lines.push(
      [
        item.orderCode,
        item.day,
        item.timeOfDay,
        item.aggregator || '',
        item.combo,
        item.reason,
        item.comment,
        item.amount ?? '',
        COMPLAINT_STATUS_LABELS[item.status] || item.status,
        item.photoUrl ? 'si' : 'no',
        ...extras.map((key) => item.fields?.[key] || ''),
      ]
        .map(csvEscape)
        .join(','),
    );
  });
  return `${lines.join('\n')}\n`;
}

export function buildReportCsv(report) {
  const lines = ['seccion,clave,quejas,$ quejas,$ recuperado,$ perdido,% quejas'];
  const push = (section, key, row, share) => {
    lines.push(
      [section, key, row.count, row.complaintAmount, row.recoveredAmount, row.lostAmount, share ?? '']
        .map(csvEscape)
        .join(','),
    );
  };
  push('total', `${report.from} a ${report.to}`, report.totals);
  report.aggregators.forEach((row) => push('agregador', row.label, row));
  report.combos.forEach((row) => push('combo', row.combo, row, formatPct(row.sharePct)));
  report.reasons.forEach((row) => push('motivo', row.key, row));
  report.days.forEach((row) => push('dia', row.key, row));
  return `${lines.join('\n')}\n`;
}
