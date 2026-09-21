import { useState, useRef, useEffect } from 'react';
import { AGGREGATOR_OPTIONS, getAggregatorLabel } from '../lib/aggregators';
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES } from '../lib/complaintHistory';
import { formatMoney, formatNumber } from '../lib/metrics';

export default function ComplaintsBulkBar({
  selectedCount,
  totalSelectedAmount = 0,
  hasPhotos = false,
  onClearSelection,
  onSelectAllVisible,
  isAllVisibleSelected = false,
  visibleCount = 0,
  onMarkStatus,
  onSetAggregator,
  onOpenBatchEdit,
  onDownloadEvidence,
  onExportExcel,
  onDeleteSelected,
  disabled = false,
}) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [aggMenuOpen, setAggMenuOpen] = useState(false);
  const statusRef = useRef(null);
  const aggRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (statusRef.current && !statusRef.current.contains(e.target)) {
        setStatusMenuOpen(false);
      }
      if (aggRef.current && !aggRef.current.contains(e.target)) {
        setAggMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!selectedCount) return null;

  return (
    <aside className="complaints-bulk-bar" role="toolbar" aria-label="Acciones masivas de reclamos">
      <div className="complaints-bulk-bar__info">
        <div className="complaints-bulk-bar__badge">
          <strong>{formatNumber(selectedCount)}</strong>
          <span>seleccionado{selectedCount !== 1 ? 's' : ''}</span>
        </div>
        {totalSelectedAmount > 0 && (
          <span className="complaints-bulk-bar__amount" title="Suma total de los reclamos seleccionados">
            {formatMoney(totalSelectedAmount)}
          </span>
        )}
        <button
          type="button"
          className="complaints-bulk-bar__clear-btn"
          onClick={onClearSelection}
          disabled={disabled}
          title="Deseleccionar todos"
          aria-label="Deseleccionar todos"
        >
          ✕
        </button>
      </div>

      {visibleCount > selectedCount && onSelectAllVisible && (
        <button
          type="button"
          className="btn btn--ghost btn--small complaints-bulk-bar__select-all-btn"
          onClick={onSelectAllVisible}
          disabled={disabled}
        >
          Seleccionar los {visibleCount} visibles
        </button>
      )}

      <div className="complaints-bulk-bar__actions">
        {/* Cambiar Estado Menu */}
        <div className="complaints-bulk-bar__dropdown-wrap" ref={statusRef}>
          <button
            type="button"
            className="btn btn--primary btn--small complaints-bulk-bar__btn"
            onClick={() => {
              setStatusMenuOpen((prev) => !prev);
              setAggMenuOpen(false);
            }}
            disabled={disabled}
            aria-expanded={statusMenuOpen}
          >
            Estado ▾
          </button>
          {statusMenuOpen && (
            <div className="complaints-bulk-bar__menu" role="menu">
              <button
                type="button"
                className="complaints-bulk-bar__menu-item"
                role="menuitem"
                onClick={() => {
                  setStatusMenuOpen(false);
                  onMarkStatus(COMPLAINT_STATUSES.refutado);
                }}
              >
                <span className="badge badge--refutado">Refutado</span>
                <small>Marcar como en trámite</small>
              </button>
              <button
                type="button"
                className="complaints-bulk-bar__menu-item"
                role="menuitem"
                onClick={() => {
                  setStatusMenuOpen(false);
                  onMarkStatus(COMPLAINT_STATUSES.refutado_aceptado);
                }}
              >
                <span className="badge badge--refutado-aceptado">Ref. aceptado</span>
                <small>Recuperado a favor</small>
              </button>
              <button
                type="button"
                className="complaints-bulk-bar__menu-item"
                role="menuitem"
                onClick={() => {
                  setStatusMenuOpen(false);
                  onMarkStatus(COMPLAINT_STATUSES.refutado_rechazado);
                }}
              >
                <span className="badge badge--aceptado">Ref. rechazado</span>
                <small>Pérdida definitiva</small>
              </button>
              <button
                type="button"
                className="complaints-bulk-bar__menu-item"
                role="menuitem"
                onClick={() => {
                  setStatusMenuOpen(false);
                  onMarkStatus(COMPLAINT_STATUSES.queja);
                }}
              >
                <span className="badge badge--complaint">Queja</span>
                <small>Sin disputar / inicial</small>
              </button>
            </div>
          )}
        </div>

        {/* Cambiar Agregador Menu */}
        <div className="complaints-bulk-bar__dropdown-wrap" ref={aggRef}>
          <button
            type="button"
            className="btn btn--ghost btn--small complaints-bulk-bar__btn"
            onClick={() => {
              setAggMenuOpen((prev) => !prev);
              setStatusMenuOpen(false);
            }}
            disabled={disabled}
            aria-expanded={aggMenuOpen}
          >
            Agregador ▾
          </button>
          {aggMenuOpen && (
            <div className="complaints-bulk-bar__menu" role="menu">
              {AGGREGATOR_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="complaints-bulk-bar__menu-item"
                  role="menuitem"
                  onClick={() => {
                    setAggMenuOpen(false);
                    onSetAggregator(item.id);
                  }}
                >
                  <span>{item.label}</span>
                </button>
              ))}
              <button
                type="button"
                className="complaints-bulk-bar__menu-item"
                role="menuitem"
                onClick={() => {
                  setAggMenuOpen(false);
                  onSetAggregator(null);
                }}
              >
                <span>Sin agregador</span>
              </button>
            </div>
          )}
        </div>

        {/* Botón Editar datos completos (Modal) */}
        <button
          type="button"
          className="btn btn--ghost btn--small complaints-bulk-bar__btn"
          onClick={onOpenBatchEdit}
          disabled={disabled}
          title="Editar combo, motivo, monto o notas en lote"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
          Editar datos…
        </button>

        {/* Descargar evidencias */}
        {hasPhotos && onDownloadEvidence && (
          <button
            type="button"
            className="btn btn--ghost btn--small complaints-bulk-bar__btn"
            onClick={onDownloadEvidence}
            disabled={disabled}
            title="Descargar fotos de los reclamos seleccionados"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Fotos
          </button>
        )}

        {/* Exportar seleccionados a Excel */}
        {onExportExcel && (
          <button
            type="button"
            className="btn btn--ghost btn--small complaints-bulk-bar__btn"
            onClick={onExportExcel}
            disabled={disabled}
            title="Exportar reclamos seleccionados a Excel (.xlsx)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="8" y1="13" x2="16" y2="13"></line>
              <line x1="8" y1="17" x2="16" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Excel
          </button>
        )}

        {/* Borrar seleccionados */}
        {onDeleteSelected && (
          <button
            type="button"
            className="btn btn--ghost btn--small complaints-bulk-bar__btn complaints-bulk-bar__btn--danger"
            onClick={onDeleteSelected}
            disabled={disabled}
            title="Eliminar reclamos seleccionados del historial"
          >
            Borrar ({selectedCount})
          </button>
        )}
      </div>
    </aside>
  );
}
