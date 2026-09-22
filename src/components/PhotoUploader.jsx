import { useRef, useState } from 'react';
import OrderCamera from './OrderCamera';
import PhotographerPicker from './PhotographerPicker';
import { isValidOrderDigits } from '../lib/photos';
import { getLastTakenBy, getTakenByHistory, saveLastTakenBy } from '../lib/storage';
import { enqueue } from '../lib/uploadQueue';

function getEmptyMeta() {
  return {
    notes: '',
    taken_by: getLastTakenBy(),
    is_refutado: false,
  };
}

export default function PhotoUploader() {
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [orderDigits, setOrderDigits] = useState('');
  const [detectedOrder, setDetectedOrder] = useState(null);
  const [showManualOrder, setShowManualOrder] = useState(false);
  const [orderCameraOpen, setOrderCameraOpen] = useState(false);
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

    if (!selected.type.startsWith('image/')) {
      setError('Para pedidos solo se permiten fotos/imágenes.');
      return;
    }

    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(selected);
    });
    setFile(selected);
    setDetectedOrder(null);
    setShowManualOrder(true);
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

  async function handleOrderCapture({ ticketFile, evidenceFile }) {
    setError(null);
    saveLastTakenBy(meta.taken_by);
    setTakenByHistory(getTakenByHistory());
    await enqueue({
      file: evidenceFile,
      ticketFile,
      kind: 'order',
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
    setMeta(getEmptyMeta());
    setTakenByHistory(getTakenByHistory());
    clearInputs();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setQueuedMessage(null);

    if (!file) {
      setError('Sacá o elegí una foto primero.');
      return;
    }

    if (!isValidOrderDigits(orderDigits)) {
      setError('Ingresá el código completo o los últimos 4 dígitos del pedido.');
      return;
    }

    setSaving(true);
    try {
      saveLastTakenBy(meta.taken_by);
      setTakenByHistory(getTakenByHistory());

      await enqueue({
        file,
        kind: 'order',
        orderDigits,
        title: orderDigits,
        aggregator: 'sin_agregador',
        meta: {
          ...meta,
          has_complaint: false,
          is_refutado: meta.is_refutado,
        },
      });

      setQueuedMessage(`Pedido #${orderDigits} en cola. Podés seguir sacando fotos.`);
      resetForm();
    } catch (err) {
      if (err.queueId) resetForm();
      setError(err.message || 'Error al preparar el pedido.');
    } finally {
      setSaving(false);
    }
  }

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
        {/* Selector de Fotógrafo */}
        <div className="uploader__photographer-card">
          <PhotographerPicker
            value={meta.taken_by}
            history={takenByHistory}
            onChange={handlePhotographerChange}
            autoFocus={!photographerReady && !orderCameraOpen}
          />
        </div>

        {/* Notificaciones y Mensajes de Estado */}
        {error && (
          <p className="message message--error uploader__message" role="alert">
            <span aria-hidden="true">⚠️</span> {error}
          </p>
        )}
        {queuedMessage && (
          <p className="message message--success uploader__message" role="status">
            <span aria-hidden="true">✓</span> {queuedMessage}
          </p>
        )}

        {/* ZONA DE CAPTURA RÁPIDA (Cuando no hay foto seleccionada) */}
        {!file && (
          <div className="uploader__capture-card">
            <button
              type="button"
              className="uploader__hero-camera-btn"
              onClick={openOrderCamera}
              title={photographerReady ? 'Abrir cámara de pedidos' : 'Elegí tu nombre primero'}
            >
              <div className="uploader__hero-icon-ring">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
              </div>
              <div className="uploader__hero-text">
                <strong>SACAR FOTO</strong>
                <span>Cámara rápida · 1. Ticket + 2. Bolsa</span>
              </div>
            </button>

            {/* Accesos rápidos secundarios (Cámara del cel / Galería) */}
            <div className="uploader__quick-row">
              <label className="uploader__quick-btn">
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="uploader__file-input"
                />
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                  <circle cx="12" cy="18" r="1"></circle>
                  <circle cx="12" cy="8" r="2.5"></circle>
                </svg>
                <span>Cámara directa</span>
              </label>

              <label className="uploader__quick-btn">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="uploader__file-input"
                />
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span>Elegir de galería</span>
              </label>
            </div>

            <p className="uploader__ocr-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              El código del pedido se lee automáticamente por OCR del ticket en segundo plano.
            </p>
          </div>
        )}

        {/* ZONA DE REVISIÓN Y GUARDADO (Cuando ya se tomó o eligió una foto) */}
        {file && (
          <div className="uploader__review-card">
            <div className="uploader__preview-header">
              <span className="uploader__preview-badge">✓ Foto seleccionada</span>
              <button
                type="button"
                className="btn btn--ghost btn--small uploader__change-photo"
                onClick={resetForm}
              >
                ✕ Descartar foto
              </button>
            </div>

            {preview && (
              <div className="uploader__preview-wrap">
                <img src={preview} alt="Vista previa del pedido" className="uploader__preview-img" />
              </div>
            )}

            <div className="uploader__fields-panel">
              {detectedOrder && !showManualOrder && (
                <div className="uploader__detected-order" role="status">
                  <span>
                    Código detectado: <strong>{detectedOrder.displayCode}</strong>
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

              {(!detectedOrder || showManualOrder) && (
                <label className="uploader__name-label">
                  <span>Código del pedido</span>
                  <input
                    type="text"
                    pattern="(?:\d{4,12}|\d{1,4}-\d{4,}|(?:PEYA|RAPPI(?:TURBO)?|MPD?)[A-Z0-9-]{1,28})"
                    value={orderDigits}
                    onChange={handleDigitsChange}
                    placeholder="Ej: PEYA12345 o 4696"
                    maxLength={32}
                    className="uploader__digits-input"
                    autoComplete="off"
                    autoFocus
                  />
                  <small className="uploader__input-hint">Últimos 4 dígitos o código completo de la app</small>
                </label>
              )}

              <label className="uploader__name-label">
                <span>Anotaciones (opcional)</span>
                <textarea
                  value={meta.notes}
                  onChange={(e) => updateMeta('notes', e.target.value)}
                  placeholder="Detalles, aclaraciones sobre el pedido..."
                  maxLength={500}
                  rows={2}
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
                  <span>Marcar como evidencia de refutado</span>
                </label>
              </div>

              <button
                type="submit"
                className="btn btn--primary btn--large uploader__save"
                disabled={saving || !isValidOrderDigits(orderDigits)}
              >
                {saving ? 'Guardando pedido...' : '✓ Guardar pedido y seguir'}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
