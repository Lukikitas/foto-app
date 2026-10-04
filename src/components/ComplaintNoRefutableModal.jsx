import { useState } from 'react';
import { NO_REFUTABLE_REASONS } from '../lib/complaintHistory';
import { formatNumber } from '../lib/metrics';

/**
 * Pide el motivo (presets + detalle opcional) antes de marcar reclamos como
 * «No se puede refutar». Siempre pasa por acá: el estado no se asigna sin motivo.
 */
export default function ComplaintNoRefutableModal({
  selectedCount = 1,
  onConfirm,
  onClose,
  disabled = false,
}) {
  const [preset, setPreset] = useState('');
  const [detail, setDetail] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (!preset) return;
    const trimmed = detail.trim();
    onConfirm(trimmed ? `${preset} · ${trimmed}` : preset);
  }

  return (
    <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="unrefutable-modal-title">
      <div className="report-modal complaint-unrefutable-modal">
        <header className="report-modal__header">
          <div>
            <h3 id="unrefutable-modal-title">No se puede refutar</h3>
            <p className="report-modal__subtitle">
              {selectedCount > 1
                ? `Elegí el motivo para los ${formatNumber(selectedCount)} reclamos seleccionados. `
                : 'Elegí el motivo. '}
              La queja queda como «No refutable»: se pierde el dinero y ya no aparecen las
              acciones de refutar.
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose} disabled={disabled}>
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="complaint-unrefutable-form">
          <fieldset className="complaint-unrefutable-presets" disabled={disabled}>
            <legend className="complaint-batch-field__label">Motivo</legend>
            {NO_REFUTABLE_REASONS.map((reason) => (
              <label
                key={reason}
                className={`complaint-unrefutable-preset${preset === reason ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="unrefutable-reason"
                  value={reason}
                  checked={preset === reason}
                  onChange={() => setPreset(reason)}
                />
                <span>{reason}</span>
              </label>
            ))}
          </fieldset>

          <label className="complaint-batch-field">
            <span className="complaint-batch-field__label">Detalle (opcional)</span>
            <input
              type="text"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder="Ej: sin evidencia en la app"
              maxLength={80}
              disabled={disabled}
            />
          </label>

          <footer className="complaint-batch-form__actions">
            <button type="button" className="btn btn--ghost btn--small" onClick={onClose} disabled={disabled}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary btn--small"
              disabled={disabled || !preset}
            >
              Marcar como no refutable
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}