import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMPLAINT_STATUSES,
  emptyHistory,
  patchHistoryItem,
  upsertHistoryItems,
} from './complaintHistory.js';
import { buildComplaintReport } from './complaintReport.js';
import {
  DEFAULT_REPORT_SECTIONS,
  generateReportHtml,
  normalizeReportOptions,
  REPORT_DETAIL_STATUSES,
} from './pdfReportGenerator.js';

function complaint(overrides = {}) {
  return {
    orderCode: 'PEYA-1',
    orderAtIso: '2026-09-17T17:00:00.000-03:00',
    timeOfDay: '17:00',
    reason: 'Faltó producto',
    comment: '',
    combo: 'Combo Crispy',
    amount: 8000,
    fields: { Local: 'La Plata' },
    ...overrides,
  };
}

function sampleReport() {
  let store = upsertHistoryItems(emptyHistory(), [
    complaint(),
    complaint({ orderCode: 'PEYA-QUEJA', amount: 2000, combo: 'Twister' }),
    complaint({ orderCode: 'PEYA-RECHAZO', amount: 1000, combo: 'Papas' }),
    complaint({ orderCode: 'PEYA-NOREF', amount: 500, combo: 'Nuggets' }),
    complaint({ orderCode: 'PEYA-5', amount: 300, combo: 'Mega Combo' }),
    complaint({ orderCode: 'PEYA-6', amount: 300, combo: 'Ensalada' }),
    complaint({ orderCode: 'PEYA-7', amount: 300, combo: 'Milanesa' }),
  ]).store;
  const ids = Object.keys(store.items);
  store = patchHistoryItem(store, ids[2], {
    status: COMPLAINT_STATUSES.refutado_rechazado,
    rejectionReason: 'Foto incompleta',
  });
  store = patchHistoryItem(store, ids[3], {
    status: COMPLAINT_STATUSES.no_refutable,
    unrefutableReason: 'No hay foto',
  });
  return buildComplaintReport(store, { from: '2026-09-17', to: '2026-09-17' });
}

test('legacy { includeDetail, trend } keeps producing exactly the same report', () => {
  const report = sampleReport();
  const legacyFull = generateReportHtml(report, { includeDetail: true });
  const legacyResumen = generateReportHtml(report, { includeDetail: false });

  // Traducir el formato viejo al objeto nuevo no cambia ni un byte.
  assert.equal(legacyFull, generateReportHtml(report, normalizeReportOptions({ includeDetail: true })));
  assert.equal(legacyResumen, generateReportHtml(report, normalizeReportOptions({ includeDetail: false })));

  // Mismo contenido que hasta ahora: secciones de siempre, sin los rankings nuevos.
  assert.ok(legacyFull.includes('<section class="kpi-grid">'));
  assert.ok(legacyFull.includes('<section class="status-panel">'));
  assert.ok(legacyFull.includes('<section class="insights-box">'));
  assert.ok(legacyFull.includes('Desglose por Agregador'));
  assert.ok(legacyFull.includes('Anexo: Registro Detallado'));
  assert.ok(!legacyFull.includes('Top Motivos de Refutación Rechazada'));
  assert.ok(!legacyFull.includes('Top Motivos de No Refutables'));
  assert.ok(!legacyResumen.includes('Anexo: Registro Detallado'));
});

test('normalizeReportOptions ignores unknown sections and falls back safely', () => {
  const options = normalizeReportOptions({
    sections: { kpis: false, seccion_inventada: true },
    comboLimit: 99,
    detailStatuses: ['no-existe'],
    detailColumns: 'roto',
    title: '   ',
    note: 42,
  });

  assert.equal(options.sections.seccion_inventada, undefined, 'las secciones desconocidas se ignoran');
  assert.equal(options.sections.kpis, false);
  assert.equal(options.sections.status, true, 'las secciones faltantes toman el default');
  assert.deepEqual(Object.keys(options.sections).sort(), [...Object.keys(DEFAULT_REPORT_SECTIONS)].sort());
  assert.equal(options.comboLimit, 12, 'límite inválido vuelve al default');
  assert.deepEqual(options.detailStatuses, [...REPORT_DETAIL_STATUSES]);
  assert.equal(options.detailColumns.extras, null);
  assert.equal(options.detailColumns.statusReason, false);
  assert.equal(options.title, 'Informe Gerencial de Quejas y Recuperos');
  assert.equal(options.note, '', 'la nota no numérica se descarta');
  assert.equal(options.trend, null);

  // JSON corrupto o null: nunca lanza y cae en el formato viejo.
  const fromNull = normalizeReportOptions(null);
  assert.equal(fromNull.sections.detail, false);
  assert.equal(fromNull.sections.kpis, true);
});

test('section flags drive which blocks reach the printed document', () => {
  const report = sampleReport();
  const html = generateReportHtml(report, {
    sections: { ...DEFAULT_REPORT_SECTIONS, aggregators: false, reasons: false, detail: true },
  });
  assert.ok(html.includes('Anexo: Registro Detallado'));
  assert.ok(!html.includes('Desglose por Agregador'), 'la sección desactivada no se imprime');
  assert.ok(!html.includes('Distribución por Causa / Motivo de Reclamo'));

  const onlyKpis = generateReportHtml(report, {
    sections: Object.fromEntries(Object.keys(DEFAULT_REPORT_SECTIONS).map((key) => [key, key === 'kpis'])),
  });
  assert.ok(onlyKpis.includes('<section class="kpi-grid">'));
  assert.ok(!onlyKpis.includes('<section class="status-panel">'));
  assert.ok(!onlyKpis.includes('Desglose por Agregador'));
  assert.ok(!onlyKpis.includes('Evolución Cronológica Diaria'));
});

test('detail can be filtered by status and include the status reason column', () => {
  const report = sampleReport();
  const html = generateReportHtml(report, {
    sections: { ...DEFAULT_REPORT_SECTIONS, detail: true },
    detailStatuses: [
      COMPLAINT_STATUSES.refutado_rechazado,
      COMPLAINT_STATUSES.no_refutable,
    ],
    detailColumns: { extras: [], statusReason: true },
  });

  assert.ok(html.includes('Motivo de estado'));
  assert.ok(html.includes('Foto incompleta'));
  assert.ok(html.includes('No hay foto'));
  assert.ok(!html.includes('PEYA-QUEJA'), 'los estados fuera de la selección no viajan al anexo');
  assert.ok(!html.includes('Local</th>'), 'las columnas extra desmarcadas se ocultan');
});

test('comboLimit and custom title/note change the printed output', () => {
  const report = sampleReport();
  const sections = { ...DEFAULT_REPORT_SECTIONS };
  const limited = generateReportHtml(report, { sections, comboLimit: 5 });
  assert.ok(limited.includes('Combo Crispy'));
  assert.ok(!limited.includes('Papas'), 'con límite 5 entran solo los cinco primeros combos');

  const all = generateReportHtml(report, { sections, comboLimit: 'all' });
  assert.ok(all.includes('Papas'));

  const custom = generateReportHtml(report, {
    sections,
    title: 'Informe del equipo <Rojo>',
    note: 'Revisar con <b>gerencia</b>',
  });
  assert.ok(custom.includes('Informe del equipo &lt;Rojo&gt;'), 'el título del usuario se escapa');
  assert.ok(custom.includes('Revisar con &lt;b&gt;gerencia&lt;/b&gt;'), 'la nota se escapa');
  assert.ok(custom.includes('report-note'));
  assert.ok(!custom.includes('<b>gerencia</b>'));
});
