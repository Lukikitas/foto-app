import { useRef, useState } from 'react';
import OrderCamera from './OrderCamera';
import { isValidOrderDigits } from '../lib/photos';
import { getLastTakenBy, saveLastTakenBy } from '../lib/storage';
import { enqueue } from '../lib/uploadQueue';

const EMPTY_META = {
  notes: '',
  taken_by: getLastTakenBy(),
  is_refutado: false,
};

const UPLOAD_MODES = {
  order: 'order',
  file: 'file',
};

function getFileTitle(file) {
  return file?.name?.replace(/\.[^.]+$/, '') || '';
}

export default function PhotoUploader() {
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploadMode, setUploadMode] = useState(UPLOAD_MODES.order);
  const [orderDigits, setOrderDigits] = useState('');
  const [detectedOrder, setDetectedOrder] = useState(null);
  const [showManualOrder, setShowManualOrder] = useState(false);
  const [orderCameraOpen, setOrderCameraOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState(EMPTY_META);
  const [error, setError] = useState(null);
  const [queuedMessage, setQueuedMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  function updateMeta(key, value) {
    setMeta((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setQueuedMessage(null);
  }

  function changeMode(mode) {
    setUploadMode(mode);
    setError(null);
    setQueuedMessage(null);
  }

  function handleDigitsChange(e) {
    const value = e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 32);
    setOrderDigits(value);
    setDetectedOrder(null);
    setError(null);
    setQueuedMessage(null);
  }

  function handleFileChange(e) {
    const selected = e.target.files?.[0];
    setError(null);
    setQueuedMessage(null);

    if (!selected) return;

    if (uploadMode === UPLOAD_MODES.order && !selected.type.startsWith('image/')) {
      setError('Para pedidos solo se permiten imágenes.');
      return;
    }

    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return selected.type.startsWith('image/') ? URL.createObjectURL(selected) : null;
    });
    setFile(selected);
    setTitle((current) => current || getFileTitle(selected));
    if (uploadMode === UPLOAD_MODES.order) {
      setDetectedOrder(null);
      setShowManualOrder(true);
    }
  }

  function handleOrderCapture(selected) {
    setError(null);
    saveLastTakenBy(meta.taken_by);
    enqueue({
      file: selected,
      kind: UPLOAD_MODES.order,
      meta: {
        ...meta,
        has_complaint: false,
      },
    });
    setQueuedMessage('Foto en cola. El código se buscará mientras seguís sacando fotos.');
  }

  function clearInputs() {
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function resetForm() {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);
    setOrderDigits('');
    setDetectedOrder(null);
    setShowManualOrder(false);
    setOrderCameraOpen(false);
    setTitle('');
    setMeta({
      ...EMPTY_META,
      taken_by: getLastTakenBy(),
    });
    clearInputs();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setQueuedMessage(null);

    if (!file) {
      setError(
        uploadMode === UPLOAD_MODES.order
          ? 'Sacá o elegí una foto primero.'
          : 'Elegí un archivo primero.',
      );
      return;
    }

    if (uploadMode === UPLOAD_MODES.order && !isValidOrderDigits(orderDigits)) {
      setError('Ingresá el código completo o los últimos 4 dígitos del pedido.');
      return;
    }

    setSaving(true);
    try {
      saveLastTakenBy(meta.taken_by);

      enqueue({
        file,
        kind: uploadMode,
        orderDigits,
        title: title.trim() || getFileTitle(file) || file.name,
        aggregator: 'sin_agregador',
        meta: {
          ...meta,
          has_complaint: false,
          is_refutado: uploadMode === UPLOAD_MODES.order ? meta.is_refutado : false,
        },
      });

      setQueuedMessage(
        uploadMode === UPLOAD_MODES.order
          ? `Pedido #${orderDigits} en cola. Podés seguir sacando fotos.`
          : `${title.trim() || file.name} en cola. Podés seguir subiendo archivos.`,
      );
      resetForm();
    } catch (err) {
      setError(err.message || 'Error al preparar el archivo.');
    } finally {
      setSaving(false);
    }
  }

  const isOrderMode = uploadMode === UPLOAD_MODES.order;

  return (
    <section className="uploader">
      {orderCameraOpen && (
        <OrderCamera
          onCapture={handleOrderCapture}
          onCancel={() => setOrderCameraOpen(false)}
        />
      )}
      <form className="uploader__form" onSubmit={handleSubmit}>
        <div className="uploader__mode" role="group" aria-label="Tipo de carga">
          <button
            type="button"
            className={`uploader__mode-btn${isOrderMode ? ' uploader__mode-btn--active' : ''}`}
            onClick={() => changeMode(UPLOAD_MODES.order)}
            aria-pressed={isOrderMode}
          >
            Pedido
          </button>
          <button
            type="button"
            className={`uploader__mode-btn${!isOrderMode ? ' uploader__mode-btn--active' : ''}`}
            onClick={() => changeMode(UPLOAD_MODES.file)}
            aria-pressed={!isOrderMode}
          >
            Archivo
          </button>
        </div>

        <div className="uploader__file-actions">
          {isOrderMode ? (
            <button
              type="button"
              className="uploader__file-btn"
              onClick={() => {
                setOrderCameraOpen(true);
                setError(null);
              }}
            >
              Abrir cámara rápida
            </button>
          ) : (
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
          )}

          {isOrderMode && (
            <label className="uploader__file-label">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="uploader__file-input"
              />
              <span className="uploader__file-btn uploader__file-btn--secondary">
                Foto sin lectura
              </span>
            </label>
          )}

          <label className="uploader__file-label">
            <input
              ref={fileInputRef}
              type="file"
              accept={isOrderMode ? 'image/*' : undefined}
              onChange={handleFileChange}
              className="uploader__file-input"
            />
            <span className="uploader__file-btn uploader__file-btn--secondary">
              {isOrderMode ? 'Elegir de galería' : 'Elegir archivo'}
            </span>
          </label>
        </div>

        {preview && (
          <div className="uploader__preview">
            <img src={preview} alt="Vista previa" />
            <button
              type="button"
              className="btn btn--ghost btn--small uploader__change-photo"
              onClick={resetForm}
            >
              Quitar archivo
            </button>
          </div>
        )}

        {!preview && file && (
          <div className="uploader__file-summary">
            <strong>{file.name}</strong>
            <span>{Math.ceil(file.size / 1024)} KB</span>
          </div>
        )}

        {isOrderMode && detectedOrder && !showManualOrder && (
          <div className="uploader__detected-order" role="status">
            <span>
              Código detectado: <strong>{detectedOrder.displayCode}</strong>
              {' · '}se guardará con este código
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setShowManualOrder(true)}
            >
              Corregir
            </button>
          </div>
        )}

        {isOrderMode && (!detectedOrder || showManualOrder) ? (
          <label className="uploader__name-label">
            Código de pedido
            <input
              type="text"
              pattern="(?:\d{4}|\d{1,4}-\d{4,}|(?:PEYA|RAPPI(?:TURBO)?|MPD?)[A-Z0-9-]{1,28})"
              value={orderDigits}
              onChange={handleDigitsChange}
              placeholder="Ej: PEYA12345"
              maxLength={32}
              className="uploader__digits-input"
              autoComplete="off"
            />
          </label>
        ) : (
          <label className="uploader__name-label">
            Nombre del archivo
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
                setQueuedMessage(null);
              }}
              placeholder={file ? getFileTitle(file) : 'Ej: remito, factura, evidencia'}
              maxLength={120}
            />
          </label>
        )}

        <label className="uploader__name-label">
          Quién lo subió
          <input
            type="text"
            value={meta.taken_by}
            onChange={(e) => updateMeta('taken_by', e.target.value)}
            placeholder="Ej: Lucas, María..."
            maxLength={80}
            autoComplete="name"
          />
        </label>

        <label className="uploader__name-label">
          Anotaciones
          <textarea
            value={meta.notes}
            onChange={(e) => updateMeta('notes', e.target.value)}
            placeholder="Detalles, observaciones, etc."
            maxLength={500}
            rows={3}
            className="uploader__textarea"
          />
        </label>

        {isOrderMode && (
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
        )}

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
          disabled={saving || !file || (isOrderMode && !isValidOrderDigits(orderDigits))}
        >
          {saving ? 'Preparando...' : 'Guardar y seguir'}
        </button>
      </form>
    </section>
  );
}
