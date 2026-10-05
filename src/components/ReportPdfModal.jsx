import { useEffect, useMemo, useState } from 'react';
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES } from '../lib/complaintHistory';
import { extraFieldKeys } from '../lib/complaintReport';
import {
  DEFAULT_REPORT_SECTIONS,
  DEFAULT_REPORT_TITLE,
  generateReportHtml,
  normalizeReportOptions,
  openReportInNewTab,
  printReportDocument,
  REPORT_COMBO_LIMITS,
  REPORT_DETAIL_STATUSES,
  REPORT_SECTION_KEYS,
} from '../lib/pdfReportGenerator';

const STORAGE_KEY = 'foto-app-report-builder';

// Secciones configurables, en el orden en que se imprimen. El encabezado no
// aparece acá: siempre está activo y no se puede desmarcar.
const SECTION_OPTIONS = [
  { id: 'kpis', label: 'Tarjetas KPI' },
  { id: 'status', label: 'Barra de estado de trámites' },
  { id: 'insights', label: 'Insights (plataforma, combo, causa)' },
  { id: 'trend', label: 'Gráfico de tendencia', requiresTrend: true },
  { id: 'aggregators', label: 'Desglose por agregador' },
  { id: 'combos', label: 'Top combos' },
  { id: 'reasons', label: 'Distribución por motivo de reclamo' },
  { id: 'days', label: 'Evolución diaria' },
  { id: 'rejectionReasons', label: 'Top motivos de refutación rechazada' },
  { id: 'unrefutableReasons', label: 'Top motivos de no refutables' },
  { id: 'detail', label: 'Anexo de detalle' },
];

const REPORT_TEMPLATES = [
  {
    id: 'gerencial',
    label: 'Gerencial',
    sections: ['kpis', 'status', 'insights', 'trend', 'aggregators'],
  },
  {
    id: 'operativo',
    label: 'Operativo',
    sections: ['combos', 'reasons', 'days'],
  },
  {
    id: 'disciplinario',
    label: 'Disciplinario / control',
    sections: ['kpis', 'rejectionReasons', 'unrefutableReasons', 'detail'],
    detailStatuses: [
      COMPLAINT_STATUSES.refutado_rechazado,
      COMPLAINT_STATUSES.no_refutable,
    ],
    detailColumns: { statusReason: true },
  },
  {
    id: 'completo',
    label: 'Completo',
    sections: [...REPORT_SECTION_KEYS],
    detailStatuses: [...REPORT_DETAIL_STATUSES],
  },
];

