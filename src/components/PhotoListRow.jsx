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

function RowBadges({ photo }) {
  const isFile = !isOrderPhoto(photo);
  const aggregator = getPhotoAggregator(photo);
  const codeNotFound = isUnidentifiedOrder(photo);

  if (!photo.has_complaint && !photo.is_refutado && !isFile && !aggregator && !codeNotFound) return null;

  return (
    <span className="photo-row__badges">
      {isFile && <span className="badge badge--file">{getPhotoKind(photo)}</span>}
      {aggregator && <span className={aggregatorBadgeClass(aggregator)}>{getAggregatorLabel(aggregator)}</span>}
      {codeNotFound && <span className="badge badge--missing-code">Código no encontrado</span>}
      {photo.has_complaint && <span className="badge badge--complaint">Reclamo</span>}
      {photo.is_refutado && <span className="badge badge--refutado">Refutado</span>}
    </span>
  );
}

export default function PhotoListRow({
  photo,
  selected,
  onToggleSelect,
  onLongPressSelect,
  onUpdated,
  onDeleted,
}) {
  const [lightbox, setLightbox] = useState(false);
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestedCode, setSuggestedCode] = useState(null);
  const timestamp = getPhotoTimestamp(photo);
  const title = getPhotoTitle(photo);
  const isOrder = isOrderPhoto(photo);
  const isImage = isImagePhoto(photo);
  const isUnidentified = isUnidentifiedOrder(photo);
  const extension = getFileExtension(photo).toUpperCase() || 'FILE';

  const longPress = useLongPress(() => onLongPressSelect?.(photo.id));

  function openItem() {
    if (isImage) {
      setLightbox(true);
      return;
    }
    window.open(photo.public_url, '_blank', 'noopener,noreferrer');
  }

  async function handleDownload() {
    setError(null);
    try {
      await downloadPhoto(photo);
    } catch (err) {
      setError(err.message || 'Error al descargar.');
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

  const pressHandlers = longPress.bind(openItem);
  const busy = editing || completing || confirmDelete || suggestedCode !== null;

  return (
    <>
      <div
        className={`photo-row${selected ? ' photo-row--selected' : ''}${photo.has_complaint ? ' photo-row--complaint' : ''}${busy ? ' photo-row--busy' : ''}`}
      >
        <input
          type="checkbox"
          className="photo-row__checkbox"
          checked={selected}
          onChange={() => onToggleSelect(photo.id)}
          aria-label={`Seleccionar ${title}`}
        />

        <button
          type="button"
          className={`photo-row__thumb${!isImage ? ' photo-row__thumb--file' : ''}`}
          aria-label={isImage ? `Ver ${title}` : `Abrir ${title}`}
          {...pressHandlers}
        >
          {isImage ? (
            <img src={photo.public_url} alt="" loading="lazy" />
          ) : (
            <span>{extension}</span>
          )}
        </button>

        <button
          type="button"
          className="photo-row__main"
          {...pressHandlers}
        >
          <span className="photo-row__digits">{title}</span>
          <span className="photo-row__date">{formatDateTime(timestamp)}</span>
          {photo.taken_by && (
            <span className="photo-row__author">{photo.taken_by}</span>
          )}
          {photo.notes && (
            <span className="photo-row__notes">{photo.notes}</span>
          )}
          <RowBadges photo={photo} />
        </button>

        {!busy && (
          <div className="photo-row__actions">
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={openItem}
            >
              {isImage ? 'Ver' : 'Abrir'}
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => {
                setEditing(true);
                setError(null);
              }}
              disabled={loading}
            >
              Editar
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={handleDownload}
              disabled={loading}
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

        {editing && (
          <div className="photo-row__panel">
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
          </div>
        )}

        {completing && (
          <div className="photo-row__panel">
            <CompleteOrderCode
              loading={loading}
              error={error}
              onSubmit={handleComplete}
              onCancel={() => {
                setCompleting(false);
                setError(null);
              }}
            />
          </div>
        )}

        {suggestedCode !== null && (
          <div className="photo-row__panel">
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
          </div>
        )}

        {confirmDelete && (
          <div className="photo-row__panel photo-row__confirm">
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
        )}

        {error && !completing && <span className="photo-row__error">{error}</span>}
      </div>

      {lightbox && isImage && (
        <PhotoLightbox
          photo={photo}
          onClose={() => setLightbox(false)}
          onDownload={handleDownload}
        />
      )}
    </>
  );
}
