import Dialog from './Dialog';
import { useEffect, useId } from 'react';
import { formatNumber } from '../lib/metrics';

/**
 * Popup de confirmación al cambiar el plazo de «Liberación de fotos» en
 * Ajustes: muestra cuántas fotos se borrarían en la próxima limpieza con el
 * plazo nuevo (mismo cálculo que hará la función edge).
 */
export default function PhotoRetentionConfirmModal({
  days,
  currentDays,
  count = null,
  currentCount = null,
  countFailed = false,
  enabled = true,
  onConfirm,
  onClose,
}) {
  const titleId = useId();

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const lower = count != null && currentCount != null && days < currentDays;
  const higher = count != null && currentCount != null && days > currentDays;
  const protectedAgain = higher ? currentCount - count : 0;

  return (
    <Dialog labelledBy={titleId} onClose={onClose}>
      <div className="release-modal__dialog photo-retention-modal">
        <header className="photo-retention-modal__header">
          <div>
            <h3 id={titleId}>Confirmar plazo de {formatNumber(days)} días</h3>
            <p className="photo-retention-modal__subtitle">
              {countFailed
                ? 'No se pudo calcular la cantidad de fotos ahora mismo. Podés guardar igual: ' +
                  'la limpieza respeta siempre los mismos criterios.'
                : `Se borrarán ${formatNumber(count)} foto${count === 1 ? '' : 's'} de pedidos ` +
                  'sin queja en la próxima limpieza automática' +
                  (enabled ? ' (programada diariamente a las 01:43, hora argentina).' : ' cuando actives la limpieza automática.')}
            </p>
          </div>
        </header>

        <div className="retention-confirm__body">
          {lower && (
            <p>
              De esas, {formatNumber(count - currentCount)} dejan de estar protegidas
              por este cambio (con el plazo actual de {formatNumber(currentDays)} días).
            </p>
          )}
          {higher && protectedAgain > 0 && (
            <p>
              Con el plazo actual ({formatNumber(currentDays)} días) se borrarían{' '}
              {formatNumber(currentCount)} fotos: con {formatNumber(days)} días quedan
              protegidas {formatNumber(protectedAgain)} más.
            </p>
          )}
          <p>
            Las fotos de quejas, las refutadas y las evidencias de los reclamos nunca
            se borran; la fila de la foto se conserva para que las métricas no cambien.
          </p>
          {!enabled && (
            <p className="retention-confirm__warning">
              La limpieza automática está desactivada: el plazo se aplica cuando la actives.
            </p>
          )}
        </div>

        <footer className="retention-confirm__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary btn--small" onClick={onConfirm} autoFocus>
            Guardar plazo de {formatNumber(days)} días
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