export default function ReportPdfModal({ report, trend = null, onClose }) {
  const items = useMemo(() => report?.items || [], [report]);
  const allExtras = useMemo(() => extraFieldKeys(items), [items]);
  const [config, setConfig] = useState(() => loadConfig(allExtras));
  const [template, setTemplate] = useState(() => matchTemplateId(config));
  const [panelOpen, setPanelOpen] = useState(false);

  // La última configuración queda guardada para la próxima vez.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sections: config.sections,
          comboLimit: config.comboLimit,
          detailStatuses: config.detailStatuses,
          detailColumns: config.detailColumns,
          title: config.title,
          note: config.note,
        }),
      );
    } catch {
      // El guardado es opcional: si no hay espacio no rompe el modal.
    }
  }, [config]);

  // Misma configuración para la preview y para la impresión.
  const options = useMemo(
    () => ({
      sections: config.sections,
      comboLimit: config.comboLimit,
      detailStatuses: config.detailStatuses,
      detailColumns: config.detailColumns,
      title: config.title,
      note: config.note,
      trend,
    }),
    [config, trend],
  );
  const previewHtml = useMemo(() => generateReportHtml(report, options), [report, options]);

  const hasContent = REPORT_SECTION_KEYS.some((key) => config.sections[key]);
  const warning = hasContent
    ? ''
    : 'Marcá al menos una sección de contenido para poder imprimir o abrir el informe.';

  function patch(partial) {
    setConfig((prev) => ({ ...prev, ...partial }));
    setTemplate('personalizado');
  }

  function patchSection(id, checked) {
    patch({ sections: { ...config.sections, [id]: checked } });
  }

  function toggleDetailStatus(status) {
    const current = config.detailStatuses;
    if (!current.includes(status)) {
      patch({ detailStatuses: [...current, status] });
      return;
    }
    // Siempre debe quedar al menos un estado seleccionado.
    if (current.length === 1) return;
    patch({ detailStatuses: current.filter((key) => key !== status) });
  }

  function toggleExtraColumn(key) {
    const current = config.detailColumns.extras || [];
    const next = current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key];
    patch({ detailColumns: { ...config.detailColumns, extras: next } });
  }

  function applyTemplate(item) {
    const sections = Object.fromEntries(
      REPORT_SECTION_KEYS.map((key) => [key, item.sections.includes(key)]),
    );
    setConfig((prev) => ({
      ...prev,
      sections,
      detailStatuses: item.detailStatuses ? [...item.detailStatuses] : prev.detailStatuses,
      detailColumns: item.detailColumns
        ? { ...prev.detailColumns, ...item.detailColumns }
        : prev.detailColumns,
    }));
    setTemplate(item.id);
  }

  function markAll(checked) {
    patch({
      sections: Object.fromEntries(REPORT_SECTION_KEYS.map((key) => [key, checked])),
    });
  }

  function handlePrint() {
    if (!hasContent) return;
    printReportDocument(report, options);
  }

  function handleOpenNewTab() {
    if (!hasContent) return;
    openReportInNewTab(report, options);
  }

  return (
    <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pdf-modal-title">
      <div className="report-modal report-builder">
        <header className="report-modal__header">
          <div>
            <h3 id="pdf-modal-title">Exportar informe en PDF</h3>
            <p className="report-modal__subtitle">
              Armá el informe por secciones: la vista previa se actualiza sola y se imprime tal cual.
            </p>
          </div>
          <div className="report-modal__controls">
            <button
              type="button"
              className="btn btn--primary"
              onClick={handlePrint}
              disabled={!hasContent}
              title={warning || 'Imprimir o guardar directamente como PDF'}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9V2h12v7"></path>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              Guardar como PDF / Imprimir
            </button>

            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleOpenNewTab}
              disabled={!hasContent}
              title={warning || 'Abrir informe independiente en pestaña nueva'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              Abrir en pestaña
            </button>

            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </header>

        {warning ? (
          <p className="report-builder__warning" role="alert">
            {warning}
          </p>
        ) : null}

        <div className="report-builder__layout">
          <aside className={`report-builder__panel${panelOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="btn btn--ghost btn--small report-builder__toggle"
              onClick={() => setPanelOpen((prev) => !prev)}
              aria-expanded={panelOpen}
            >
              {panelOpen ? 'Ocultar opciones del informe' : 'Opciones del informe'}
            </button>

            <div className="report-builder__panel-body">
              <div className="report-builder__group">
                <span className="report-builder__label">Plantillas</span>
                <div className="report-builder__templates">
                  {REPORT_TEMPLATES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`filter-row__btn${template === item.id ? ' filter-row__btn--active' : ''}`}
                      onClick={() => applyTemplate(item)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <span
                    className={`report-builder__template-hint${template === 'personalizado' ? ' is-active' : ''}`}
                  >
                    Personalizado
                  </span>
                </div>
              </div>

              <div className="report-builder__group">
                <span className="report-builder__label">Secciones</span>
                <label className="report-builder__section report-builder__section--always">
                  <input type="checkbox" checked readOnly disabled />
                  <span>Encabezado con período, filtro y fecha</span>
                </label>
                {SECTION_OPTIONS.filter((option) => !option.requiresTrend || trend?.hasData).map((option) => (
                  <label key={option.id} className="report-builder__section">
                    <input
                      type="checkbox"
                      checked={Boolean(config.sections[option.id])}
                      onChange={(event) => patchSection(option.id, event.target.checked)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
                <div className="report-builder__row">
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => markAll(true)}>
                    Marcar todo
                  </button>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => markAll(false)}>
                    Desmarcar todo
                  </button>
                </div>
              </div>

              {config.sections.combos ? (
                <div className="report-builder__group">
                  <span className="report-builder__label">Cantidad de combos</span>
                  <div className="filter-row" role="group" aria-label="Cantidad de combos">
                    {[...REPORT_COMBO_LIMITS, 'all'].map((limit) => (
                      <button
                        key={String(limit)}
                        type="button"
                        className={`filter-row__btn${config.comboLimit === limit ? ' filter-row__btn--active' : ''}`}
                        onClick={() => patch({ comboLimit: limit })}
                      >
                        {limit === 'all' ? 'Todos' : limit}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {config.sections.detail ? (
                <div className="report-builder__group">
                  <span className="report-builder__label">Anexo: filtrar por estado</span>
                  {REPORT_DETAIL_STATUSES.map((status) => (
                    <label key={status} className="report-builder__section">
                      <input
                        type="checkbox"
                        checked={config.detailStatuses.includes(status)}
                        onChange={() => toggleDetailStatus(status)}
                      />
                      <span>{COMPLAINT_STATUS_LABELS[status]}</span>
                    </label>
                  ))}

                  <span className="report-builder__label">Columnas del anexo</span>
                  {allExtras.length === 0 ? (
                    <p className="report-builder__hint">Este período no tiene columnas extra.</p>
                  ) : (
                    allExtras.map((key) => (
                      <label key={key} className="report-builder__section">
                        <input
                          type="checkbox"
                          checked={(config.detailColumns.extras || []).includes(key)}
                          onChange={() => toggleExtraColumn(key)}
                        />
                        <span>{key}</span>
                      </label>
                    ))
                  )}
                  <label className="report-builder__section">
                    <input
                      type="checkbox"
                      checked={config.detailColumns.statusReason}
                      onChange={(event) =>
                        patch({
                          detailColumns: {
                            ...config.detailColumns,
                            statusReason: event.target.checked,
                          },
                        })
                      }
                    />
                    <span>Columna de motivo de estado</span>
                  </label>
                </div>
              ) : null}

              <div className="report-builder__group">
                <label className="report-builder__field">
                  <span className="report-builder__label">Título del informe</span>
                  <input
                    type="text"
                    value={config.title}
                    maxLength={90}
                    onChange={(event) => patch({ title: event.target.value })}
                  />
                </label>
                <label className="report-builder__field">
                  <span className="report-builder__label">Nota / observaciones</span>
                  <textarea
                    rows={2}
                    value={config.note}
                    maxLength={240}
                    placeholder="Se imprime debajo del encabezado."
                    onChange={(event) => patch({ note: event.target.value })}
                  />
                </label>
              </div>
            </div>
          </aside>

          <div className="report-builder__preview">
            {hasContent ? (
              <iframe
                className="report-builder__frame"
                title="Vista previa del informe"
                srcDoc={previewHtml}
              />
            ) : (
              <div className="gallery__state gallery__state--empty">
                <p>{warning}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function sameStatuses(a, b) {
  return a.length === b.length && a.every((key) => b.includes(key));
}

function matchTemplateId(config) {
  const tpl = REPORT_TEMPLATES.find(
    (item) =>
      REPORT_SECTION_KEYS.every(
        (key) => Boolean(config.sections[key]) === item.sections.includes(key),
      ) &&
      (!item.detailStatuses || sameStatuses(config.detailStatuses, item.detailStatuses)),
  );
  return tpl ? tpl.id : 'personalizado';
}

/**
 * Carga la última configuración guardada. Todo pasa por
 * normalizeReportOptions: si el JSON está corrupto o tiene secciones
 * desconocidas se cae seguro en los defaults.
 */
function loadConfig(defaultExtras) {
  const fallback = {
    sections: { ...DEFAULT_REPORT_SECTIONS },
    comboLimit: 12,
    detailStatuses: [...REPORT_DETAIL_STATUSES],
    detailColumns: { extras: [...defaultExtras], statusReason: false },
    title: DEFAULT_REPORT_TITLE,
    note: '',
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const safe = normalizeReportOptions(parsed && typeof parsed === 'object' ? parsed : {});
    const savedExtras = safe.detailColumns.extras;
    return {
      sections: safe.sections,
      comboLimit: safe.comboLimit,
      detailStatuses: safe.detailStatuses,
      detailColumns: {
        extras: savedExtras === null ? [...defaultExtras] : defaultExtras.filter((key) => savedExtras.includes(key)),
        statusReason: safe.detailColumns.statusReason,
      },
      title: safe.title,
      note: safe.note,
    };
  } catch {
    return fallback;
  }
}
