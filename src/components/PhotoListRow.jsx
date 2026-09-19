import { useState } from 'react';
import { formatDateTime } from '../lib/date';
import { aggregatorBadgeClass, getAggregatorLabel, getPhotoAggregator } from '../lib/aggregators';
import { useLongPress } from '../hooks/useLongPress';
import PhotoLightbox from './PhotoLightbox';
import PhotoEditForm from './PhotoEditForm';
import CompleteOrderCode from './CompleteOrderCode';
import { syncGalleryComplaintToHistory } from '../lib/complaintHistoryStore';
import {
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
    if (isOrder && !isValidOrderDigits(form.name)) {
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
      const updated = await updatePhoto(photo.id, form.name, {
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

  const pressHandlers = longPress.bind(openItem);
  const busy = editing || completing || confirmDelete;

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
