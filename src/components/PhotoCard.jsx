import { useState } from 'react';
import { formatDateTime } from '../lib/date';
import { useLongPress } from '../hooks/useLongPress';
import {
  deletePhoto,
  downloadPhoto,
  getPhotoTimestamp,
  isValidOrderDigits,
  updatePhoto,
} from '../lib/photos';

function PhotoBadges({ photo }) {
  if (!photo.has_complaint && !photo.is_refutado) return null;

  return (
    <div className="photo-card__badges">
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
  const [form, setForm] = useState({
    orderDigits: photo.name,
    notes: photo.notes || '',
    has_complaint: Boolean(photo.has_complaint),
    taken_by: photo.taken_by || '',
    is_refutado: Boolean(photo.is_refutado),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const timestamp = getPhotoTimestamp(photo);
  const longPress = useLongPress(() => onLongPressSelect?.(photo.id));
  const imagePress = longPress.bind(() => setLightbox(true));

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleDigitsChange(e) {
    updateForm('orderDigits', e.target.value.replace(/\D/g, '').slice(0, 4));
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!isValidOrderDigits(form.orderDigits)) {
      setError('El pedido debe tener exactamente 4 dígitos.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated = await updatePhoto(photo.id, form.orderDigits, form);
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

  function startEditing() {
    setForm({
      orderDigits: photo.name,
      notes: photo.notes || '',
      has_complaint: Boolean(photo.has_complaint),
      taken_by: photo.taken_by || '',
      is_refutado: Boolean(photo.is_refutado),
    });
    setEditing(true);
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
              aria-label={`Seleccionar pedido ${photo.name}`}
            />
          </label>
          <PhotoBadges photo={photo} />
          <button
            type="button"
            className="photo-card__image-btn"
            aria-label={`Ver pedido ${photo.name} en grande`}
            {...imagePress}
          >
            <img
              src={photo.public_url}
              alt={`Pedido ${photo.name}`}
              className="photo-card__image"
              loading="lazy"
            />
          </button>
        </div>

        <div className="photo-card__body">
          {editing ? (
            <form className="photo-card__edit-form" onSubmit={handleEdit}>
              <label>
                Dígitos del pedido
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.orderDigits}
                  onChange={handleDigitsChange}
                  disabled={loading}
                  maxLength={4}
                  autoFocus
                />
              </label>

              <label>
                Quién sacó la foto
                <input
                  type="text"
                  value={form.taken_by}
                  onChange={(e) => updateForm('taken_by', e.target.value)}
                  disabled={loading}
                  maxLength={80}
                />
              </label>

              <label>
                Anotaciones
                <textarea
                  value={form.notes}
                  onChange={(e) => updateForm('notes', e.target.value)}
                  disabled={loading}
                  maxLength={500}
                  rows={2}
                />
              </label>

              <div className="photo-card__edit-flags">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.has_complaint}
                    onChange={(e) => updateForm('has_complaint', e.target.checked)}
                    disabled={loading}
                  />
                  <span>Pedido con reclamo</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.is_refutado}
                    onChange={(e) => updateForm('is_refutado', e.target.checked)}
                    disabled={loading}
                  />
                  <span>Es un refutado</span>
                </label>
              </div>

              <div className="photo-card__rename-actions">
                <button
                  type="submit"
                  className="btn btn--small btn--primary"
                  disabled={loading || form.orderDigits.length !== 4}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => {
                    setEditing(false);
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
              {photo.taken_by && (
                <p className="photo-card__meta">
                  Sacó: <strong>{photo.taken_by}</strong>
                </p>
              )}
              {photo.notes && (
                <p className="photo-card__notes">{photo.notes}</p>
              )}
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
          ) : !editing && (
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
                onClick={startEditing}
                disabled={loading}
              >
                Editar
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
          <button
            type="button"
            className="lightbox__close"
            onClick={() => setLightbox(false)}
            aria-label="Cerrar"
          >
            ×
          </button>
          <div className="lightbox__content" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox__stage">
              <img src={photo.public_url} alt={`Pedido ${photo.name}`} />
            </div>
            <div className="lightbox__footer">
              <p className="lightbox__caption">Pedido #{photo.name}</p>
              <p className="lightbox__date">{formatDateTime(timestamp)}</p>
              {photo.taken_by && (
                <p className="lightbox__meta">Sacó: {photo.taken_by}</p>
              )}
              {photo.notes && (
                <p className="lightbox__notes">{photo.notes}</p>
              )}
              <div className="lightbox__badges">
                <PhotoBadges photo={photo} />
              </div>
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
        </div>
      )}
    </>
  );
}
