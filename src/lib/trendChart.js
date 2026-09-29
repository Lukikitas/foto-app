import {
  compareSummaries,
  DEFAULT_AWT_TARGET_PCT,
  DEFAULT_COMPLAINT_TARGET_PCT,
  formatDayLabel,
  formatMoney,
  formatNumber,
  formatPct,
  previousPeriod,
  summarizeRange,
} from './metrics.js';
import { groupHistoryFlags } from './complaintHistory.js';
import { getAggregatorLabel } from './aggregators.js';

export const TREND_VIEWS = [
  { id: 'operation', label: 'Operación' },
  { id: 'money', label: 'Dinero' },
];

// Fixed colors per surface so the same markup renders identically in the app
// (light/dark), in the printed report and in the exported PNG.
export const TREND_PALETTES = {
  light: {
    bg: '#f7f3ee',
    grid: '#e3dbd1',
    axis: '#7c828b',
    text: '#1c1d20',
    orders: '#b3b8bf',
    complaints: '#E4002B',
    pct: '#2156c7',
    target: '#1b7a45',
    recovered: '#1b7a45',
    dispute: '#2156c7',
    lost: '#b42318',
  },
  dark: {
    bg: '#1f1f1f',
    grid: '#2e2e2e',
    axis: '#8a8f97',
    text: '#f1f1f1',
    orders: '#565b62',
    complaints: '#E4002B',
    pct: '#6ea0e8',
    target: '#3dba70',
    recovered: '#3dba70',
    dispute: '#6ea0e8',
    lost: '#f97066',
  },
  print: {
    bg: '#ffffff',
    grid: '#e2e8f0',
    axis: '#64748b',
    text: '#0f172a',
    orders: '#cbd5e1',
    complaints: '#E4002B',
    pct: '#2563eb',
    target: '#16a34a',
    recovered: '#16a34a',
    dispute: '#2563eb',
    lost: '#dc2626',
  },
};

const FONT_FAMILY = 'system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

export function trendChartSize(view = 'operation') {
  // Wide landscape ratios so the SVG fills the card width without letterbox
  // gaps: height = containerWidth × (height / width).
  return { width: 1120, height: view === 'money' ? 270 : 300 };
}

function pickTotals(row, fallback = {}) {
  const source = row || fallback;
  return {
    orders: Number(source.orders) || 0,
    complaints: Number(source.complaints) || 0,
    complaintPct: source.complaintPct ?? null,
    awt: Number(source.awt) || 0,
    awtPct: source.awtPct ?? null,
    complaintAmount: Number(source.complaintAmount) || 0,
    recoveredAmount: Number(source.recoveredAmount) || 0,
    inProgressAmount: Number(source.inProgressAmount) || 0,
    lostAmount: Number(source.lostAmount) || 0,
    recoveredPctOfAmount: source.recoveredPctOfAmount ?? null,
  };
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const normalized = value / pow;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * pow;
}

