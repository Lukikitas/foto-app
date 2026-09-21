import { getAggregatorLabel } from './aggregators.js';
import { COMPLAINT_STATUS_LABELS } from './complaintHistory.js';
import { extraFieldKeys } from './complaintReport.js';
import { formatDayLabel, formatMoney, formatNumber, formatPct } from './metrics.js';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Builds the complete, self-contained HTML document string
 * with exact A4 print styles, vector colors, typography,
 * executive KPI cards, distribution bars, and analytical tables.
 */
export function generateReportHtml(report, { includeDetail = false } = {}) {
  const totals = report?.totals || {};
  const items = report?.items || [];
  const extras = extraFieldKeys(items).slice(0, 4);

  const aggLabel =
    report?.aggregator && report.aggregator !== 'all'
      ? getAggregatorLabel(report.aggregator)
      : 'Todos los agregadores';

  const periodLabel = report?.from
    ? `${formatDayLabel(report.from)}${report.from !== report.to ? ` al ${formatDayLabel(report.to)}` : ''}`
    : 'Período completo';

  const emissionDate = new Date().toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Calculate Insights
  const topAggregator = report.aggregators?.[0];
  const topCombo = report.combos?.[0];
  const topReason = report.reasons?.[0];

  const totalAmount = totals.complaintAmount || 0;
  const pctUndisputed = totalAmount ? ((totals.undisputedAmount || 0) / totalAmount) * 100 : 0;
  const pctInProgress = totalAmount ? ((totals.inProgressAmount || 0) / totalAmount) * 100 : 0;
  const pctRejected = totalAmount ? ((totals.confirmedLostAmount || 0) / totalAmount) * 100 : 0;
  const pctRecovered = totalAmount ? ((totals.recoveredAmount || 0) / totalAmount) * 100 : 0;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Informe de Métricas y Reclamos — Delivery La Plata</title>
  <style>
    /* ==========================================================================
       Print & Executive Document Styles
       ========================================================================== */
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
    }

    .report-paper {
      width: 100%;
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      padding: 32px 36px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }

    /* Top Brand Stripe */
    .report-top-stripe {
      height: 4px;
      background: #E4002B;
      border-radius: 2px;
      margin-bottom: 20px;
    }

    /* Header */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 16px;
      margin-bottom: 20px;
      gap: 16px;
    }

    .report-brand {
      display: flex;
      flex-direction: column;
    }

    .report-brand-tag {
      display: inline-block;
      background: #E4002B;
      color: #ffffff;
      font-size: 8pt;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      width: fit-content;
      margin-bottom: 6px;
    }

    .report-title {
      margin: 0;
      font-size: 16pt;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.2;
      letter-spacing: -0.01em;
    }

    .report-subtitle {
      margin: 4px 0 0;
      font-size: 9.5pt;
      font-weight: 600;
      color: #475569;
    }

    .report-meta {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
      min-width: 250px;
      font-size: 8.5pt;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .report-meta-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .report-meta-label {
      color: #64748b;
      font-weight: 500;
    }

    .report-meta-val {
      color: #0f172a;
      font-weight: 700;
      text-align: right;
    }

    /* KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 18px;
    }

    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-top: 3.5px solid #64748b;
      border-radius: 6px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
    }

    .kpi-card--total {
      border-top-color: #E4002B;
    }

    .kpi-card--good {
      border-top-color: #16a34a;
      background: #f0fdf4;
      border-color: #bbf7d0;
    }

    .kpi-card--bad {
      border-top-color: #dc2626;
      background: #fef2f2;
      border-color: #fecaca;
    }

    .kpi-card--count {
      border-top-color: #4f46e5;
    }

    .kpi-label {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 4px;
    }

    .kpi-val {
      font-size: 15pt;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }

    .kpi-card--good .kpi-val {
      color: #15803d;
    }

    .kpi-card--bad .kpi-val {
      color: #b91c1c;
    }

    .kpi-badge {
      display: inline-block;
      font-size: 8pt;
      font-weight: 700;
      color: #166534;
      margin-top: 4px;
    }

    .kpi-hint {
      font-size: 7.5pt;
      color: #64748b;
      margin-top: 4px;
    }

    /* Distribution Bar */
    .status-panel {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 20px;
    }

    .status-panel-title {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
      margin: 0 0 8px;
    }

    .progress-bar-wrap {
      display: flex;
      height: 12px;
      width: 100%;
      background: #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 10px;
    }

    .progress-bar-seg {
      height: 100%;
      transition: width 0.3s ease;
    }

    .seg-undisputed { background: #94a3b8; }
    .seg-inprogress { background: #3b82f6; }
    .seg-rejected { background: #ef4444; }
    .seg-recovered { background: #22c55e; }

    .status-legend {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      font-size: 7.8pt;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .legend-text {
      color: #334155;
    }

    .legend-text strong {
      color: #0f172a;
    }

    /* Insights Box */
    .insights-box {
      background: #f1f5f9;
      border-left: 4px solid #E4002B;
      border-radius: 0 6px 6px 0;
      padding: 10px 14px;
      margin-bottom: 20px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .insight-col {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .insight-title {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
    }

    .insight-desc {
      font-size: 8.5pt;
      color: #0f172a;
      font-weight: 600;
    }

    .insight-desc small {
      font-size: 7.5pt;
      font-weight: 400;
      color: #475569;
      display: block;
    }

    /* Section & Tables */
    .report-section {
      margin-bottom: 22px;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .report-section-title {
      font-size: 9.5pt;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #1e293b;
      margin: 0 0 8px;
      padding-bottom: 4px;
      border-bottom: 1.5px solid #cbd5e1;
    }

    .table-container {
      width: 100%;
      overflow: hidden;
      border: 1px solid #cbd5e1;
      border-radius: 5px;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.2pt;
      color: #0f172a;
    }

    .report-table thead {
      display: table-header-group;
    }

    .report-table tfoot {
      display: table-footer-group;
    }

    .report-table th {
      background: #1e293b;
      color: #ffffff;
      font-weight: 700;
      text-align: left;
      padding: 7px 10px;
      font-size: 7.5pt;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-right: 1px solid #334155;
    }

    .report-table th:last-child {
      border-right: none;
    }

    .report-table td {
      padding: 6px 10px;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1px solid #e2e8f0;
      font-variant-numeric: tabular-nums;
    }

    .report-table td:last-child {
      border-right: none;
    }

    .report-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }

    .report-table tbody tr:hover {
      background: #f1f5f9;
    }

    .report-table tfoot td {
      font-weight: 800;
      background: #e2e8f0;
      border-top: 2px solid #0f172a;
      border-bottom: none;
      color: #0f172a;
    }

    .col-right {
      text-align: right !important;
    }

    .col-center {
      text-align: center !important;
    }

    .badge-status {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 7pt;
      font-weight: 700;
      text-align: center;
      background: #e2e8f0;
      color: #334155;
    }

    .badge-status--accepted {
      background: #dcfce7;
      color: #166534;
    }

    .badge-status--rejected {
      background: #fee2e2;
      color: #991b1b;
    }

    .badge-status--pending {
      background: #f1f5f9;
      color: #475569;
    }

    /* Dense table for full complaint details */
    .table--dense th {
      padding: 5px 8px;
      font-size: 7pt;
    }

    .table--dense td {
      padding: 4px 8px;
      font-size: 7.5pt;
    }

    .page-break-before {
      page-break-before: always;
      break-before: page;
    }

    /* Footer */
    .report-footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 7.5pt;
      color: #94a3b8;
    }

    /* Screen UI Controls (Hidden when printed) */
    .no-print-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: #ffffff;
      padding: 12px 24px;
      position: sticky;
      top: 0;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .no-print-bar button {
      padding: 8px 16px;
      font-size: 9pt;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      border: none;
    }

    .btn-print {
      background: #E4002B;
      color: #ffffff;
    }

    .btn-print:hover {
      background: #c80026;
    }

    @media print {
      body {
        background: #ffffff !important;
      }
      .no-print-bar {
        display: none !important;
      }
      .report-paper {
        max-width: 100% !important;
        padding: 0 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      .report-section {
        page-break-inside: auto;
      }
      tr {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <div>
      <strong>Vista previa para PDF / Impresión</strong> · Delivery La Plata
    </div>
    <div>
      <button class="btn-print" onclick="window.print()">Guardar como PDF / Imprimir</button>
    </div>
  </div>

  <div class="report-paper">
    <div class="report-top-stripe"></div>

    <!-- Header -->
    <header class="report-header">
      <div class="report-brand">
        <span class="report-brand-tag">DELIVERY LA PLATA</span>
        <h1 class="report-title">Informe Gerencial de Quejas y Recuperos</h1>
        <p class="report-subtitle">Control de calidad operativo, reclamos y efectividad de refutaciones</p>
      </div>
      <div class="report-meta">
        <div class="report-meta-row">
          <span class="report-meta-label">Período analizado:</span>
          <span class="report-meta-val">${escapeHtml(periodLabel)}</span>
        </div>
        <div class="report-meta-row">
          <span class="report-meta-label">Filtro aplicado:</span>
          <span class="report-meta-val">${escapeHtml(aggLabel)}</span>
        </div>
        <div class="report-meta-row">
          <span class="report-meta-label">Fecha de emisión:</span>
          <span class="report-meta-val">${escapeHtml(emissionDate)}</span>
        </div>
      </div>
    </header>

    <!-- KPI Grid -->
    <section class="kpi-grid">
      <div class="kpi-card kpi-card--total">
        <span class="kpi-label">$ Reclamado Total</span>
        <span class="kpi-val">${formatMoney(totals.complaintAmount)}</span>
        <span class="kpi-hint">Plata dada al cliente en reclamos</span>
      </div>

      <div class="kpi-card kpi-card--good">
        <span class="kpi-label">$ Recuperado</span>
        <span class="kpi-val">${formatMoney(totals.recoveredAmount)}</span>
        <span class="kpi-badge">${formatPct(totals.recoveredPct)} de efectividad</span>
      </div>

      <div class="kpi-card kpi-card--bad">
        <span class="kpi-label">$ Pérdida Neta</span>
        <span class="kpi-val">${formatMoney(totals.lostAmount)}</span>
        <span class="kpi-hint">Reclamos menos recuperos</span>
      </div>

      <div class="kpi-card kpi-card--count">
        <span class="kpi-label">Pedidos con Reclamo</span>
        <span class="kpi-val">${formatNumber(totals.count)}</span>
        <span class="kpi-hint">${totals.refutadoAceptado ? `${formatNumber(totals.refutadoAceptado)} recuperados con éxito` : 'Quejas registradas'}</span>
      </div>
    </section>

    <!-- Status Distribution Panel -->
    <section class="status-panel">
      <div class="status-panel-title">Estado de Trámites y Gestión de Disputas</div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-seg seg-undisputed" style="width: ${pctUndisputed}%;" title="Sin disputar: ${formatMoney(totals.undisputedAmount)} (${formatPct(pctUndisputed)})"></div>
        <div class="progress-bar-seg seg-inprogress" style="width: ${pctInProgress}%;" title="En trámite: ${formatMoney(totals.inProgressAmount)} (${formatPct(pctInProgress)})"></div>
        <div class="progress-bar-seg seg-rejected" style="width: ${pctRejected}%;" title="Rechazado: ${formatMoney(totals.confirmedLostAmount)} (${formatPct(pctRejected)})"></div>
        <div class="progress-bar-seg seg-recovered" style="width: ${pctRecovered}%;" title="Recuperado: ${formatMoney(totals.recoveredAmount)} (${formatPct(pctRecovered)})"></div>
      </div>
      <div class="status-legend">
        <div class="legend-item">
          <span class="legend-dot seg-undisputed"></span>
          <span class="legend-text">Sin disputar: <strong>${formatMoney(totals.undisputedAmount)}</strong> <small>(${formatNumber(totals.queja || 0)})</small></span>
        </div>
        <div class="legend-item">
          <span class="legend-dot seg-inprogress"></span>
          <span class="legend-text">En trámite: <strong>${formatMoney(totals.inProgressAmount)}</strong> <small>(${formatNumber(totals.refutado || 0)})</small></span>
        </div>
        <div class="legend-item">
          <span class="legend-dot seg-rejected"></span>
          <span class="legend-text">Rechazada: <strong>${formatMoney(totals.confirmedLostAmount)}</strong> <small>(${formatNumber(totals.refutadoRechazado || 0)})</small></span>
        </div>
        <div class="legend-item">
          <span class="legend-dot seg-recovered"></span>
          <span class="legend-text">Aceptada: <strong>${formatMoney(totals.recoveredAmount)}</strong> <small>(${formatNumber(totals.refutadoAceptado || 0)})</small></span>
        </div>
      </div>
    </section>

    <!-- Executive Insights -->
    <section class="insights-box">
      <div class="insight-col">
        <span class="insight-title">Plataforma Principal</span>
        <span class="insight-desc">${escapeHtml(topAggregator ? topAggregator.label || topAggregator.id : 'N/A')}</span>
        <small>${topAggregator ? `${formatMoney(topAggregator.complaintAmount)} (${formatNumber(topAggregator.count)} quejas)` : 'Sin datos'}</small>
      </div>
      <div class="insight-col">
        <span class="insight-title">Combo Más Reclamado</span>
        <span class="insight-desc">${escapeHtml(topCombo ? topCombo.combo || 'Sin combo' : 'N/A')}</span>
        <small>${topCombo ? `${formatNumber(topCombo.count)} reclamos (${formatPct(topCombo.sharePct)} del total)` : 'Sin datos'}</small>
      </div>
      <div class="insight-col">
        <span class="insight-title">Causa Principal</span>
        <span class="insight-desc">${escapeHtml(topReason ? topReason.key : 'N/A')}</span>
        <small>${topReason ? `${formatNumber(topReason.count)} quejas · ${formatMoney(topReason.complaintAmount)}` : 'Sin datos'}</small>
      </div>
    </section>

    <!-- Table 1: Por Agregador -->
    ${report.aggregators?.length > 0 ? `
    <section class="report-section">
      <h2 class="report-section-title">Desglose por Agregador</h2>
      <div class="table-container">
        <table class="report-table">
          <thead>
            <tr>
              <th>Agregador</th>
              <th class="col-right">Quejas</th>
              <th class="col-right">% Quejas</th>
              <th class="col-right">% Recupero</th>
              <th class="col-right">$ Reclamado</th>
              <th class="col-right">$ Recuperado</th>
              <th class="col-right">$ Pérdida Neta</th>
            </tr>
          </thead>
          <tbody>
            ${report.aggregators.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.label || row.id)}</strong></td>
              <td class="col-right">${formatNumber(row.count)}</td>
              <td class="col-right">${formatPct(totals.count ? (row.count / totals.count) * 100 : 0)}</td>
              <td class="col-right">${formatPct(row.recoveredPct)}</td>
              <td class="col-right">${formatMoney(row.complaintAmount)}</td>
              <td class="col-right">${formatMoney(row.recoveredAmount)}</td>
              <td class="col-right">${formatMoney(row.lostAmount)}</td>
            </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>Total General</td>
              <td class="col-right">${formatNumber(totals.count)}</td>
              <td class="col-right">100%</td>
              <td class="col-right">${formatPct(totals.recoveredPct)}</td>
              <td class="col-right">${formatMoney(totals.complaintAmount)}</td>
              <td class="col-right">${formatMoney(totals.recoveredAmount)}</td>
              <td class="col-right">${formatMoney(totals.lostAmount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
    ` : ''}

    <!-- Table 2: Top Combos -->
    ${report.combos?.length > 0 ? `
    <section class="report-section">
      <h2 class="report-section-title">Top Combos con Mayor Porcentaje de Reclamos</h2>
      <div class="table-container">
        <table class="report-table">
          <thead>
            <tr>
              <th>Combo / Producto</th>
              <th class="col-right">Quejas</th>
              <th class="col-right">% del Total</th>
              <th class="col-right">$ Reclamado</th>
              <th class="col-right">$ Recuperado</th>
              <th class="col-right">$ Pérdida Neta</th>
            </tr>
          </thead>
          <tbody>
            ${report.combos.slice(0, 12).map((row) => `
            <tr>
              <td>${escapeHtml(row.combo || 'Sin combo')}</td>
              <td class="col-right">${formatNumber(row.count)}</td>
              <td class="col-right">${formatPct(row.sharePct)}</td>
              <td class="col-right">${formatMoney(row.complaintAmount)}</td>
              <td class="col-right">${formatMoney(row.recoveredAmount)}</td>
              <td class="col-right">${formatMoney(row.lostAmount)}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    ` : ''}

    <!-- Table 3: Por Motivo -->
    ${report.reasons?.length > 0 ? `
    <section class="report-section">
      <h2 class="report-section-title">Distribución por Causa / Motivo de Reclamo</h2>
      <div class="table-container">
        <table class="report-table">
          <thead>
            <tr>
              <th>Motivo</th>
              <th class="col-right">Quejas</th>
              <th class="col-right">% Quejas</th>
              <th class="col-right">% Recupero</th>
              <th class="col-right">$ Reclamado</th>
              <th class="col-right">$ Recuperado</th>
              <th class="col-right">$ Pérdida Neta</th>
            </tr>
          </thead>
          <tbody>
            ${report.reasons.map((row) => `
            <tr>
              <td>${escapeHtml(row.key)}</td>
              <td class="col-right">${formatNumber(row.count)}</td>
              <td class="col-right">${formatPct(totals.count ? (row.count / totals.count) * 100 : 0)}</td>
              <td class="col-right">${formatPct(row.recoveredPct)}</td>
              <td class="col-right">${formatMoney(row.complaintAmount)}</td>
              <td class="col-right">${formatMoney(row.recoveredAmount)}</td>
              <td class="col-right">${formatMoney(row.lostAmount)}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    ` : ''}

    <!-- Table 4: Por Día -->
    ${report.days?.length > 0 ? `
    <section class="report-section">
      <h2 class="report-section-title">Evolución Cronológica Diaria</h2>
      <div class="table-container">
        <table class="report-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th class="col-right">Quejas</th>
              <th class="col-right">% Recupero</th>
              <th class="col-right">$ Reclamado</th>
              <th class="col-right">$ Recuperado</th>
              <th class="col-right">$ Pérdida Neta</th>
            </tr>
          </thead>
          <tbody>
            ${report.days.map((row) => `
            <tr>
              <td><strong>${escapeHtml(formatDayLabel(row.key))}</strong></td>
              <td class="col-right">${formatNumber(row.count)}</td>
              <td class="col-right">${formatPct(row.recoveredPct)}</td>
              <td class="col-right">${formatMoney(row.complaintAmount)}</td>
              <td class="col-right">${formatMoney(row.recoveredAmount)}</td>
              <td class="col-right">${formatMoney(row.lostAmount)}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    ` : ''}

    <!-- Optional Detail Section -->
    ${includeDetail && items.length > 0 ? `
    <section class="report-section page-break-before">
      <h2 class="report-section-title">Anexo: Registro Detallado de Reclamos (${formatNumber(items.length)} pedidos)</h2>
      <div class="table-container">
        <table class="report-table table--dense">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Fecha / Hora</th>
              <th>Agregador</th>
              <th>Combo</th>
              <th>Motivo</th>
              <th class="col-right">Monto</th>
              <th class="col-center">Estado</th>
              <th class="col-center">Foto</th>
              ${extras.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${items.map((item) => {
              const statusClass = item.status === 'refutado_aceptado'
                ? 'badge-status--accepted'
                : item.status === 'refutado_rechazado'
                ? 'badge-status--rejected'
                : 'badge-status--pending';
              return `
              <tr>
                <td><strong>${escapeHtml(item.orderCode)}</strong></td>
                <td>${escapeHtml(item.day ? formatDayLabel(item.day) : '—')} ${escapeHtml(item.timeOfDay || '')}</td>
                <td>${escapeHtml(getAggregatorLabel(item.aggregator))}</td>
                <td>${escapeHtml(item.combo || '—')}</td>
                <td>${escapeHtml(item.reason || '—')}</td>
                <td class="col-right"><strong>${formatMoney(item.amount)}</strong></td>
                <td class="col-center"><span class="badge-status ${statusClass}">${escapeHtml(COMPLAINT_STATUS_LABELS[item.status] || item.status)}</span></td>
                <td class="col-center">${item.photoUrl ? 'Sí' : 'No'}</td>
                ${extras.map((key) => `<td>${escapeHtml(item.fields?.[key] || '—')}</td>`).join('')}
              </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>
    ` : ''}

    <!-- Footer -->
    <footer class="report-footer">
      <div>Delivery La Plata · Sistema Oficial de Registro y Control de Métricas</div>
      <div>Generado el ${escapeHtml(emissionDate)} · Documento Confidencial</div>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Triggers printing using a clean, isolated hidden iframe.
 * This guarantees zero interference from the parent app DOM,
 * avoids overflow clipping bugs, and ensures 100% exact colors and borders.
 */
export function printReportDocument(report, options = {}) {
  const html = generateReportHtml(report, options);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    try {
      iframe.contentWindow.print();
    } catch {
      // Fallback to window open if iframe print fails
      openReportInNewTab(report, options);
    }
    setTimeout(() => {
      iframe.remove();
    }, 60000);
  }, 350);
}

/**
 * Opens the standalone printable document in a new tab.
 * Gives users the ability to inspect the document full-screen or share.
 */
export function openReportInNewTab(report, options = {}) {
  const html = generateReportHtml(report, options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.focus();
  }
}
