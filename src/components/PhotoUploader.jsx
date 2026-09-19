import { useRef, useState } from 'react';
import OrderCamera from './OrderCamera';
import PhotographerPicker from './PhotographerPicker';
import { isValidOrderDigits } from '../lib/photos';
import { getLastTakenBy, getTakenByHistory, saveLastTakenBy } from '../lib/storage';
import { enqueue } from '../lib/uploadQueue';
import { isPhoneViewport } from '../lib/viewport';

function getEmptyMeta() {
  return {
    notes: '',
    taken_by: getLastTakenBy(),
    is_refutado: false,
  };
}

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
  const [orderCameraOpen, setOrderCameraOpen] = useState(() => isPhoneViewport());
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState(getEmptyMeta);
  const [takenByHistory, setTakenByHistory] = useState(getTakenByHistory);
  const [error, setError] = useState(null);
  const [queuedMessage, setQueuedMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  function updateMeta(key, value) {
    setMeta((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setQueuedMessage(null);
  }

  function handlePhotographerChange(name, changeMeta) {
    updateMeta('taken_by', name);
    if (changeMeta?.selected && name.trim()) {
      saveLastTakenBy(name);
      setTakenByHistory(getTakenByHistory());
    }
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

  function closeOrderCamera() {
    setTakenByHistory(getTakenByHistory());
    setMeta((prev) => ({
      ...prev,
      taken_by: getLastTakenBy() || prev.taken_by,
    }));
    setOrderCameraOpen(false);
  }

  function openOrderCamera() {
    const name = meta.taken_by.trim();
    if (!name) {
      setError('Poné quién está sacando la foto.');
      return;
    }

    saveLastTakenBy(name);
    setTakenByHistory(getTakenByHistory());
    setOrderCameraOpen(true);
    setError(null);
  }

  function handleOrderCapture({ ticketFile, evidenceFile }) {
    setError(null);
    saveLastTakenBy(meta.taken_by);
    setTakenByHistory(getTakenByHistory());
    enqueue({
      file: evidenceFile,
      ticketFile,
      kind: UPLOAD_MODES.order,
      meta: {
        ...meta,
        has_complaint: false,
      },
    });
    setQueuedMessage('Par en cola. El ticket se lee en segundo plano y solo se guarda la evidencia.');
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
    setMeta(getEmptyMeta());
    setTakenByHistory(getTakenByHistory());
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
      setTakenByHistory(getTakenByHistory());

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
  const photographerReady = Boolean(meta.taken_by.trim());

  return (
    <section className={`uploader${file ? ' uploader--has-file' : ''}`}>
      {orderCameraOpen && (
        <OrderCamera
          takenBy={meta.taken_by}
          onTakenByChange={(name) => updateMeta('taken_by', name)}
          onCapturePair={handleOrderCapture}
          onCancel={closeOrderCamera}
        />
      )}
      <form className="uploader__form" onSubmit={handleSubmit}>
        <PhotographerPicker
          value={meta.taken_by}
          history={takenByHistory}
          onChange={handlePhotographerChange}
          autoFocus={!photographerReady && !orderCameraOpen}
        />

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

        <div className="uploader__workspace">
        <div className="uploader__media">
        <div className="uploader__file-actions">
          {isOrderMode ? (
            <button
              type="button"
              className="uploader__file-btn uploader__mobile-camera uploader__file-btn--camera"
              onClick={openOrderCamera}
            >
              Sacar foto
            </button>
          ) : (
            <label className="uploader__file-label uploader__mobile-camera">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="uploader__file-input"
              />
              <span className="uploader__file-btn uploader__file-btn--camera">Sacar foto</span>
            </label>
          )}

          {isOrderMode && (
            <label className="uploader__file-label uploader__mobile-camera">
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
            <span className="uploader__file-btn uploader__file-btn--secondary uploader__file-btn--pick">
              {isOrderMode ? 'Elegir de galería' : 'Elegir archivo'}
            </span>
          </label>
        </div>

        {!preview && !file && (
          <div className="uploader__preview uploader__preview--empty">
            Elegí un archivo para verlo acá
          </div>
        )}

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
        </div>

        <div className="uploader__fields">

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
              pattern="(?:\d{4,12}|\d{1,4}-\d{4,}|(?:PEYA|RAPPI(?:TURBO)?|MPD?)[A-Z0-9-]{1,28})"
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

        <button
          type="submit"
          className="btn btn--primary btn--large uploader__save"
          disabled={saving || !file || (isOrderMode && !isValidOrderDigits(orderDigits))}
        >
          {saving ? 'Preparando...' : 'Guardar y seguir'}
        </button>
        </div>
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
      </form>
    </section>
  );
}
