import { useState } from 'react';
import { formatDateTime } from '../lib/date';
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
  selectionMode,
  onToggleSelect,
  onUpdated,
  onDeleted,
}) {
  const [lightbox, setLightbox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timestamp = getPhotoTimestamp(photo);

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

  function handleRowClick() {
    if (selectionMode) {
      onToggleSelect(photo.id);
      return;
    }
    setLightbox(true);
  }

  return (
    <>
      <div
        className={`photo-row${selected ? ' photo-row--selected' : ''}${photo.has_complaint ? ' photo-row--complaint' : ''}`}
      >
        {selectionMode && (
          <input
            type="checkbox"
            className="photo-row__checkbox"
            checked={selected}
            onChange={() => onToggleSelect(photo.id)}
            aria-label={`Seleccionar pedido ${photo.name}`}
          />
        )}

        <button
          type="button"
          className="photo-row__thumb"
          onClick={handleRowClick}
          aria-label={`Ver pedido ${photo.name}`}
        >
          <img src={photo.public_url} alt="" loading="lazy" />
        </button>

        <button
          type="button"
          className="photo-row__main"
          onClick={handleRowClick}
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

        {!selectionMode && (
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
        )}

        {error && <span className="photo-row__error">{error}</span>}
      </div>

      {lightbox && !selectionMode && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Pedido ${photo.name}`}
          onClick={() => setLightbox(false)}
        >
          <div className="lightbox__content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="lightbox__close"
              onClick={() => setLightbox(false)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <img src={photo.public_url} alt={`Pedido ${photo.name}`} />
            <p className="lightbox__caption">Pedido #{photo.name}</p>
            <p className="lightbox__date">{formatDateTime(timestamp)}</p>
            {photo.taken_by && (
              <p className="lightbox__meta">Sacó: {photo.taken_by}</p>
            )}
            {photo.notes && <p className="lightbox__notes">{photo.notes}</p>}
            <div className="lightbox__actions">
              <button type="button" className="btn btn--ghost" onClick={handleDownload}>
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
