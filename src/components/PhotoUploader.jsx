import { useRef, useState } from 'react';
import { formatDateTime } from '../lib/date';
import { isValidOrderDigits, uploadPhoto } from '../lib/photos';
import { getLastTakenBy, saveLastTakenBy } from '../lib/storage';

const EMPTY_META = {
  notes: '',
  has_complaint: false,
  taken_by: getLastTakenBy(),
  is_refutado: false,
};

export default function PhotoUploader({ onUploaded }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [orderDigits, setOrderDigits] = useState('');
  const [meta, setMeta] = useState(EMPTY_META);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function updateMeta(key, value) {
    setMeta((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  function handleDigitsChange(e) {
    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
    setOrderDigits(value);
    setError(null);
    setSuccess(null);
  }

  function handleFileChange(e) {
    const selected = e.target.files?.[0];
    setError(null);
    setSuccess(null);

    if (!selected) return;

    if (!selected.type.startsWith('image/')) {
      setError('Solo se permiten archivos de imagen.');
      return;
    }

    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(selected);
    });
    setFile(selected);
  }

  function resetForm() {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);
    setOrderDigits('');
    setMeta({ ...EMPTY_META, taken_by: getLastTakenBy() });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError('Sacá la foto del pedido primero.');
      return;
    }

    if (!isValidOrderDigits(orderDigits)) {
      setError('Ingresá los 4 últimos dígitos del pedido.');
      return;
    }

    setLoading(true);
    try {
      saveLastTakenBy(meta.taken_by);
      const photo = await uploadPhoto(file, orderDigits, meta);
      const when = formatDateTime(photo.created_at);
      setSuccess(`Pedido #${photo.name} guardado el ${when}.`);
      resetForm();
      onUploaded?.(photo);
    } catch (err) {
      setError(err.message || 'Error al subir la foto.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="uploader">
      <h2>Foto del pedido</h2>
      <p className="uploader__hint">
        Sacá la foto, ingresá los 4 dígitos y agregá anotaciones si hace falta.
        La fecha y hora se guardan automáticamente.
      </p>

      <form className="uploader__form" onSubmit={handleSubmit}>
        <label className="uploader__file-label">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            disabled={loading}
            className="uploader__file-input"
          />
          <span className="uploader__file-btn">
            {file ? 'Cambiar foto' : 'Sacar foto del pedido'}
          </span>
        </label>

        {preview && (
          <div className="uploader__preview">
            <img src={preview} alt="Vista previa del pedido" />
          </div>
        )}

        <label className="uploader__name-label">
          Últimos 4 dígitos del pedido
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{4}"
            value={orderDigits}
            onChange={handleDigitsChange}
            placeholder="Ej: 4821"
            disabled={loading}
            maxLength={4}
            className="uploader__digits-input"
            autoComplete="off"
          />
        </label>

        <label className="uploader__name-label">
          Quién sacó la foto
          <input
            type="text"
            value={meta.taken_by}
            onChange={(e) => updateMeta('taken_by', e.target.value)}
            placeholder="Ej: Lucas, María…"
            disabled={loading}
            maxLength={80}
            autoComplete="name"
          />
        </label>

        <label className="uploader__name-label">
          Anotaciones
          <textarea
            value={meta.notes}
            onChange={(e) => updateMeta('notes', e.target.value)}
            placeholder="Detalles del pedido, observaciones, etc."
            disabled={loading}
            maxLength={500}
            rows={3}
            className="uploader__textarea"
          />
        </label>

        <div className="uploader__flags">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={meta.has_complaint}
              onChange={(e) => updateMeta('has_complaint', e.target.checked)}
              disabled={loading}
            />
            <span>Pedido con reclamo</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={meta.is_refutado}
              onChange={(e) => updateMeta('is_refutado', e.target.checked)}
              disabled={loading}
            />
            <span>Es un refutado</span>
          </label>
        </div>

        {error && (
          <p className="message message--error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="message message--success" role="status">
            {success}
          </p>
        )}

        <button
          type="submit"
          className="btn btn--primary"
          disabled={loading || !file || orderDigits.length !== 4}
        >
          {loading ? 'Guardando…' : 'Guardar foto del pedido'}
        </button>
      </form>
    </section>
  );
}
