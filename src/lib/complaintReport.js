import { buildMetricsQuality, translatedReason } from './metricsQuality.js';
import { getAggregatorLabel } from './aggregators.js';
import {
  addMoneyToFlags,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUSES,
  EMPTY_COMBO_LABEL,
  emptyHistoryFlags,
  listHistoryItems,
  NO_REFUTABLE_REASONS,
  reasonComment,
  reasonPreset,
  REFUTATION_REJECTED_REASONS,
} from './complaintHistory.js';
import { formatPct, ratioPct } from './metrics.js';
import { buildReportRates } from './reportRates.js';

function knownAmount(row, key) {return !Number(row[key]) && row.missingMoney?.[key] ? 'Sin monto' : row[key] || 0;}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function countStatus(items, options = {}) {
  const flags = emptyHistoryFlags();
  flags.count = items.length;
  items.forEach((item) => {
    if (item.status === COMPLAINT_STATUSES.refutado_aceptado) flags.refutadoAceptado += 1;
    else if (item.status === COMPLAINT_STATUSES.refutado_rechazado) flags.refutadoRechazado += 1;
    else if (item.status === COMPLAINT_STATUSES.refutado) flags.refutado += 1;
    else if (item.status === COMPLAINT_STATUSES.no_refutable) flags.noRefutable += 1;
    else flags.queja += 1;
    addMoneyToFlags(flags, item, options);
  });
  flags.recoveredPct = ratioPct(flags.recoveredAmount, flags.complaintAmount);
  return flags;
}

function groupBy(items, keyFn, options = {}) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return [...map.entries()].map(([key, group]) => ({ key, items: group, ...countStatus(group, options) }));
}

