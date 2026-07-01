import { useState } from 'react';
import {
  bulkDeletePhotos,
  bulkUpdateTakenBy,
  downloadPhotos,
} from '../lib/photos';

export default function BulkActionBar({
  selectedPhotos,
  onClearSelection,
  onUpdated,
  onDeleted,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showAuthorForm, setShowAuthorForm] = useState(false);
  const [authorName, setAuthorName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const count = selectedPhotos.length;
  if (count === 0) return null;

  async function handleDownload() {
    setLoading(true);
    setError(null);
    try {
      await downloadPhotos(selectedPhotos);
    } catch (err) {
      setError(err.message || 'Error al descargar.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAuthorSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const updated = await bulkUpdateTakenBy(selectedPhotos, authorName);
      onUpdated?.(updated);
      setShowAuthorForm(false);
      setAuthorName('');
      onClearSelection();
    } catch (err) {
      setError(err.message || 'Error al actualizar.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const ids = selectedPhotos.map((photo) => photo.id);
      await bulkDeletePhotos(selectedPhotos);
      onDeleted?.(ids);
      setConfirmDelete(false);
      onClearSelection();
    } catch (err) {
      setError(err.message || 'Error al eliminar.');
      setConfirmDelete(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bulk-bar" role="region" aria-label="Acciones en lote">
      <div className="bulk-bar__summary">
        <strong>{count} seleccionada{count !== 1 ? 's' : ''}</strong>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={onClearSelection}
          disabled={loading}
        >
          Cancelar
        </button>
      </div>

      {error && (
        <p className="message message--error message--compact" role="alert">
          {error}
        </p>
      )}

      {showAuthorForm ? (
        <form className="bulk-bar__form" onSubmit={handleAuthorSubmit}>
          <input
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="Nuevo autor"
            maxLength={80}
            autoFocus
            disabled={loading}
          />
          <button
            type="submit"
            className="btn btn--small btn--primary"
            disabled={loading || !authorName.trim()}
          >
            Aplicar
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => setShowAuthorForm(false)}
            disabled={loading}
          >
            Cerrar
          </button>
        </form>
      ) : confirmDelete ? (
        <div className="bulk-bar__confirm">
          <p>¿Eliminar {count} archivo{count !== 1 ? 's' : ''}?</p>
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
            No
          </button>
        </div>
      ) : (
        <div className="bulk-bar__actions">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={handleDownload}
            disabled={loading}
          >
            Descargar
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={() => setShowAuthorForm(true)}
            disabled={loading}
          >
            Cambiar autor
          </button>
          <button
            type="button"
            className="btn btn--small btn--danger"
            onClick={() => setConfirmDelete(true)}
            disabled={loading}
          >
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}
