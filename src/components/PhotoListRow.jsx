import { useState } from 'react';
import { formatDateTime } from '../lib/date';
import { useLongPress } from '../hooks/useLongPress';
import PhotoLightbox from './PhotoLightbox';
import {
  deletePhoto,
  downloadPhoto,
  getFileExtension,
  getPhotoKind,
  getPhotoTimestamp,
  getPhotoTitle,
  isImagePhoto,
  isOrderPhoto,
} from '../lib/photos';

function RowBadges({ photo }) {
  const isFile = !isOrderPhoto(photo);

  if (!photo.has_complaint && !photo.is_refutado && !isFile) return null;

  return (
    <span className="photo-row__badges">
      {isFile && <span className="badge badge--file">{getPhotoKind(photo)}</span>}
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
  onDeleted,
}) {
  const [lightbox, setLightbox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timestamp = getPhotoTimestamp(photo);
  const title = getPhotoTitle(photo);
  const isImage = isImagePhoto(photo);
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

  const pressHandlers = longPress.bind(openItem);

  return (
    <>
      <div
        className={`photo-row${selected ? ' photo-row--selected' : ''}${photo.has_complaint ? ' photo-row--complaint' : ''}`}
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

        {error && <span className="photo-row__error">{error}</span>}
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
