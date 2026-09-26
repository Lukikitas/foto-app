import { useState } from 'react';
import { formatDateTime } from '../lib/date';
import { aggregatorBadgeClass, getAggregatorLabel, getPhotoAggregator } from '../lib/aggregators';
import { useLongPress } from '../hooks/useLongPress';
import PhotoLightbox from './PhotoLightbox';
import PhotoEditForm from './PhotoEditForm';
import CompleteOrderCode from './CompleteOrderCode';
import { syncGalleryComplaintToHistory } from '../lib/complaintHistoryStore';
import { suggestUnresolvedOrderCode } from '../lib/unresolvedTicketReview.js';
import {
  cleanupReplacedPhoto,
  deletePhoto,
  downloadPhoto,
  getFileExtension,
  getPhotoKind,
  getPhotoTimestamp,
  getPhotoTitle,
  isImagePhoto,
  isOrderPhoto,
  isUnidentifiedOrder,
  isValidOrderDigits,
  updatePhoto,
  updatePhotoDetails,
} from '../lib/photos';

function PhotoBadges({ photo }) {
  const isFile = !isOrderPhoto(photo);
  const aggregator = getPhotoAggregator(photo);
  const codeNotFound = isUnidentifiedOrder(photo);

  if (!photo.has_complaint && !photo.is_refutado && !isFile && !aggregator && !codeNotFound) return null;

  return (
    <div className="photo-card__badges">
      {isFile && <span className="badge badge--file">{getPhotoKind(photo)}</span>}
      {aggregator && <span className={aggregatorBadgeClass(aggregator)}>{getAggregatorLabel(aggregator)}</span>}
      {codeNotFound && <span className="badge badge--missing-code">Código no encontrado</span>}
      {photo.has_complaint && (
        <span className="badge badge--complaint">Reclamo</span>
      )}
      {photo.is_refutado && (
        <span className="badge badge--refutado">Refutado</span>
      )}
    </div>
  );
}

