import { useState } from 'react';
import { formatDateTime } from '../lib/date';
import { useLongPress } from '../hooks/useLongPress';
import PhotoLightbox from './PhotoLightbox';
import {
  deletePhoto,
  downloadPhoto,
  getPhotoTimestamp,
} from '../lib/photos';

function RowBadges({ photo }) {
  if (!photo.has_complaint && !photo.is_refutado) return null;

  return (
    <span className="photo-row__badges">
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

  const longPress = useLongPress(() => onLongPressSelect?.(photo.id));

  async function handleDownload() {
    setError(null);
    try {
      await downloadPhoto(photo);
    } catch (err) {
      setError(err.message || 'Error al descargar.');
    }
  }

  async function handleDelete() {
    if (!window.confirm(`¿Eliminar pedido #${photo.name}?`)) return;

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

  const pressHandlers = longPress.bind(() => setLightbox(true));

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
          aria-label={`Seleccionar pedido ${photo.name}`}
        />

        <button
          type="button"
          className="photo-row__thumb"
          aria-label={`Ver pedido ${photo.name}`}
          {...pressHandlers}
        >
          <img src={photo.public_url} alt="" loading="lazy" />
        </button>

        <button
          type="button"
          className="photo-row__main"
          {...pressHandlers}
        >
          <span className="photo-row__digits">#{photo.name}</span>
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

      {lightbox && (
        <PhotoLightbox
          photo={photo}
          onClose={() => setLightbox(false)}
          onDownload={handleDownload}
        />
      )}
    </>
  );
}
