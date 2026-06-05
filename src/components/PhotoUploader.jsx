import { useRef, useState } from 'react';
import { formatDateTime } from '../lib/date';
import { isValidOrderDigits, uploadPhoto } from '../lib/photos';

export default function PhotoUploader({ onUploaded }) {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [orderDigits, setOrderDigits] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

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
      const photo = await uploadPhoto(file, orderDigits);
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
        Sacá una foto del delivery e ingresá los 4 últimos dígitos del pedido.
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
