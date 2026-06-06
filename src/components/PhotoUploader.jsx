import { useRef, useState } from 'react';
import { isValidOrderDigits } from '../lib/photos';
import { getLastTakenBy, saveLastTakenBy } from '../lib/storage';
import { enqueue } from '../lib/uploadQueue';

const EMPTY_META = {
  notes: '',
  taken_by: getLastTakenBy(),
  is_refutado: false,
};

export default function PhotoUploader() {
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [orderDigits, setOrderDigits] = useState('');
  const [meta, setMeta] = useState(EMPTY_META);
  const [error, setError] = useState(null);
  const [queuedMessage, setQueuedMessage] = useState(null);

  function updateMeta(key, value) {
    setMeta((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setQueuedMessage(null);
  }

  function handleDigitsChange(e) {
    const value = e.target.value.replace(/\D/g, '').slice(0, 4);
    setOrderDigits(value);
    setError(null);
    setQueuedMessage(null);
  }

  function handleFileChange(e) {
    const selected = e.target.files?.[0];
    setError(null);
    setQueuedMessage(null);

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

  function clearInputs() {
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  }

  function resetForm() {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);
    setOrderDigits('');
    setMeta({
      ...EMPTY_META,
      taken_by: getLastTakenBy(),
    });
    clearInputs();
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setQueuedMessage(null);

    if (!file) {
      setError('Sacá o elegí una foto primero.');
      return;
    }

    if (!isValidOrderDigits(orderDigits)) {
      setError('Ingresá los 4 últimos dígitos del pedido.');
      return;
    }

    saveLastTakenBy(meta.taken_by);

    enqueue({
      file,
      orderDigits,
      meta: { ...meta, has_complaint: false },
    });

    setQueuedMessage(
      `Pedido #${orderDigits} en cola. Podés seguir sacando fotos.`
    );
    resetForm();
  }

  return (
    <section className="uploader">
      <form className="uploader__form" onSubmit={handleSubmit}>
        <div className="uploader__file-actions">
          <label className="uploader__file-label">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="uploader__file-input"
            />
            <span className="uploader__file-btn">Sacar foto</span>
          </label>

          <label className="uploader__file-label">
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="uploader__file-input"
            />
            <span className="uploader__file-btn uploader__file-btn--secondary">
              Elegir de galería
            </span>
          </label>
        </div>

        {preview && (
          <div className="uploader__preview">
            <img src={preview} alt="Vista previa del pedido" />
            <button
              type="button"
              className="btn btn--ghost btn--small uploader__change-photo"
              onClick={resetForm}
            >
              Quitar foto
            </button>
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
            maxLength={500}
            rows={3}
            className="uploader__textarea"
          />
        </label>

        <div className="uploader__flags">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={meta.is_refutado}
              onChange={(e) => updateMeta('is_refutado', e.target.checked)}
            />
            <span>Es un refutado</span>
          </label>
        </div>

        {error && (
          <p className="message message--error" role="alert">
            {error}
          </p>
        )}
        {queuedMessage && (
          <p className="message message--success" role="status">
            {queuedMessage}
          </p>
        )}

        <button
          type="submit"
          className="btn btn--primary btn--large"
          disabled={!file || orderDigits.length !== 4}
        >
          Guardar y seguir
        </button>
      </form>
    </section>
  );
}
