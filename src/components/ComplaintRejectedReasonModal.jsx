import { REFUTATION_REJECTED_REASONS } from '../lib/complaintHistory';
import { formatNumber } from '../lib/metrics';
import ComplaintReasonModal from './ComplaintReasonModal';

/**
 * Pide el motivo (presets + comentario opcional) antes de marcar reclamos como
 * «Ref. rechazado». Ninguna asignación manual de ese estado se hace sin motivo.
 */
export default function ComplaintRejectedReasonModal({
  selectedCount = 1,
  onConfirm,
  onClose,
  disabled = false,
}) {
  return (
    <ComplaintReasonModal
      title="Refutación rechazada"
      subtitle={
        selectedCount > 1
          ? `Elegí por qué el agregador rechazó la refutación para los ${formatNumber(selectedCount)} reclamos seleccionados. ` +
            'La queja queda como «Ref. rechazado» y el dinero se cuenta como pérdida confirmada.'
          : 'Elegí por qué el agregador rechazó la refutación. ' +
            'La queja queda como «Ref. rechazado» y el dinero se cuenta como pérdida confirmada.'
      }
      reasons={REFUTATION_REJECTED_REASONS}
      confirmLabel="Marcar como rechazado"
      detailLabel="Comentario (opcional)"
      detailPlaceholder="Ej: el ticket no se lee"
      selectedCount={selectedCount}
      onConfirm={onConfirm}
      onClose={onClose}
      disabled={disabled}
    />
  );
}