export default function PhotoCard({
  photo,
  selected = false,
  onToggleSelect,
  onLongPressSelect,
  onUpdated,
  onDeleted,
}) {
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestedCode, setSuggestedCode] = useState(null);

  const timestamp = getPhotoTimestamp(photo);
  const title = getPhotoTitle(photo);
  const isOrder = isOrderPhoto(photo);
  const isUnidentified = isUnidentifiedOrder(photo);
  const isImage = isImagePhoto(photo);
  const extension = getFileExtension(photo).toUpperCase() || 'FILE';
  const longPress = useLongPress(() => onLongPressSelect?.(photo.id));
  const imagePress = longPress.bind(() => {
    if (isImage) setLightbox(true);
    else window.open(photo.public_url, '_blank', 'noopener,noreferrer');
  });

  async function handleRetryTicket() {
    setLoading(true);
    setError(null);
    try {
      const code = await suggestUnresolvedOrderCode(photo);
      if (!code) {
        setError('No se pudo leer el código de estas fotos. Podés completarlo manualmente.');
        return;
      }
      setSuggestedCode(code);
    } catch (err) {
      setError(err.message || 'No se pudo reintentar la lectura.');
    } finally {
      setLoading(false);
    }
  }

  async function saveSuggestedCode(event) {
    event.preventDefault();
    if (!isValidOrderDigits(suggestedCode)) {
      setError('Ingresá un código de pedido válido.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updated = await updatePhoto(photo.id, suggestedCode, {
        notes: photo.notes || '',
        has_complaint: Boolean(photo.has_complaint),
        taken_by: photo.taken_by || '',
        is_refutado: Boolean(photo.is_refutado),
      });
      setSuggestedCode(null);
      onUpdated?.(updated);
    } catch (err) {
      setError(err.message || 'No se pudo guardar el código.');
    } finally {
      setLoading(false);
    }
  }

  async function handleEdit(form) {
    if (isOrder && form.name !== 'Código no encontrado' && !isValidOrderDigits(form.name)) {
      setError('Ingresá un código de pedido válido.');
      return;
    }
    if (!form.name.trim()) {
      setError('Ingresá un nombre.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated = await updatePhotoDetails(photo, {
        ...form,
        has_complaint: isOrder ? form.has_complaint : false,
        is_refutado: isOrder ? form.is_refutado : false,
      });
      if (isOrder) {
        try {
          await syncGalleryComplaintToHistory(updated);
        } catch (err) {
          onUpdated?.(updated);
          setEditing(false);
          setError(err.message || 'La foto se guardó, pero no se pudo actualizar el historial.');
          return;
        }
      }
      await cleanupReplacedPhoto(photo, updated);
      onUpdated?.(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message || 'Error al guardar los cambios.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      await deletePhoto(photo.id, photo.file_path);
      onDeleted?.(photo.id);
    } catch (err) {
      setError(err.message || 'Error al eliminar.');
      setConfirmDelete(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setError(null);
    try {
      await downloadPhoto(photo);
    } catch (err) {
      setError(err.message || 'Error al descargar.');
    }
  }

  async function handleComplete(digits) {
    if (!/^\d{4}$/.test(digits)) {
      setError('Ingresá los últimos 4 dígitos.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated = await updatePhoto(photo.id, digits, {
        notes: photo.notes || '',
        has_complaint: Boolean(photo.has_complaint),
        taken_by: photo.taken_by || '',
        is_refutado: Boolean(photo.is_refutado),
      });
      onUpdated?.(updated);
      setCompleting(false);
    } catch (err) {
      setError(err.message || 'Error al guardar el código.');
    } finally {
      setLoading(false);
    }
  }

  function startEditing() {
    setEditing(true);
    setCompleting(false);
    setSuggestedCode(null);
    setConfirmDelete(false);
    setError(null);
  }

  return (
    <>
      <article
        className={[
          'photo-card',
          selected ? 'photo-card--selected' : '',
          photo.has_complaint ? 'photo-card--complaint' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="photo-card__image-wrap">
          <label className="photo-card__select">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.(photo.id)}
              aria-label={`Seleccionar ${title}`}
            />
          </label>
          <PhotoBadges photo={photo} />
          <button
            type="button"
            className={`photo-card__image-btn${!isImage ? ' photo-card__image-btn--file' : ''}`}
            aria-label={isImage ? `Ver ${title} en grande` : `Abrir ${title}`}
            {...imagePress}
          >
            {isImage ? (
              <img
                src={photo.public_url}
                alt={title}
                className="photo-card__image"
                loading="lazy"
              />
            ) : (
              <span className="photo-card__file-preview">
                <span className="photo-card__file-icon" aria-hidden="true">DOC</span>
                <strong>{extension}</strong>
                <small>Abrir archivo</small>
              </span>
            )}
          </button>
        </div>

        <div className="photo-card__body">
          {suggestedCode !== null ? (
            <form className="complete-code" onSubmit={saveSuggestedCode}>
              <label className="complete-code__label">
                Código sugerido · revisalo en la foto
                <input
                  type="text"
                  className="complete-code__input complete-code__input--full"
                  value={suggestedCode}
                  onChange={(event) => setSuggestedCode(event.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 32))}
                  disabled={loading}
                  maxLength={32}
                  autoFocus
                />
              </label>
              <div className="complete-code__actions">
                <button type="submit" className="btn btn--small btn--primary" disabled={loading || !isValidOrderDigits(suggestedCode)}>
                  {loading ? 'Guardando…' : 'Confirmar código'}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={() => setSuggestedCode(null)} disabled={loading}>
                  Descartar
                </button>
              </div>
            </form>
          ) : completing ? (
            <CompleteOrderCode
              loading={loading}
              error={error}
              onSubmit={handleComplete}
              onCancel={() => {
                setCompleting(false);
                setError(null);
              }}
            />
          ) : editing ? (
            <PhotoEditForm
              key={photo.id}
              photo={photo}
              loading={loading}
              onSubmit={handleEdit}
              onCancel={() => {
                setEditing(false);
                setError(null);
              }}
            />
          ) : (
            <>
              <h3 className="photo-card__title">{title}</h3>
              <time className="photo-card__date" dateTime={timestamp}>
                {formatDateTime(timestamp)}
              </time>
              {photo.taken_by && (
                <p className="photo-card__meta">
                  Subió: <strong>{photo.taken_by}</strong>
                </p>
              )}
              {photo.notes && (
                <p className="photo-card__notes">{photo.notes}</p>
              )}
            </>
          )}

          {error && !completing && (
            <p className="message message--error message--compact" role="alert">
              {error}
            </p>
          )}

          {confirmDelete ? (
            <div className="photo-card__confirm">
              <p>¿Eliminar {title} del {formatDateTime(timestamp)}?</p>
              <div className="photo-card__confirm-actions">
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  {loading ? 'Eliminando...' : 'Sí, eliminar'}
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => setConfirmDelete(false)}
                  disabled={loading}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : !editing && !completing && suggestedCode === null && (
            <div className="photo-card__actions">
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => {
                  if (isImage) setLightbox(true);
                  else window.open(photo.public_url, '_blank', 'noopener,noreferrer');
                }}
              >
                {isImage ? 'Ver' : 'Abrir'}
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={startEditing}
                disabled={loading}
              >
                Editar
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={handleDownload}
              >
                Descargar
              </button>
              {isUnidentified && (
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={handleRetryTicket}
                  disabled={loading}
                >
                  {loading ? 'Leyendo fotos…' : 'Buscar código en fotos'}
                </button>
              )}
              {isUnidentified && (
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  onClick={() => {
                    setCompleting(true);
                    setError(null);
                  }}
                  disabled={loading}
                >
                  Completar código
                </button>
              )}
              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => {
                  setConfirmDelete(true);
                  setError(null);
                }}
                disabled={loading}
              >
                Borrar
              </button>
            </div>
          )}
        </div>
      </article>

      {lightbox && isImage && (
        <PhotoLightbox
          photo={photo}
          onClose={() => setLightbox(false)}
          onDownload={handleDownload}
          badges={<PhotoBadges photo={photo} />}
        />
      )}
    </>
  );
}
