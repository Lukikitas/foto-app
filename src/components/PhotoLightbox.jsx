import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../lib/date';
import { getPhotoTimestamp, getPhotoTitle } from '../lib/photos';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_CLICK_SCALE = 2.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function PhotoLightbox({
  photo,
  onClose,
  onDownload,
  badges = null,
}) {
  const stageRef = useRef(null);
  const dragOrigin = useRef(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const timestamp = getPhotoTimestamp(photo);
  const title = getPhotoTitle(photo);
  const isZoomed = scale > 1.01;

  useEffect(() => {
    scaleRef.current = scale;
    offsetRef.current = offset;
  }, [scale, offset]);

  const applyZoom = useCallback((nextScale, anchorX, anchorY) => {
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE);

    if (Math.abs(clamped - currentScale) < 0.001) return;

    if (clamped <= MIN_SCALE) {
      setScale(MIN_SCALE);
      setOffset({ x: 0, y: 0 });
      return;
    }

    const ratio = clamped / currentScale;
    setScale(clamped);
    setOffset({
      x: anchorX - ratio * (anchorX - currentOffset.x),
      y: anchorY - ratio * (anchorY - currentOffset.y),
    });
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback(
    (delta) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      applyZoom(
        scale * (1 + delta),
        rect.width / 2,
        rect.height / 2,
      );
    },
    [applyZoom, scale],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    function handleWheel(event) {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const anchorX = event.clientX - rect.left - rect.width / 2;
      const anchorY = event.clientY - rect.top - rect.height / 2;
      const delta = -event.deltaY * 0.002;
      applyZoom(scaleRef.current * (1 + delta), anchorX, anchorY);
    }

    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [applyZoom]);

  useEffect(() => {
    if (!dragging) return undefined;

    function handleMove(event) {
      if (!dragOrigin.current) return;
      setOffset({
        x: event.clientX - dragOrigin.current.x,
        y: event.clientY - dragOrigin.current.y,
      });
    }

    function handleUp() {
      setDragging(false);
      dragOrigin.current = null;
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  function handleDoubleClick(event) {
    if (isZoomed) {
      resetZoom();
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const anchorX = event.clientX - rect.left - rect.width / 2;
    const anchorY = event.clientY - rect.top - rect.height / 2;
    setScale(DOUBLE_CLICK_SCALE);
    setOffset({
      x: -anchorX * (DOUBLE_CLICK_SCALE - 1),
      y: -anchorY * (DOUBLE_CLICK_SCALE - 1),
    });
  }

  function handleMouseDown(event) {
    if (!isZoomed || event.button !== 0) return;
    event.preventDefault();
    dragOrigin.current = {
      x: event.clientX - offset.x,
      y: event.clientY - offset.y,
    };
    setDragging(true);
  }

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <button
        type="button"
        className="lightbox__close"
        onClick={onClose}
        aria-label="Cerrar"
      >
        ×
      </button>
      <div className="lightbox__content" onClick={(e) => e.stopPropagation()}>
        <div
          ref={stageRef}
          className={`lightbox__stage${isZoomed ? ' lightbox__stage--zoomed' : ''}${dragging ? ' lightbox__stage--dragging' : ''}`}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handleMouseDown}
        >
          <div
            className="lightbox__zoom"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            }}
          >
            <img
              src={photo.public_url}
              alt={title}
              draggable={false}
            />
          </div>
          <div className="lightbox__zoom-controls">
            <button
              type="button"
              className="lightbox__zoom-btn"
              onClick={(e) => {
                e.stopPropagation();
                zoomBy(-0.35);
              }}
              disabled={!isZoomed}
              aria-label="Alejar"
            >
              −
            </button>
            <button
              type="button"
              className="lightbox__zoom-btn lightbox__zoom-btn--label"
              onClick={(e) => {
                e.stopPropagation();
                resetZoom();
              }}
              disabled={!isZoomed}
              aria-label="Restablecer zoom"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              className="lightbox__zoom-btn"
              onClick={(e) => {
                e.stopPropagation();
                zoomBy(0.35);
              }}
              disabled={scale >= MAX_SCALE}
              aria-label="Acercar"
            >
              +
            </button>
          </div>
          <p className="lightbox__zoom-hint">
            Rueda para zoom · Doble clic para ampliar · Arrastrá para mover
          </p>
        </div>
        <div className="lightbox__footer">
          <p className="lightbox__caption">{title}</p>
          <p className="lightbox__date">{formatDateTime(timestamp)}</p>
          {photo.taken_by && (
            <p className="lightbox__meta">Subió: {photo.taken_by}</p>
          )}
          {photo.notes && <p className="lightbox__notes">{photo.notes}</p>}
          {badges && <div className="lightbox__badges">{badges}</div>}
          <div className="lightbox__actions">
            <button type="button" className="btn btn--ghost" onClick={onDownload}>
              Descargar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
