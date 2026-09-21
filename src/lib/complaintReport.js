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

import { CELL_STYLES, colToLetter, downloadBlob, generateXlsxBlob } from './xlsxExport.js';

export function buildRegistryWorkbook(items, title = 'Detalle de Reclamos') {
  const extras = extraFieldKeys(items);
  const header = [
    { value: 'Código Pedido', style: CELL_STYLES.HEADER },
    { value: 'Fecha', style: CELL_STYLES.HEADER },
    { value: 'Hora', style: CELL_STYLES.HEADER },
    { value: 'Agregador', style: CELL_STYLES.HEADER },
    { value: 'Combo', style: CELL_STYLES.HEADER },
    { value: 'Motivo', style: CELL_STYLES.HEADER },
    { value: 'Observaciones', style: CELL_STYLES.HEADER },
    { value: 'Monto ($)', style: CELL_STYLES.HEADER },
    { value: 'Estado', style: CELL_STYLES.HEADER },
    { value: 'Foto', style: CELL_STYLES.HEADER },
    ...extras.map((k) => ({ value: k, style: CELL_STYLES.HEADER })),
  ];

  const rows = [
    { height: 24, cells: header },
    ...items.map((item) => ({
      cells: [
        { value: item.orderCode, style: CELL_STYLES.CENTER },
        { value: item.day || '—', style: CELL_STYLES.CENTER },
        { value: item.timeOfDay || '—', style: CELL_STYLES.CENTER },
        { value: getAggregatorLabel(item.aggregator), style: CELL_STYLES.TEXT_BORDER },
        { value: item.combo || '—', style: CELL_STYLES.TEXT_BORDER },
        { value: item.reason || '—', style: CELL_STYLES.TEXT_BORDER },
        { value: item.comment || '—', style: CELL_STYLES.TEXT_BORDER },
        { value: Number(item.amount) || 0, style: CELL_STYLES.CURRENCY },
        { value: COMPLAINT_STATUS_LABELS[item.status] || item.status, style: CELL_STYLES.CENTER },
        { value: item.photoUrl ? 'Sí' : 'No', style: CELL_STYLES.CENTER },
        ...extras.map((key) => ({ value: item.fields?.[key] || '—', style: CELL_STYLES.TEXT_BORDER })),
      ],
    })),
  ];

  const lastColLetter = colToLetter(header.length - 1);
  return {
    sheets: [
      {
        name: title.slice(0, 31),
        colWidths: [18, 14, 12, 18, 24, 26, 32, 16, 18, 10, ...extras.map(() => 18)],
        autoFilter: `A1:${lastColLetter}${rows.length}`,
        rows,
      },
    ],
  };
}

