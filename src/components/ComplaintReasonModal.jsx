import Dialog from './Dialog';
import { useId, useState } from 'react';
import { formatNumber } from '../lib/metrics';

/**
 * Modal genérico para pedir un motivo (presets + detalle opcional) antes de
 * asignar un estado. Lo usan ComplaintNoRefutableModal y
 * ComplaintRejectedReasonModal; conserva el look y los textos de «No refutable».
 */
export default function ComplaintReasonModal({
  title,
  subtitle,
  reasons = [],
  confirmLabel,
  detailPlaceholder = '',
  detailLabel = 'Detalle (opcional)',
  selectedCount = 1,
  onConfirm,
  onClose,
  disabled = false,
}) {
  const [preset, setPreset] = useState('');
  const [detail, setDetail] = useState('');
  const titleId = useId();
  const radioName = useId();



  const subtitleText =
    subtitle ??
    (selectedCount > 1
      ? `Elegí el motivo para los ${formatNumber(selectedCount)} reclamos seleccionados.`
      : 'Elegí el motivo.');

  function handleSubmit(event) {
    event.preventDefault();
    if (!preset) return;
    const trimmed = detail.trim();
    onConfirm(trimmed ? `${preset} · ${trimmed}` : preset);
  }

  return (
    <Dialog labelledBy={titleId} onClose={onClose} busy={disabled}>
      <div className="report-modal complaint-unrefutable-modal">
        <header className="report-modal__header">
          <div>
            <h3 id={titleId}>{title}</h3>
            <p className="report-modal__subtitle">{subtitleText}</p>
          </div>
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose} disabled={disabled}>
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="complaint-unrefutable-form">
          <fieldset className="complaint-unrefutable-presets" disabled={disabled}>
            <legend className="complaint-batch-field__label">Motivo</legend>
            {reasons.map((reason) => (
              <label
                key={reason}
                className={`complaint-unrefutable-preset${preset === reason ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name={radioName}
                  value={reason}
                  checked={preset === reason}
                  onChange={() => setPreset(reason)}
                />
                <span>{reason}</span>
              </label>
            ))}
          </fieldset>

          <label className="complaint-batch-field">
            <span className="complaint-batch-field__label">{detailLabel}</span>
            <input
              type="text"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder={detailPlaceholder}
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
              {confirmLabel}
            </button>
          </footer>
        </form>
      </div>
    </Dialog>
  );
}
