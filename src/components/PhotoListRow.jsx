import { useState } from 'react';
import { formatDateTime } from '../lib/date';
import { aggregatorBadgeClass, getAggregatorLabel, getPhotoAggregator } from '../lib/aggregators';
import { useLongPress } from '../hooks/useLongPress';
import PhotoLightbox from './PhotoLightbox';
import CompleteOrderCode from './CompleteOrderCode';
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
      {photo.has_complaint && <span className="badge badge--complaint">R</span>}
      {photo.is_refutado && <span className="badge badge--refutado">Ref</span>}
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
  const [completing, setCompleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timestamp = getPhotoTimestamp(photo);
  const title = getPhotoTitle(photo);
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
    if (!window.confirm(`¿Eliminar ${title}?`)) return;

    setLoading(true);
    setError(null);
    try {
      await deletePhoto(photo.id, photo.file_path);
      onDeleted?.(photo.id);
    } catch (err) {
      setError(err.message || 'Error al eliminar.');
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

  return (
    <>
      <div
        className={`photo-row${selected ? ' photo-row--selected' : ''}${photo.has_complaint ? ' photo-row--complaint' : ''}${completing ? ' photo-row--completing' : ''}`}
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

        <div className="photo-row__actions">
          {isUnidentified && !completing && (
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
            className="btn btn--icon"
            onClick={handleDownload}
            title="Descargar"
            disabled={loading}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn--icon btn--icon-danger"
            onClick={handleDelete}
            title="Borrar"
            disabled={loading}
          >
            ×
          </button>
        </div>

        {completing && (
          <div className="photo-row__complete">
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