export function buildReportWorkbook(report) {
  const totals = report.totals || {};
  const aggLabel =
    report.aggregator && report.aggregator !== 'all'
      ? getAggregatorLabel(report.aggregator)
      : 'Todos los agregadores';
  const periodLabel = `${report.from || 'Inicio'} al ${report.to || 'Fin'}`;

  // 1. Hoja Resumen
  const resumenRows = [
    {
      height: 28,
      cells: [{ value: 'DELIVERY LA PLATA — INFORME EJECUTIVO DE RECLAMOS', style: CELL_STYLES.TITLE }],
    },
    {
      height: 18,
      cells: [
        {
          value: `Período: ${periodLabel}   |   Filtro: ${aggLabel}   |   Emisión: ${new Date().toLocaleString('es-AR')}`,
          style: CELL_STYLES.SUBTITLE,
        },
      ],
    },
    { cells: [] },
    // KPI Cards Header
    {
      height: 22,
      cells: [
        { value: 'TOTAL QUEJAS', style: CELL_STYLES.KPI_TITLE },
        { value: '$ QUEJAS (TOTAL)', style: CELL_STYLES.KPI_TITLE },
        { value: '$ RECUPERADO', style: CELL_STYLES.KPI_TITLE },
        { value: '$ PERDIDO (NETO)', style: CELL_STYLES.KPI_TITLE },
        { value: '% RECUPERO', style: CELL_STYLES.KPI_TITLE },
      ],
    },
    // KPI Cards Values
    {
      height: 26,
      cells: [
        { value: totals.count || 0, style: CELL_STYLES.KPI_VALUE },
        { value: totals.complaintAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: totals.recoveredAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: totals.lostAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: (totals.recoveredPct || 0) / 100, style: CELL_STYLES.PERCENT },
      ],
    },
    { cells: [] },
    // Estado de trámites
    {
      height: 22,
      cells: [
        { value: 'ESTADO DE RESOLUCIÓN Y DISPUTAS', style: CELL_STYLES.HEADER },
        { value: 'MONTO ($)', style: CELL_STYLES.HEADER },
        { value: 'CANTIDAD', style: CELL_STYLES.HEADER },
        { value: '% SOBRE RECLAMOS', style: CELL_STYLES.HEADER },
      ],
    },
    {
      cells: [
        { value: 'Sin disputar (pendiente)', style: CELL_STYLES.TEXT_BORDER },
        { value: totals.undisputedAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: totals.queja || 0, style: CELL_STYLES.INTEGER },
        {
          value: totals.complaintAmount ? (totals.undisputedAmount || 0) / totals.complaintAmount : 0,
          style: CELL_STYLES.PERCENT,
        },
      ],
    },
    {
      cells: [
        { value: 'En trámite (Refutado en espera)', style: CELL_STYLES.TEXT_BORDER },
        { value: totals.inProgressAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: totals.refutado || 0, style: CELL_STYLES.INTEGER },
        {
          value: totals.complaintAmount ? (totals.inProgressAmount || 0) / totals.complaintAmount : 0,
          style: CELL_STYLES.PERCENT,
        },
      ],
    },
    {
      cells: [
        { value: 'Refutación rechazada (Pérdida confirmada)', style: CELL_STYLES.TEXT_BORDER },
        { value: totals.confirmedLostAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: totals.refutadoRechazado || 0, style: CELL_STYLES.INTEGER },
        {
          value: totals.complaintAmount ? (totals.confirmedLostAmount || 0) / totals.complaintAmount : 0,
          style: CELL_STYLES.PERCENT,
        },
      ],
    },
    {
      cells: [
        { value: 'Refutación aceptada (Recuperado)', style: CELL_STYLES.TEXT_BORDER },
        { value: totals.recoveredAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: totals.refutadoAceptado || 0, style: CELL_STYLES.INTEGER },
        {
          value: totals.complaintAmount ? (totals.recoveredAmount || 0) / totals.complaintAmount : 0,
          style: CELL_STYLES.PERCENT,
        },
      ],
    },
    {
      cells: [
        { value: 'TOTAL RECLAMOS', style: CELL_STYLES.TOTAL_LABEL },
        { value: totals.complaintAmount || 0, style: CELL_STYLES.TOTAL_CURRENCY },
        { value: totals.count || 0, style: CELL_STYLES.TOTAL_INT },
        { value: 1, style: CELL_STYLES.TOTAL_PERCENT },
      ],
    },
  ];

  // 2. Por Agregador
  const aggHeader = [
    { value: 'Agregador', style: CELL_STYLES.HEADER },
    { value: 'Quejas', style: CELL_STYLES.HEADER },
    { value: '% Quejas', style: CELL_STYLES.HEADER },
    { value: '% Recupero', style: CELL_STYLES.HEADER },
    { value: '$ Reclamado', style: CELL_STYLES.HEADER },
    { value: '$ Recuperado', style: CELL_STYLES.HEADER },
    { value: '$ Perdido Neto', style: CELL_STYLES.HEADER },
  ];
  const aggRows = [
    { height: 24, cells: aggHeader },
    ...report.aggregators.map((row) => ({
      cells: [
        { value: row.label || row.id, style: CELL_STYLES.TEXT_BORDER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: totals.count ? row.count / totals.count : 0, style: CELL_STYLES.PERCENT },
        { value: (row.recoveredPct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: row.complaintAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.recoveredAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.lostAmount || 0, style: CELL_STYLES.CURRENCY },
      ],
    })),
    {
      cells: [
        { value: 'TOTAL GENERAL', style: CELL_STYLES.TOTAL_LABEL },
        { value: totals.count || 0, style: CELL_STYLES.TOTAL_INT },
        { value: 1, style: CELL_STYLES.TOTAL_PERCENT },
        { value: (totals.recoveredPct || 0) / 100, style: CELL_STYLES.TOTAL_PERCENT },
        { value: totals.complaintAmount || 0, style: CELL_STYLES.TOTAL_CURRENCY },
        { value: totals.recoveredAmount || 0, style: CELL_STYLES.TOTAL_CURRENCY },
        { value: totals.lostAmount || 0, style: CELL_STYLES.TOTAL_CURRENCY },
      ],
    },
  ];

  // 3. Top Combos
  const combosHeader = [
    { value: 'Combo / Producto', style: CELL_STYLES.HEADER },
    { value: 'Quejas', style: CELL_STYLES.HEADER },
    { value: '% del Total', style: CELL_STYLES.HEADER },
    { value: '$ Reclamado', style: CELL_STYLES.HEADER },
    { value: '$ Recuperado', style: CELL_STYLES.HEADER },
    { value: '$ Perdido Neto', style: CELL_STYLES.HEADER },
  ];
  const combosRows = [
    { height: 24, cells: combosHeader },
    ...report.combos.map((row) => ({
      cells: [
        { value: row.combo || 'Sin combo', style: CELL_STYLES.TEXT_BORDER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: (row.sharePct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: row.complaintAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.recoveredAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.lostAmount || 0, style: CELL_STYLES.CURRENCY },
      ],
    })),
  ];

  // 4. Por Motivo
  const reasonsHeader = [
    { value: 'Motivo de Queja', style: CELL_STYLES.HEADER },
    { value: 'Quejas', style: CELL_STYLES.HEADER },
    { value: '% Quejas', style: CELL_STYLES.HEADER },
    { value: '% Recupero', style: CELL_STYLES.HEADER },
    { value: '$ Reclamado', style: CELL_STYLES.HEADER },
    { value: '$ Recuperado', style: CELL_STYLES.HEADER },
    { value: '$ Perdido Neto', style: CELL_STYLES.HEADER },
  ];
  const reasonsRows = [
    { height: 24, cells: reasonsHeader },
    ...report.reasons.map((row) => ({
      cells: [
        { value: row.key || 'Sin motivo', style: CELL_STYLES.TEXT_BORDER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: totals.count ? row.count / totals.count : 0, style: CELL_STYLES.PERCENT },
        { value: (row.recoveredPct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: row.complaintAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.recoveredAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.lostAmount || 0, style: CELL_STYLES.CURRENCY },
      ],
    })),
  ];

  // 5. Por Día
  const daysHeader = [
    { value: 'Fecha', style: CELL_STYLES.HEADER },
    { value: 'Quejas', style: CELL_STYLES.HEADER },
    { value: '% Recupero', style: CELL_STYLES.HEADER },
    { value: '$ Reclamado', style: CELL_STYLES.HEADER },
    { value: '$ Recuperado', style: CELL_STYLES.HEADER },
    { value: '$ Perdido Neto', style: CELL_STYLES.HEADER },
  ];
  const daysRows = [
    { height: 24, cells: daysHeader },
    ...report.days.map((row) => ({
      cells: [
        { value: row.key || '—', style: CELL_STYLES.CENTER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: (row.recoveredPct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: row.complaintAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.recoveredAmount || 0, style: CELL_STYLES.CURRENCY },
        { value: row.lostAmount || 0, style: CELL_STYLES.CURRENCY },
      ],
    })),
  ];

  // 6. Detalle de Quejas
  const extras = extraFieldKeys(report.items);
  const detailHeader = [
    { value: 'Código Pedido', style: CELL_STYLES.HEADER },
    { value: 'Fecha', style: CELL_STYLES.HEADER },
    { value: 'Hora', style: CELL_STYLES.HEADER },
    { value: 'Agregador', style: CELL_STYLES.HEADER },
    { value: 'Combo', style: CELL_STYLES.HEADER },
    { value: 'Motivo', style: CELL_STYLES.HEADER },
    { value: 'Observaciones', style: CELL_STYLES.HEADER },
    { value: 'Monto ($)', style: CELL_STYLES.HEADER },
    { value: 'Estado', style: CELL_STYLES.HEADER },
    { value: 'Foto', style: CELL_STYLES.HEADER },
    ...extras.map((k) => ({ value: k, style: CELL_STYLES.HEADER })),
  ];
  const detailRows = [
    { height: 24, cells: detailHeader },
    ...report.items.map((item) => ({
      cells: [
        { value: item.orderCode, style: CELL_STYLES.CENTER },
        { value: item.day || '—', style: CELL_STYLES.CENTER },
        { value: item.timeOfDay || '—', style: CELL_STYLES.CENTER },
        { value: getAggregatorLabel(item.aggregator), style: CELL_STYLES.TEXT_BORDER },
        { value: item.combo || '—', style: CELL_STYLES.TEXT_BORDER },
        { value: item.reason || '—', style: CELL_STYLES.TEXT_BORDER },
        { value: item.comment || '—', style: CELL_STYLES.TEXT_BORDER },
        { value: Number(item.amount) || 0, style: CELL_STYLES.CURRENCY },
        { value: COMPLAINT_STATUS_LABELS[item.status] || item.status, style: CELL_STYLES.CENTER },
        { value: item.photoUrl ? 'Sí' : 'No', style: CELL_STYLES.CENTER },
        ...extras.map((key) => ({ value: item.fields?.[key] || '—', style: CELL_STYLES.TEXT_BORDER })),
      ],
    })),
  ];

  const lastDetailCol = colToLetter(detailHeader.length - 1);

  return {
    sheets: [
      {
        name: 'Resumen',
        colWidths: [28, 22, 20, 22, 18],
        rows: resumenRows,
      },
      {
        name: 'Por Agregador',
        colWidths: [22, 12, 14, 14, 18, 18, 18],
        autoFilter: `A1:G${aggRows.length}`,
        rows: aggRows,
      },
      {
        name: 'Top Combos',
        colWidths: [32, 12, 14, 18, 18, 18],
        autoFilter: `A1:F${combosRows.length}`,
        rows: combosRows,
      },
      {
        name: 'Por Motivo',
        colWidths: [30, 12, 14, 14, 18, 18, 18],
        autoFilter: `A1:G${reasonsRows.length}`,
        rows: reasonsRows,
      },
      {
        name: 'Por Día',
        colWidths: [18, 12, 14, 18, 18, 18],
        autoFilter: `A1:F${daysRows.length}`,
        rows: daysRows,
      },
      {
        name: 'Detalle de Quejas',
        colWidths: [18, 14, 12, 18, 24, 26, 32, 16, 18, 10, ...extras.map(() => 18)],
        autoFilter: `A1:${lastDetailCol}${detailRows.length}`,
        rows: detailRows,
      },
    ],
  };
}

export function downloadReportXlsx(report, filename) {
  const name =
    filename ||
    `informe-quejas-${report.from ? `${report.from}-a-${report.to}` : 'completo'}.xlsx`;
  const blob = generateXlsxBlob(buildReportWorkbook(report));
  downloadBlob(blob, name);
}

export function downloadRegistryXlsx(items, filename = 'registro-quejas.xlsx') {
  const blob = generateXlsxBlob(buildRegistryWorkbook(items));
  downloadBlob(blob, filename);
}