function formatAxisMoney(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 0 })}k`;
  return `$${value.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

function xLabel(day) {
  return String(day || '').slice(5).replace('-', '/');
}

function scaledBarHeight(value, max, height) {
  if (!(value > 0)) return 0;
  return Math.max(1.5, (value / max) * height);
}

/**
 * Daily trend rows plus period totals, deltas vs the previous period of the
 * same length, targets and peak days. Reuses the same summarizeRange logic
 * the dashboard table uses so numbers always match.
 */
export function buildTrendSeries(store, history, { from = '', to = '', aggregator = 'all' } = {}) {
  const previous = previousPeriod(from, to);
  const historyFlags = groupHistoryFlags(history, previous.from, to);
  const summary = summarizeRange(store, {}, from, to, historyFlags);
  const previousSummary = summarizeRange(store, {}, previous.from, previous.to, historyFlags);
  const aggId = aggregator && aggregator !== 'all' ? aggregator : 'all';

  const totalsRow = aggId === 'all'
    ? summary.overall
    : summary.aggregators.find((row) => row.id === aggId) || summary.overall;
  const previousRow = aggId === 'all'
    ? previousSummary.overall
    : previousSummary.aggregators.find((row) => row.id === aggId) || previousSummary.overall;

  const target = Number.isFinite(Number(store?.targetComplaintPct))
    ? Number(store.targetComplaintPct)
    : DEFAULT_COMPLAINT_TARGET_PCT;
  const awtTarget = Number.isFinite(Number(store?.targetAwtPct))
    ? Number(store.targetAwtPct)
    : DEFAULT_AWT_TARGET_PCT;

  const rows = summary.daily.map((entry) => {
    const row = aggId === 'all'
      ? entry
      : entry.aggregators.find((item) => item.aggregator === aggId) || entry;
    return { day: entry.day, ...pickTotals(row) };
  });

  const totals = pickTotals(totalsRow);
  const previousTotals = pickTotals(previousRow);
  const compared = compareSummaries(totals, previousTotals, target, awtTarget);

  const withPct = rows.filter((row) => row.orders > 0 && row.complaintPct != null);
  const worstPct = withPct.reduce(
    (best, row) => (!best || row.complaintPct > best.complaintPct ? row : best),
    null,
  );
  const topComplaints = rows.reduce(
    (best, row) => (!best || row.complaints > best.complaints ? row : best),
    null,
  );
  const topRecovered = rows.reduce(
    (best, row) => (!best || row.recoveredAmount > best.recoveredAmount ? row : best),
    null,
  );

  return {
    from,
    to,
    aggregator: aggId,
    target,
    awtTarget,
    rows,
    totals,
    previous: previousTotals,
    compared,
    peaks: { worstPct, topComplaints, topRecovered },
    hasData: rows.some((row) => row.orders > 0 || row.complaints > 0 || row.complaintAmount > 0),
  };
}

function legendItem(x, y, color, label, { line = false, dashed = false, textColor = color } = {}) {
  const swatch = line
    ? `<line x1="${x}" y1="${y + 5}" x2="${x + 14}" y2="${y + 5}" stroke="${color}" stroke-width="2.5"${dashed ? ' stroke-dasharray="5 4"' : ''} />`
    : `<rect x="${x}" y="${y}" width="11" height="11" rx="2" fill="${color}" />`;
  const text = `<text x="${x + 19}" y="${y + 9.5}" font-size="10.5" fill="${esc(textColor)}" font-weight="600">${esc(label)}</text>`;
  return { markup: swatch + text, nextX: x + 19 + label.length * 6.2 + 16 };
}

function chartHeader(series, palette, chartWidth) {
  const aggLabel = series.aggregator === 'all'
    ? 'Todos los agregadores'
    : getAggregatorLabel(series.aggregator);
  const periodLabel = `${formatDayLabel(series.from)} → ${formatDayLabel(series.to)}`;
  return `
    <text x="46" y="18" font-size="13" font-weight="700" fill="${palette.text}">Tendencia de pedidos y quejas</text>
    <text x="${chartWidth - 46}" y="18" font-size="10.5" fill="${palette.axis}" text-anchor="end">${esc(`${periodLabel} · ${aggLabel}`)}</text>`;
}

function emptyChart(palette) {
  const { width, height } = trendChartSize('operation');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}">
    <rect width="${width}" height="${height}" fill="${palette.bg}" />
    <text x="${width / 2}" y="${height / 2}" font-size="13" fill="${palette.axis}" text-anchor="middle">Sin datos en el período</text>
  </svg>`;
}

function operationChart(series, palette, { header = false } = {}) {
  const { width, height } = trendChartSize('operation');
  const rows = series.rows;
  const n = rows.length;
  const margin = { left: 44, right: 44, top: header ? 62 : 34, bottom: 26 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const gap = 12;
  const panelAH = Math.round((plotH - gap) * 0.4);
  const panelBH = plotH - gap - panelAH;
  const panelA = { x: margin.left, y: margin.top, w: plotW, h: panelAH };
  const panelB = { x: margin.left, y: margin.top + panelAH + gap, w: plotW, h: panelBH };

  const maxOrders = niceMax(Math.max(...rows.map((row) => row.orders), 0));
  const maxComplaints = niceMax(Math.max(...rows.map((row) => row.complaints), 0));
  const pctValues = rows.map((row) => row.complaintPct).filter((value) => value != null);
  const maxPct = niceMax(Math.max(...pctValues, series.target, 1) * 1.1);

  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(2, Math.min(12, slot * 0.5));
  const step = Math.max(1, Math.ceil(n / 10));

  const parts = [];
  parts.push(`<rect width="${width}" height="${height}" fill="${palette.bg}" />`);
  if (header) parts.push(chartHeader(series, palette, width));

  let legendX = 44;
  const legendY = header ? 36 : 8;
  const legendItems = [
    { color: palette.orders, label: 'Pedidos' },
    { color: palette.complaints, label: 'Quejas' },
    { color: palette.pct, label: '% quejas', line: true },
    { color: palette.target, label: `Objetivo ${formatPct(series.target, 1)}`, line: true, dashed: true },
  ];
  for (const item of legendItems) {
    const entry = legendItem(legendX, legendY, item.color, item.label, { ...item, textColor: palette.text });
    parts.push(entry.markup);
    legendX = entry.nextX;
  }

  for (let i = 0; i <= 2; i += 1) {
    const ratio = i / 2;
    const yA = panelA.y + panelA.h - ratio * panelA.h;
    const yB = panelB.y + panelB.h - ratio * panelB.h;
    parts.push(`<line x1="${panelA.x}" y1="${yA}" x2="${panelA.x + panelA.w}" y2="${yA}" stroke="${palette.grid}" stroke-width="1" />`);
    parts.push(`<text x="${panelA.x - 6}" y="${yA + 3.5}" font-size="9" fill="${palette.axis}" text-anchor="end">${formatNumber(Math.round(maxOrders * ratio))}</text>`);
    parts.push(`<line x1="${panelB.x}" y1="${yB}" x2="${panelB.x + panelB.w}" y2="${yB}" stroke="${palette.grid}" stroke-width="1" />`);
    parts.push(`<text x="${panelB.x - 6}" y="${yB + 3.5}" font-size="9" fill="${palette.axis}" text-anchor="end">${formatNumber(Math.round(maxComplaints * ratio))}</text>`);
    parts.push(`<text x="${panelB.x + panelB.w + 6}" y="${yB + 3.5}" font-size="9" fill="${palette.pct}">${formatPct(maxPct * ratio, 1)}</text>`);
  }

  rows.forEach((row, index) => {
    const cx = panelA.x + slot * (index + 0.5);
    const barHeight = scaledBarHeight(row.orders, maxOrders, panelA.h);
    if (barHeight > 0) {
      parts.push(`<g><title>${esc(`${formatDayLabel(row.day)} · ${formatNumber(row.orders)} pedidos`)}</title>
        <rect x="${(cx - barW / 2).toFixed(1)}" y="${(panelA.y + panelA.h - barHeight).toFixed(1)}" width="${barW.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="1.5" fill="${palette.orders}" /></g>`);
    }
    if (index % step === 0) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${panelB.y + panelB.h + 16}" font-size="9.5" fill="${palette.axis}" text-anchor="middle">${xLabel(row.day)}</text>`);
    }
  });
  parts.push(`<line x1="${panelA.x}" y1="${panelA.y + panelA.h}" x2="${panelA.x + panelA.w}" y2="${panelA.y + panelA.h}" stroke="${palette.axis}" stroke-width="1" />`);

  rows.forEach((row, index) => {
    const cx = panelB.x + slot * (index + 0.5);
    const barHeight = scaledBarHeight(row.complaints, maxComplaints, panelB.h);
    if (barHeight > 0) {
      parts.push(`<g><title>${esc(`${formatDayLabel(row.day)} · ${formatNumber(row.complaints)} quejas`)}</title>
        <rect x="${(cx - barW / 2).toFixed(1)}" y="${(panelB.y + panelB.h - barHeight).toFixed(1)}" width="${barW.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="1.5" fill="${palette.complaints}" /></g>`);
    }
  });
  parts.push(`<line x1="${panelB.x}" y1="${panelB.y + panelB.h}" x2="${panelB.x + panelB.w}" y2="${panelB.y + panelB.h}" stroke="${palette.axis}" stroke-width="1" />`);

  const pctPoints = [];
  rows.forEach((row, index) => {
    if (row.complaintPct == null) return;
    const cx = panelB.x + slot * (index + 0.5);
    const cy = panelB.y + panelB.h - (row.complaintPct / maxPct) * panelB.h;
    pctPoints.push({ cx, cy, row });
  });
  if (pctPoints.length > 1) {
    parts.push(`<polyline points="${pctPoints.map((point) => `${point.cx.toFixed(1)},${point.cy.toFixed(1)}`).join(' ')}" fill="none" stroke="${palette.pct}" stroke-width="2.25" stroke-linejoin="round" />`);
  }
  pctPoints.forEach(({ cx, cy, row }) => {
    parts.push(`<g><title>${esc(`${formatDayLabel(row.day)} · ${formatPct(row.complaintPct)} de quejas (${formatNumber(row.complaints)}/${formatNumber(row.orders)})`)}</title>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="${palette.bg}" stroke="${palette.pct}" stroke-width="2" /></g>`);
  });

  const targetY = panelB.y + panelB.h - (series.target / maxPct) * panelB.h;
  parts.push(`<line x1="${panelB.x}" y1="${targetY.toFixed(1)}" x2="${panelB.x + panelB.w}" y2="${targetY.toFixed(1)}" stroke="${palette.target}" stroke-width="1.75" stroke-dasharray="6 4" />`);
  const targetLabelY = targetY - 6 < panelB.y + 10 ? targetY + 13 : targetY - 6;
  parts.push(`<text x="${panelB.x + 6}" y="${targetLabelY.toFixed(1)}" font-size="9" font-weight="700" fill="${palette.target}" stroke="${palette.bg}" stroke-width="3" paint-order="stroke">objetivo ${esc(formatPct(series.target, 1))}</text>`);

  const peak = series.peaks.worstPct;
  if (peak && peak.complaintPct != null) {
    const point = pctPoints.find((pointRow) => pointRow.row.day === peak.day);
    if (point) {
      const labelY = Math.max(panelB.y + 12, point.cy - 9);
      parts.push(`<circle cx="${point.cx.toFixed(1)}" cy="${point.cy.toFixed(1)}" r="5.5" fill="none" stroke="${palette.complaints}" stroke-width="1.75" />`);
      parts.push(`<text x="${point.cx.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="9" font-weight="700" fill="${palette.complaints}" stroke="${palette.bg}" stroke-width="3" paint-order="stroke" text-anchor="middle">pico ${esc(formatPct(peak.complaintPct, 1))}</text>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}">${parts.join('')}</svg>`;
}

function moneyChart(series, palette, { header = false } = {}) {
  const { width, height } = trendChartSize('money');
  const rows = series.rows;
  const n = rows.length;
  const margin = { left: 56, right: 20, top: header ? 62 : 34, bottom: 26 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const maxAmount = niceMax(Math.max(...rows.map((row) => row.complaintAmount), 0) * 1.05);
  const slot = plotW / Math.max(n, 1);
  const barW = Math.max(2, Math.min(14, slot * 0.55));
  const step = Math.max(1, Math.ceil(n / 10));
  const showLabels = n > 0 && n <= 10;

  const parts = [];
  parts.push(`<rect width="${width}" height="${height}" fill="${palette.bg}" />`);
  if (header) parts.push(chartHeader(series, palette, width));

  let legendX = 44;
  const legendY = header ? 36 : 8;
  const legendItems = [
    { color: palette.recovered, label: '$ recuperado' },
    { color: palette.dispute, label: '$ en disputa' },
    { color: palette.lost, label: '$ perdido' },
  ];
  for (const item of legendItems) {
    const entry = legendItem(legendX, legendY, item.color, item.label, { textColor: palette.text });
    parts.push(entry.markup);
    legendX = entry.nextX;
  }

  for (let i = 0; i <= 2; i += 1) {
    const ratio = i / 2;
    const y = margin.top + plotH - ratio * plotH;
    parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="${palette.grid}" stroke-width="1" />`);
    parts.push(`<text x="${margin.left - 6}" y="${y + 3.5}" font-size="9" fill="${palette.axis}" text-anchor="end">${formatAxisMoney(maxAmount * ratio)}</text>`);
  }

  rows.forEach((row, index) => {
    const cx = margin.left + slot * (index + 0.5);
    const x = cx - barW / 2;
    const segments = [
      { value: row.recoveredAmount, color: palette.recovered },
      { value: row.inProgressAmount, color: palette.dispute },
      { value: row.lostAmount, color: palette.lost },
    ];
    const tooltip = `${formatDayLabel(row.day)} · ${formatMoney(row.complaintAmount)} (rec. ${formatMoney(row.recoveredAmount)} · disputa ${formatMoney(row.inProgressAmount)} · perdido ${formatMoney(row.lostAmount)})`;
    let cursorY = margin.top + plotH;
    const bars = segments
      .map((segment) => {
        const segmentHeight = scaledBarHeight(segment.value, maxAmount, plotH);
        if (segmentHeight <= 0) return '';
        cursorY -= segmentHeight;
        return `<rect x="${x.toFixed(1)}" y="${cursorY.toFixed(1)}" width="${barW.toFixed(1)}" height="${segmentHeight.toFixed(1)}" fill="${segment.color}" />`;
      })
      .join('');
    if (bars) {
      parts.push(`<g><title>${esc(tooltip)}</title>${bars}</g>`);
      if (showLabels) {
        parts.push(`<text x="${cx.toFixed(1)}" y="${(cursorY - 5).toFixed(1)}" font-size="9" fill="${palette.axis}" text-anchor="middle">${formatAxisMoney(row.complaintAmount)}</text>`);
      }
    }
    if (index % step === 0) {
      parts.push(`<text x="${cx.toFixed(1)}" y="${margin.top + plotH + 16}" font-size="9.5" fill="${palette.axis}" text-anchor="middle">${xLabel(row.day)}</text>`);
    }
  });
  parts.push(`<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="${palette.axis}" stroke-width="1" />`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}">${parts.join('')}</svg>`;
}

/** Self-contained SVG markup (no CSS variables) for app, report and PNG export.
 * The built-in title/period header is only useful for standalone images. */
export function buildTrendChartSvg(series, { palette = 'print', view = 'operation', header = false } = {}) {
  const colors = TREND_PALETTES[palette] || TREND_PALETTES.print;
  if (!series || !series.rows?.length || !series.hasData) return emptyChart(colors);
  return view === 'money' ? moneyChart(series, colors, { header }) : operationChart(series, colors, { header });
}

export function buildTrendCsv(series) {
  const columns = [
    'dia',
    'pedidos',
    'quejas',
    'porcentaje_quejas',
    'awt',
    'porcentaje_awt',
    'monto_quejas',
    'monto_recuperado',
    'monto_en_disputa',
    'monto_perdido',
  ];
  const lines = [columns.join(',')];
  for (const row of series?.rows || []) {
    lines.push([
      row.day,
      row.orders,
      row.complaints,
      row.complaintPct == null ? '' : Number(row.complaintPct).toFixed(2),
      row.awt,
      row.awtPct == null ? '' : Number(row.awtPct).toFixed(2),
      row.complaintAmount,
      row.recoveredAmount,
      row.inProgressAmount,
      row.lostAmount,
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Rasterizes the SVG string to a PNG blob (browser only). */
export function trendSvgToPngBlob(svgMarkup, { width, height, scale = 2, background = '#ffffff' } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('La exportación PNG solo está disponible en el navegador.'));
      return;
    }
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo preparar la imagen.');
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('No se pudo generar la imagen.'));
        }, 'image/png');
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo renderizar el gráfico.'));
    };
    image.src = url;
  });
}

