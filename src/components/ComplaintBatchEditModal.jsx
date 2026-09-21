import { useState } from 'react';
import { AGGREGATORS, getAggregatorLabel } from '../lib/aggregators';
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES } from '../lib/complaintHistory';
import { formatNumber } from '../lib/metrics';

const COMMON_REASONS = [
  'Faltó producto',
  'Pedido equivocado',
  'Producto en mal estado / frío',
  'Demora excesiva',
  'Cancelado por cliente',
  'No llegó el pedido',
  'Reclamo de repartidor',
];

export default function ComplaintBatchEditModal({
  selectedCount,
  onApply,
  onClose,
  disabled = false,
}) {
  const [aggregator, setAggregator] = useState('NO_CHANGE');
  const [status, setStatus] = useState('NO_CHANGE');
  const [comboAction, setComboAction] = useState('NO_CHANGE'); // 'NO_CHANGE' | 'SET' | 'CLEAR'
  const [comboValue, setComboValue] = useState('');
  const [reasonAction, setReasonAction] = useState('NO_CHANGE'); // 'NO_CHANGE' | 'SET' | 'CLEAR'
  const [reasonValue, setReasonValue] = useState('');
  const [commentAction, setCommentAction] = useState('NO_CHANGE'); // 'NO_CHANGE' | 'APPEND' | 'REPLACE' | 'CLEAR'
  const [commentValue, setCommentValue] = useState('');
  const [amountAction, setAmountAction] = useState('NO_CHANGE'); // 'NO_CHANGE' | 'SET' | 'CLEAR'
  const [amountValue, setAmountValue] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const changes = {};

    if (aggregator !== 'NO_CHANGE') {
      changes.aggregator = aggregator === 'none' ? null : aggregator;
    }

    if (status !== 'NO_CHANGE') {
      changes.status = status;
    }

    if (comboAction === 'SET') {
      changes.combo = comboValue.trim();
    } else if (comboAction === 'CLEAR') {
      changes.combo = '';
    }

    if (reasonAction === 'SET') {
      changes.reason = reasonValue.trim();
    } else if (reasonAction === 'CLEAR') {
      changes.reason = '';
    }

    if (commentAction === 'REPLACE') {
      changes.comment = commentValue.trim();
    } else if (commentAction === 'APPEND') {
      changes.commentAppend = commentValue.trim();
    } else if (commentAction === 'CLEAR') {
      changes.comment = '';
    }

    if (amountAction === 'SET') {
      const num = Number(amountValue);
      if (!Number.isNaN(num) && num >= 0) {
        changes.amount = num;
      }
    } else if (amountAction === 'CLEAR') {
      changes.amount = null;
    }

    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    onApply(changes);
  }

  const hasChanges =
    aggregator !== 'NO_CHANGE' ||
    status !== 'NO_CHANGE' ||
    comboAction !== 'NO_CHANGE' ||
    reasonAction !== 'NO_CHANGE' ||
    commentAction !== 'NO_CHANGE' ||
    amountAction !== 'NO_CHANGE';

  return (
    <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="batch-modal-title">
      <div className="report-modal complaint-batch-modal">
        <header className="report-modal__header">
          <div>
            <h3 id="batch-modal-title">Editar {formatNumber(selectedCount)} reclamos en lote</h3>
            <p className="report-modal__subtitle">
              Solo se modificarán los campos en los que elijas un valor nuevo. Los demás mantendrán su dato original.
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose} disabled={disabled}>
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="complaint-batch-form">
          <div className="complaint-batch-form__grid">
            {/* Estado */}
            <label className="complaint-batch-field">
              <span className="complaint-batch-field__label">Estado de resolución</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={disabled}
              >
                <option value="NO_CHANGE">— Sin cambios —</option>
                <option value={COMPLAINT_STATUSES.queja}>Queja (Sin disputar)</option>
                <option value={COMPLAINT_STATUSES.refutado}>Refutado (En trámite)</option>
                <option value={COMPLAINT_STATUSES.refutado_aceptado}>Ref. aceptado (Recuperado)</option>
                <option value={COMPLAINT_STATUSES.refutado_rechazado}>Ref. rechazado (Pérdida confirmada)</option>
              </select>
            </label>

            {/* Agregador */}
            <label className="complaint-batch-field">
              <span className="complaint-batch-field__label">Agregador / Plataforma</span>
              <select
                value={aggregator}
                onChange={(e) => setAggregator(e.target.value)}
                disabled={disabled}
              >
                <option value="NO_CHANGE">— Sin cambios —</option>
                {Object.keys(AGGREGATORS).map((key) => (
                  <option key={key} value={key}>
                    {getAggregatorLabel(key)}
                  </option>
                ))}
                <option value="none">Sin agregador</option>
              </select>
            </label>

            {/* Combo */}
            <div className="complaint-batch-field">
              <span className="complaint-batch-field__label">Combo / Producto</span>
              <div className="complaint-batch-field__row">
                <select
                  value={comboAction}
                  onChange={(e) => setComboAction(e.target.value)}
                  disabled={disabled}
                >
                  <option value="NO_CHANGE">— Sin cambios —</option>
                  <option value="SET">Asignar combo</option>
                  <option value="CLEAR">Borrar combo</option>
                </select>
                {comboAction === 'SET' && (
                  <input
                    type="text"
                    value={comboValue}
                    onChange={(e) => setComboValue(e.target.value)}
                    placeholder="Nombre del combo..."
                    disabled={disabled}
                    autoFocus
                  />
                )}
              </div>
            </div>

            {/* Motivo */}
            <div className="complaint-batch-field">
              <span className="complaint-batch-field__label">Motivo de la queja</span>
              <div className="complaint-batch-field__row">
                <select
                  value={reasonAction}
                  onChange={(e) => setReasonAction(e.target.value)}
                  disabled={disabled}
                >
                  <option value="NO_CHANGE">— Sin cambios —</option>
                  <option value="SET">Asignar motivo</option>
                  <option value="CLEAR">Borrar motivo</option>
                </select>
                {reasonAction === 'SET' && (
                  <div className="complaint-batch-field__reason-inputs">
                    <input
                      type="text"
                      value={reasonValue}
                      onChange={(e) => setReasonValue(e.target.value)}
                      placeholder="Motivo o escribí uno nuevo..."
                      disabled={disabled}
                    />
                    <select
                      onChange={(e) => {
                        if (e.target.value) setReasonValue(e.target.value);
                      }}
                      disabled={disabled}
                    >
                      <option value="">(O elegir motivo frecuente)</option>
                      {COMMON_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Monto ($) */}
            <div className="complaint-batch-field">
              <span className="complaint-batch-field__label">Monto ($)</span>
              <div className="complaint-batch-field__row">
                <select
                  value={amountAction}
                  onChange={(e) => setAmountAction(e.target.value)}
                  disabled={disabled}
                >
                  <option value="NO_CHANGE">— Sin cambios —</option>
                  <option value="SET">Asignar monto fijo</option>
                  <option value="CLEAR">Quitar monto</option>
                </select>
                {amountAction === 'SET' && (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountValue}
                    onChange={(e) => setAmountValue(e.target.value)}
                    placeholder="$ 0.00"
                    disabled={disabled}
                  />
                )}
              </div>
            </div>

            {/* Comentario */}
            <div className="complaint-batch-field complaint-batch-field--full">
              <span className="complaint-batch-field__label">Comentario / Nota</span>
              <div className="complaint-batch-field__row">
                <select
                  value={commentAction}
                  onChange={(e) => setCommentAction(e.target.value)}
                  disabled={disabled}
                >
                  <option value="NO_CHANGE">— Sin cambios —</option>
                  <option value="APPEND">Agregar nota al final</option>
                  <option value="REPLACE">Reemplazar comentario</option>
                  <option value="CLEAR">Borrar comentario</option>
                </select>
                {(commentAction === 'APPEND' || commentAction === 'REPLACE') && (
                  <input
                    type="text"
                    value={commentValue}
                    onChange={(e) => setCommentValue(e.target.value)}
                    placeholder="Texto de la nota..."
                    disabled={disabled}
                  />
                )}
              </div>
            </div>
          </div>

          <footer className="complaint-batch-form__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={disabled}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={disabled || !hasChanges}
            >
              Aplicar cambios a {formatNumber(selectedCount)} reclamos
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
