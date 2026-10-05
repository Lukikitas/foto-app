import { NO_REFUTABLE_REASONS } from '../lib/complaintHistory';
import { formatNumber } from '../lib/metrics';
import ComplaintReasonModal from './ComplaintReasonModal';

/**
 * Pide el motivo (presets + detalle opcional) antes de marcar reclamos como
 * «No se puede refutar». Siempre pasa por acá: el estado no se asigna sin motivo.
 * Wrapper del genérico ComplaintReasonModal (mismos textos y comportamiento).
 */
export default function ComplaintNoRefutableModal({
  selectedCount = 1,
  onConfirm,
  onClose,
  disabled = false,
}) {
  const subtitle =
    selectedCount > 1
      ? `Elegí el motivo para los ${formatNumber(selectedCount)} reclamos seleccionados. ` +
        'La queja queda como «No refutable»: se pierde el dinero y ya no aparecen las ' +
        'acciones de refutar.'
      : 'Elegí el motivo. ' +
        'La queja queda como «No refutable»: se pierde el dinero y ya no aparecen las ' +
        'acciones de refutar.';

  return (
    <ComplaintReasonModal
      title="No se puede refutar"
      subtitle={subtitle}
      reasons={NO_REFUTABLE_REASONS}
      confirmLabel="Marcar como no refutable"
      detailPlaceholder="Ej: sin evidencia en la app"
      selectedCount={selectedCount}
      onConfirm={onConfirm}
      onClose={onClose}
      disabled={disabled}
    />
  );
}