export function comboRanking(items, options = {}) {
  const informedCount = items.filter((item) => String(item.combo || '').trim()).length;
  return groupBy(items, (item) => String(item.combo || '').trim() || EMPTY_COMBO_LABEL, options)
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

// Comentarios libres de un motivo guardado ("Preset · comentario"), sin repetir.
function reasonComments(items, field) {
  const comments = [];
  items.forEach((item) => {
    const comment = reasonComment(item[field]);
    if (comment && !comments.includes(comment)) comments.push(comment);
  });
  return comments;
}

/**
 * Top de motivos de un estado puntual (Ref. rechazado / No refutable):
 * agrupa por preset, mide el % sobre el total de ese estado y ordena por
 * cantidad y después por monto.
 */
export function reasonRanking(items, { status, presets = [], field }) {
  const statusItems = items.filter((item) => item.status === status);
  return groupBy(statusItems, (item) => reasonPreset(item[field], presets))
    .map((row) => ({
      key: row.key,
      count: row.count,
      sharePct: ratioPct(row.count, statusItems.length),
      complaintAmount: row.complaintAmount,
      lostAmount: row.lostAmount,
      comments: reasonComments(row.items, field),
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.complaintAmount - left.complaintAmount ||
        String(left.key).localeCompare(String(right.key)),
    );
}

export function buildComplaintReport(store, { from = '', to = '', aggregator = 'all', metrics = null, refutadoDays = metrics?.refutadoDays, today } = {}) {
  const options = { refutadoDays, today };
  const items = listHistoryItems(store, { from, to, aggregator });
  const totals = countStatus(items, options);
  const aggregators = groupBy(items, (item) => item.aggregator || 'sin_agregador', options)
    .map((row) => ({
      ...row,
      id: row.key,
      label: row.key === 'sin_agregador' ? 'Sin agregador' : getAggregatorLabel(row.key),
    }))
    .sort((left, right) => right.complaintAmount - left.complaintAmount);

  const reasons = groupBy(items, (item) => translatedReason(item.reason), options).sort(
    (left, right) => right.count - left.count,
  );

  const days = groupBy(items, (item) => item.day || 'sin-fecha', options).sort((left, right) =>
    String(left.key).localeCompare(String(right.key)),
  );

  return {
    from,
    to,
    aggregator,
    items,
    totals,
    rates: buildReportRates(metrics, store, { from, to, aggregator }),
    aggregators,
    combos: comboRanking(items, options),
    generatedAt: new Date().toISOString(),
    sources: "Pedidos/quejas/AWT: cargas diarias. Casos, estados y montos: historial. Recuperado según estado aceptado.",
    warnings: metrics ? buildMetricsQuality(metrics, store, {from,to}, aggregator).warnings : (totals.missingAmountCount ? [totals.missingAmountCount + " casos sin monto; los totales monetarios son parciales"] : []),
    reasons,
    days,
    // Top de motivos por estado «disciplinario» (se agrupan por preset).
    rejectionReasons: reasonRanking(items, {
      status: COMPLAINT_STATUSES.refutado_rechazado,
      presets: REFUTATION_REJECTED_REASONS,
      field: 'rejectionReason',
    }),
    unrefutableReasons: reasonRanking(items, {
      status: COMPLAINT_STATUSES.no_refutable,
      presets: NO_REFUTABLE_REASONS,
      field: 'unrefutableReason',
    }),
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
    'motivo_no_refutable',
    'motivo_rechazo',
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
        item.unrefutableReason || '',
        item.rejectionReason || '',
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
  const lines = ['seccion,clave,quejas,$ quejas,$ recuperado,$ en disputa,total_no_recuperado,participacion_quejas,pendiente_refutar,perdida_confirmada,casos_sin_monto'];
  const push = (section, key, row, share) => {
    lines.push(
      [section, key, row.count, row.complaintAmount, row.recoveredAmount, row.inProgressAmount || 0, row.lostAmount, share ?? '', row.pendingAmount, row.finalLostAmount, row.missingAmountCount]
        .map(csvEscape)
        .join(','),
    );
  };
  lines.push(['fuentes',report.sources].map(csvEscape).join(','));
  lines.push(['generado',report.generatedAt].map(csvEscape).join(','));
  report.warnings?.forEach(warning=>lines.push(['advertencia',warning].map(csvEscape).join(',')));
  push('total', `${report.from} a ${report.to}`, report.totals);
  report.aggregators.forEach((row) => push('agregador', row.label, row));
  report.combos.forEach((row) => push('combo', row.combo, row, formatPct(row.sharePct)));
  report.reasons.forEach((row) => push('motivo', row.key, row));
  report.days.forEach((row) => push('dia', row.key, row));
  return `${lines.join('\n')}\n`;
}

import { CELL_STYLES, colToLetter, downloadBlob, generateXlsxBlob } from './xlsxExport.js';

export function buildRegistryWorkbook(items, context = null) {
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
    { value: 'Motivo no refutable', style: CELL_STYLES.HEADER },
    { value: 'Motivo rechazo', style: CELL_STYLES.HEADER },
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
        { value: item.amount == null ? 'Sin monto' : Number(item.amount), style: CELL_STYLES.CURRENCY },
        { value: COMPLAINT_STATUS_LABELS[item.status] || item.status, style: CELL_STYLES.TEXT_BORDER },
        { value: item.unrefutableReason || '', style: CELL_STYLES.TEXT_BORDER },
        { value: item.rejectionReason || '', style: CELL_STYLES.TEXT_BORDER },
        { value: item.photoUrl ? 'Sí' : 'No', style: CELL_STYLES.CENTER },
        ...extras.map((k) => ({ value: item.fields?.[k] ?? '', style: CELL_STYLES.TEXT_BORDER })),
      ],
    })),
  ];

  return {
    sheets: [
      {
        name: 'Registro Quejas',
        rows,
        columnWidths: [16, 12, 10, 15, 24, 24, 30, 14, 16, 22, 22, 8, ...extras.map(() => 16)],
      },
      ...(context ? [{name:'Contexto',columnWidths:[24,85],rows:Object.entries({...context,Generación:new Date().toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}),Fuente:'Casos del historial; estados registrados',Advertencias:items.filter(item=>item.amount==null).length+' casos sin monto. El listado no representa los totales diarios.'}).map(([key,value])=>({cells:[{value:key,style:CELL_STYLES.TEXT_BORDER},{value:String(value),style:CELL_STYLES.TEXT_BORDER}]}))}] : []),
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
    {cells:[{value:report.sources,style:CELL_STYLES.SUBTITLE}]},
    ...((report.warnings||[]).map(warning=>({cells:[{value:"Advertencia: "+warning,style:CELL_STYLES.SUBTITLE}]}))),
    {cells:[{value:"Recuperado = estado aceptado; En disputa = refutado; Pendiente = abierta dentro del plazo; Pérdida confirmada = rechazada, no refutable o vencida. Total no recuperado conserva rechazadas y sin refutar; excluye en disputa. Montos conocidos, parciales si faltan importes.",style:CELL_STYLES.SUBTITLE}]},
    {cells:[{value:"Pendiente de refutar",style:CELL_STYLES.TEXT_BORDER},{value:totals.pendingAmount,style:CELL_STYLES.CURRENCY}]},
    {cells:[{value:"Pérdida confirmada",style:CELL_STYLES.TEXT_BORDER},{value:totals.finalLostAmount,style:CELL_STYLES.CURRENCY}]},
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
        { value: 'EN DISPUTA', style: CELL_STYLES.KPI_TITLE },
        { value: 'TOTAL NO RECUPERADO', style: CELL_STYLES.KPI_TITLE },
        { value: '% RECUPERO', style: CELL_STYLES.KPI_TITLE },
      ],
    },
    // KPI Cards Values
    {
      height: 26,
      cells: [
        { value: totals.count || 0, style: CELL_STYLES.KPI_VALUE },
        { value: knownAmount(totals, "complaintAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(totals, "recoveredAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(totals, "inProgressAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(totals, "lostAmount"), style: CELL_STYLES.CURRENCY },
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
        { value: 'Sin refutar (cálculo anterior, incluye no refutables)', style: CELL_STYLES.TEXT_BORDER },
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
        { value: knownAmount(totals, "inProgressAmount"), style: CELL_STYLES.CURRENCY },
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
        { value: knownAmount(totals, "recoveredAmount"), style: CELL_STYLES.CURRENCY },
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
        { value: knownAmount(totals, "complaintAmount"), style: CELL_STYLES.TOTAL_CURRENCY },
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
    { value: '$ En Disputa', style: CELL_STYLES.HEADER },
    { value: 'Total no recuperado', style: CELL_STYLES.HEADER },
  ];
  const aggRows = [
    { height: 24, cells: aggHeader },
    ...report.aggregators.map((row) => ({
      cells: [
        { value: row.label || row.id, style: CELL_STYLES.TEXT_BORDER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: totals.count ? row.count / totals.count : 0, style: CELL_STYLES.PERCENT },
        { value: (row.recoveredPct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: knownAmount(row, "complaintAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "recoveredAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "inProgressAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "lostAmount"), style: CELL_STYLES.CURRENCY },
      ],
    })),
    {
      cells: [
        { value: 'TOTAL GENERAL', style: CELL_STYLES.TOTAL_LABEL },
        { value: totals.count || 0, style: CELL_STYLES.TOTAL_INT },
        { value: 1, style: CELL_STYLES.TOTAL_PERCENT },
        { value: (totals.recoveredPct || 0) / 100, style: CELL_STYLES.TOTAL_PERCENT },
        { value: knownAmount(totals, "complaintAmount"), style: CELL_STYLES.TOTAL_CURRENCY },
        { value: knownAmount(totals, "recoveredAmount"), style: CELL_STYLES.TOTAL_CURRENCY },
        { value: knownAmount(totals, "inProgressAmount"), style: CELL_STYLES.TOTAL_CURRENCY },
        { value: knownAmount(totals, "lostAmount"), style: CELL_STYLES.TOTAL_CURRENCY },
      ],
    },
  ];

  aggRows[0].cells.push({value:'Pendiente de refutar',style:CELL_STYLES.HEADER},{value:'Pérdida confirmada',style:CELL_STYLES.HEADER},{value:'Sin monto',style:CELL_STYLES.HEADER});
  report.aggregators.forEach((row,index)=>aggRows[index+1].cells.push({value:row.pendingAmount,style:CELL_STYLES.CURRENCY},{value:row.finalLostAmount,style:CELL_STYLES.CURRENCY},{value:row.missingAmountCount,style:CELL_STYLES.INTEGER}));
  aggRows.at(-1).cells.push({value:knownAmount(totals,"pendingAmount"),style:CELL_STYLES.TOTAL_CURRENCY},{value:knownAmount(totals,"finalLostAmount"),style:CELL_STYLES.TOTAL_CURRENCY},{value:totals.missingAmountCount,style:CELL_STYLES.TOTAL_INT});
  // 3. Top Combos
  const combosHeader = [
    { value: 'Combo / Producto', style: CELL_STYLES.HEADER },
    { value: 'Quejas', style: CELL_STYLES.HEADER },
    { value: '% del Total', style: CELL_STYLES.HEADER },
    { value: '$ Reclamado', style: CELL_STYLES.HEADER },
    { value: '$ Recuperado', style: CELL_STYLES.HEADER },
    { value: '$ En Disputa', style: CELL_STYLES.HEADER },
    { value: 'Total no recuperado', style: CELL_STYLES.HEADER },
  ];
  const combosRows = [
    { height: 24, cells: combosHeader },
    ...report.combos.map((row) => ({
      cells: [
        { value: row.combo || 'Sin combo', style: CELL_STYLES.TEXT_BORDER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: (row.sharePct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: knownAmount(row, "complaintAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "recoveredAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "inProgressAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "lostAmount"), style: CELL_STYLES.CURRENCY },
      ],
    })),
  ];

  combosRows[0].cells.push({value:'Pendiente de refutar',style:CELL_STYLES.HEADER},{value:'Pérdida confirmada',style:CELL_STYLES.HEADER},{value:'Sin monto',style:CELL_STYLES.HEADER});
  report.combos.forEach((row,index)=>combosRows[index+1].cells.push({value:row.pendingAmount,style:CELL_STYLES.CURRENCY},{value:row.finalLostAmount,style:CELL_STYLES.CURRENCY},{value:row.missingAmountCount,style:CELL_STYLES.INTEGER}));
  // 4. Por Motivo
  const reasonsHeader = [
    { value: 'Motivo de Queja', style: CELL_STYLES.HEADER },
    { value: 'Quejas', style: CELL_STYLES.HEADER },
    { value: '% Quejas', style: CELL_STYLES.HEADER },
    { value: '% Recupero', style: CELL_STYLES.HEADER },
    { value: '$ Reclamado', style: CELL_STYLES.HEADER },
    { value: '$ Recuperado', style: CELL_STYLES.HEADER },
    { value: '$ En Disputa', style: CELL_STYLES.HEADER },
    { value: 'Total no recuperado', style: CELL_STYLES.HEADER },
  ];
  const reasonsRows = [
    { height: 24, cells: reasonsHeader },
    ...report.reasons.map((row) => ({
      cells: [
        { value: row.key || 'Sin motivo', style: CELL_STYLES.TEXT_BORDER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: totals.count ? row.count / totals.count : 0, style: CELL_STYLES.PERCENT },
        { value: (row.recoveredPct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: knownAmount(row, "complaintAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "recoveredAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "inProgressAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "lostAmount"), style: CELL_STYLES.CURRENCY },
      ],
    })),
  ];

  reasonsRows[0].cells.push({value:'Pendiente de refutar',style:CELL_STYLES.HEADER},{value:'Pérdida confirmada',style:CELL_STYLES.HEADER},{value:'Sin monto',style:CELL_STYLES.HEADER});
  report.reasons.forEach((row,index)=>reasonsRows[index+1].cells.push({value:row.pendingAmount,style:CELL_STYLES.CURRENCY},{value:row.finalLostAmount,style:CELL_STYLES.CURRENCY},{value:row.missingAmountCount,style:CELL_STYLES.INTEGER}));
  // 5. Por Día
  const daysHeader = [
    { value: 'Fecha', style: CELL_STYLES.HEADER },
    { value: 'Quejas', style: CELL_STYLES.HEADER },
    { value: '% Recupero', style: CELL_STYLES.HEADER },
    { value: '$ Reclamado', style: CELL_STYLES.HEADER },
    { value: '$ Recuperado', style: CELL_STYLES.HEADER },
    { value: '$ En Disputa', style: CELL_STYLES.HEADER },
    { value: 'Total no recuperado', style: CELL_STYLES.HEADER },
  ];
  const daysRows = [
    { height: 24, cells: daysHeader },
    ...report.days.map((row) => ({
      cells: [
        { value: row.key || '—', style: CELL_STYLES.CENTER },
        { value: row.count, style: CELL_STYLES.INTEGER },
        { value: (row.recoveredPct || 0) / 100, style: CELL_STYLES.PERCENT },
        { value: knownAmount(row, "complaintAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "recoveredAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "inProgressAmount"), style: CELL_STYLES.CURRENCY },
        { value: knownAmount(row, "lostAmount"), style: CELL_STYLES.CURRENCY },
      ],
    })),
  ];

  daysRows[0].cells.push({value:'Pendiente de refutar',style:CELL_STYLES.HEADER},{value:'Pérdida confirmada',style:CELL_STYLES.HEADER},{value:'Sin monto',style:CELL_STYLES.HEADER});
  report.days.forEach((row,index)=>daysRows[index+1].cells.push({value:row.pendingAmount,style:CELL_STYLES.CURRENCY},{value:row.finalLostAmount,style:CELL_STYLES.CURRENCY},{value:row.missingAmountCount,style:CELL_STYLES.INTEGER}));
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
    { value: 'Motivo no refutable', style: CELL_STYLES.HEADER },
    { value: 'Motivo rechazo', style: CELL_STYLES.HEADER },
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
        { value: item.amount == null ? 'Sin monto' : Number(item.amount), style: CELL_STYLES.CURRENCY },
        { value: COMPLAINT_STATUS_LABELS[item.status] || item.status, style: CELL_STYLES.CENTER },
        { value: item.unrefutableReason || '', style: CELL_STYLES.TEXT_BORDER },
        { value: item.rejectionReason || '', style: CELL_STYLES.TEXT_BORDER },
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
        autoFilter: `A1:K${aggRows.length}`,
        rows: aggRows,
      },
      {
        name: 'Top Combos',
        colWidths: [32, 12, 14, 18, 18, 18],
        autoFilter: `A1:J${combosRows.length}`,
        rows: combosRows,
      },
      {
        name: 'Por Motivo',
        colWidths: [30, 12, 14, 14, 18, 18, 18],
        autoFilter: `A1:K${reasonsRows.length}`,
        rows: reasonsRows,
      },
      {
        name: 'Por Día',
        colWidths: [18, 12, 14, 18, 18, 18],
        autoFilter: `A1:J${daysRows.length}`,
        rows: daysRows,
      },
      {
        name: 'Detalle de Quejas',
        colWidths: [18, 14, 12, 18, 24, 26, 32, 16, 18, 22, 22, 10, ...extras.map(() => 18)],
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

export function downloadRegistryXlsx(items, filename = 'registro-quejas.xlsx', context = null) {
  const blob = generateXlsxBlob(buildRegistryWorkbook(items, context));
  downloadBlob(blob, filename);
}
