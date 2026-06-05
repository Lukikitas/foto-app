import { useState } from 'react';
import { formatDateTime } from '../lib/date';
import {
  deletePhoto,
  downloadPhoto,
  getPhotoTimestamp,
  isValidOrderDigits,
  renamePhoto,
} from '../lib/photos';

export default function PhotoCard({ photo, onUpdated, onDeleted }) {
  const [renaming, setRenaming] = useState(false);
  const [newDigits, setNewDigits] = useState(photo.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const timestamp = getPhotoTimestamp(photo);

  function handleDigitsChange(e) {
    setNewDigits(e.target.value.replace(/\D/g, '').slice(0, 4));
  }

  async function handleRename(e) {
    e.preventDefault();
    if (!isValidOrderDigits(newDigits)) {
      setError('El pedido debe tener exactamente 4 dígitos.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated = await renamePhoto(photo.id, newDigits);
      onUpdated?.(updated);
      setRenaming(false);
    } catch (err) {
      setError(err.message || 'Error al corregir el número.');
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

  return (
    <>
      <article className="photo-card">
        <button
          type="button"
          className="photo-card__image-btn"
          onClick={() => setLightbox(true)}
          aria-label={`Ver pedido ${photo.name} en grande`}
        >
          <img
            src={photo.public_url}
            alt={`Pedido ${photo.name}`}
            className="photo-card__image"
            loading="lazy"
          />
        </button>

        <div className="photo-card__body">
          {renaming ? (
            <form className="photo-card__rename-form" onSubmit={handleRename}>
              <label>
                Corregir dígitos
                <input
                  type="text"
                  inputMode="numeric"
                  value={newDigits}
                  onChange={handleDigitsChange}
                  disabled={loading}
                  maxLength={4}
                  autoFocus
                />
              </label>
              <div className="photo-card__rename-actions">
                <button
                  type="submit"
                  className="btn btn--small btn--primary"
                  disabled={loading || newDigits.length !== 4}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => {
                    setRenaming(false);
                    setNewDigits(photo.name);
                    setError(null);
                  }}
                  disabled={loading}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <>
              <h3 className="photo-card__title">Pedido #{photo.name}</h3>
              <time className="photo-card__date" dateTime={timestamp}>
                {formatDateTime(timestamp)}
              </time>
            </>
          )}

          {error && (
            <p className="message message--error message--compact" role="alert">
              {error}
            </p>
          )}

          {confirmDelete ? (
            <div className="photo-card__confirm">
              <p>¿Eliminar pedido #{photo.name} del {formatDateTime(timestamp)}?</p>
              <div className="photo-card__confirm-actions">
                <button
                  type="button"
                  className="btn btn--small btn--danger"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  {loading ? 'Eliminando…' : 'Sí, eliminar'}
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
          ) : (
            <div className="photo-card__actions">
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => setLightbox(true)}
              >
                Ver
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={handleDownload}
              >
                Descargar
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => {
                  setRenaming(true);
                  setNewDigits(photo.name);
                  setError(null);
                }}
                disabled={loading}
              >
                Corregir
              </button>
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

      {lightbox && (
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
            <div className="lightbox__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleDownload}
              >
                Descargar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
