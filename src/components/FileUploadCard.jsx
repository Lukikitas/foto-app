import { useRef, useState } from 'react';
import PhotographerPicker from './PhotographerPicker';
import { getLastTakenBy, getTakenByHistory, saveLastTakenBy } from '../lib/storage';
import { enqueue } from '../lib/uploadQueue';

function getFileTitle(file) {
  return file?.name?.replace(/\.[^.]+$/, '') || '';
}

export default function FileUploadCard({ onUploaded, onCancel }) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [takenBy, setTakenBy] = useState(getLastTakenBy);
  const [takenByHistory, setTakenByHistory] = useState(getTakenByHistory);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function handlePhotographerChange(name, changeMeta) {
    setTakenBy(name);
    if (changeMeta?.selected && name.trim()) {
      saveLastTakenBy(name);
      setTakenByHistory(getTakenByHistory());
    }
  }

  function handleFileSelection(selected) {
    setError(null);
    setSuccess(null);
    if (!selected) return;

    setFile(selected);
    setTitle(getFileTitle(selected));
    if (selected.type.startsWith('image/')) {
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(selected);
      });
    } else {
      setPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
  }

  function handleFileInputChange(e) {
    handleFileSelection(e.target.files?.[0]);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelection(droppedFile);
    }
  }

  function resetSelection() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setTitle('');
    setNotes('');
    setError(null);
    setSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError('Elegí un archivo para subir.');
      return;
    }

    setSaving(true);
    try {
      if (takenBy.trim()) {
        saveLastTakenBy(takenBy);
        setTakenByHistory(getTakenByHistory());
      }

      await enqueue({
        file,
        kind: 'file',
        title: title.trim() || getFileTitle(file) || file.name,
        aggregator: 'sin_agregador',
        meta: {
          notes: notes.trim(),
          taken_by: takenBy.trim(),
          has_complaint: false,
          is_refutado: false,
        },
      });

      setSuccess(`"${title.trim() || file.name}" en cola de subida.`);
      resetSelection();
      onUploaded?.();
    } catch (err) {
      setError(err.message || 'Error al preparar el archivo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="file-upload-card">
      <div className="file-upload-card__header">
        <div className="file-upload-card__title-wrap">
          <span className="file-upload-card__icon" aria-hidden="true">📁</span>
          <div>
            <h3>Subir archivo general</h3>
            <p>Remitos, facturas, comprobantes o fotos no vinculadas a un pedido.</p>
          </div>
        </div>
        {onCancel && (
          <button
            type="button"
            className="btn btn--ghost btn--small file-upload-card__close"
            onClick={onCancel}
            aria-label="Cerrar subida"
          >
            ✕
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="file-upload-card__form">
        {/* Selector de operador/fotógrafo */}
        <div className="file-upload-card__photographer">
          <PhotographerPicker
            value={takenBy}
            history={takenByHistory}
            onChange={handlePhotographerChange}
          />
        </div>

        {/* Zona de Selección o Drag & Drop */}
        {!file ? (
          <div
            className={`file-upload-dropzone${dragOver ? ' is-dragover' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="file-upload-dropzone__content">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <strong>Arrastrá un archivo aquí o elegilo desde tu equipo</strong>
              <span>Soporta cualquier archivo: PDF, Excel, Word, imágenes, etc.</span>

              <div className="file-upload-dropzone__actions">
                <label className="btn btn--primary btn--small file-upload-dropzone__btn">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileInputChange}
                    className="visually-hidden"
                  />
                  <span>Elegir archivo</span>
                </label>

                <label className="btn btn--ghost btn--small file-upload-dropzone__btn">
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileInputChange}
                    className="visually-hidden"
                  />
                  <span>Tomar foto con cámara</span>
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div className="file-upload-selected">
            <div className="file-upload-selected__summary">
              <div className="file-upload-selected__info">
                {preview ? (
                  <img src={preview} alt="Vista previa" className="file-upload-selected__thumb" />
                ) : (
                  <div className="file-upload-selected__doc-icon" aria-hidden="true">
                    {(file.name.split('.').pop() || 'DOC').toUpperCase().slice(0, 4)}
                  </div>
                )}
                <div>
                  <strong className="file-upload-selected__name">{file.name}</strong>
                  <span className="file-upload-selected__size">{Math.ceil(file.size / 1024)} KB</span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--small file-upload-selected__remove"
                onClick={resetSelection}
              >
                ✕ Cambiar archivo
              </button>
            </div>

            <div className="file-upload-selected__fields">
              <label className="uploader__name-label">
                <span>Nombre o título del archivo</span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Remito proveedores, Factura pollo..."
                  maxLength={120}
                  required
                />
              </label>

              <label className="uploader__name-label">
                <span>Anotaciones adicionales (opcional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Aclaraciones, número de factura, detalles..."
                  rows={2}
                  maxLength={400}
                />
              </label>

              <button
                type="submit"
                className="btn btn--primary btn--large file-upload-card__submit"
                disabled={saving || !file}
              >
                {saving ? 'Preparando subida...' : '✓ Subir archivo ahora'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="message message--error file-upload-card__msg" role="alert">
            ⚠️ {error}
          </p>
        )}
        {success && (
          <p className="message message--success file-upload-card__msg" role="status">
            ✓ {success}
          </p>
        )}
      </form>
    </div>
  );
}
