import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../lib/date';
import { getPhotoTimestamp, getPhotoTitle } from '../lib/photos';
import { clamp, clampOffset, pinchDistance, zoomAt } from '../lib/touchZoom';

export default function PhotoLightbox(props) {
  return <PhotoViewer key={props.photo.id || props.photo.public_url} {...props} />;
}
function PhotoViewer({ photo, onClose, onDownload, badges = null, actions = null }) {
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const closeRef = useRef(null);
  const points = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(null);
  const lastTouch = useRef(0);
  const moved = useRef(false);
  const state = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  const [view, setView] = useState({ scale: 1, offset: { x: 0, y: 0 } });
  const title = getPhotoTitle(photo);
  const commit = useCallback((scale, offset) => {
    const stage = stageRef.current;
    const img = imageRef.current;
    if (!stage || !img) return;
    const next = clamp(scale, 1, 4);
    const value = { scale: next, offset: next === 1 ? { x: 0, y: 0 } : clampOffset(offset, next,
      { width: img.clientWidth, height: img.clientHeight },
      { width: stage.clientWidth, height: stage.clientHeight }) };
    state.current = value;
    setView(value);
  }, []);
  const zoom = useCallback((next, anchor = { x: 0, y: 0 }) => {
    const current = state.current;
    const scale = clamp(next, 1, 4);
    commit(scale, zoomAt(current.offset, current.scale, scale, anchor));
  }, [commit]);
  const local = (event) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };
  const startGesture = () => {
    const values = [...points.current.values()];
    if (values.length === 2) {
      gesture.current = { ...state.current, distance: pinchDistance(points.current),
        anchor: { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2 } };
    } else if (values.length === 1) gesture.current = { ...state.current, anchor: values[0] };
    else gesture.current = null;
  };
  function down(event) {
    if (event.target.closest('button') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    points.current.set(event.pointerId, local(event));
    moved.current = points.current.size > 1;
    if (moved.current) lastTap.current = null;
    startGesture();
  }
  function move(event) {
    if (!points.current.has(event.pointerId)) return;
    const point = local(event);
    points.current.set(event.pointerId, point);
    const base = gesture.current;
    if (!base) return;
    if (points.current.size === 2 && base.distance > 0) {
      moved.current = true;
      const [a, b] = [...points.current.values()];
      const scale = clamp(base.scale * pinchDistance(points.current) / base.distance, 1, 4);
      const offset = zoomAt(base.offset, base.scale, scale, base.anchor);
      commit(scale, { x: offset.x + (a.x + b.x) / 2 - base.anchor.x,
        y: offset.y + (a.y + b.y) / 2 - base.anchor.y });
    } else if (points.current.size === 1) {
      const dx = point.x - base.anchor.x; const dy = point.y - base.anchor.y;
      if (Math.hypot(dx, dy) > 8) moved.current = true;
      if (base.scale > 1) commit(base.scale, { x: base.offset.x + dx, y: base.offset.y + dy });
    }
  }
  function up(event) {
    if (!points.current.has(event.pointerId)) return;
    if (event.type === 'pointerup' && !moved.current && event.pointerType !== 'mouse') {
      const point = local(event); const now = Date.now();
      lastTouch.current = now;
      if (lastTap.current && now - lastTap.current.time < 300 && Math.hypot(point.x-lastTap.current.x, point.y-lastTap.current.y) < 30) {
        zoom(state.current.scale > 1 ? 1 : 2.5, point); lastTap.current = null;
      } else lastTap.current = { ...point, time: now };
    }
    points.current.delete(event.pointerId);
    startGesture();
  }
  useEffect(() => {
    const stage = stageRef.current;
    function wheel(event) {
      if (event.target.closest('button')) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoom(state.current.scale * Math.exp(-event.deltaY * 0.002),
        { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
    }
    stage.addEventListener('wheel', wheel, { passive: false });
    const resize = new ResizeObserver(() => commit(state.current.scale, state.current.offset));
    resize.observe(stage);
    return () => { stage.removeEventListener('wheel', wheel); resize.disconnect(); };
  }, [zoom, commit]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeRef.current?.focus();
    function key(event) {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const buttons = [...closeRef.current.closest('.lightbox').querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    }
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', key); opener?.focus?.(); };
  }, []);
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label={title}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button ref={closeRef} type="button" className="lightbox__close" onClick={onClose} aria-label="Cerrar">×</button>
    <div className="lightbox__content">
      <div ref={stageRef} className={`lightbox__stage${view.scale > 1 ? ' lightbox__stage--zoomed' : ''}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
        onDoubleClick={(event) => { if (Date.now() - lastTouch.current > 500 && !event.target.closest('button')) zoom(state.current.scale > 1 ? 1 : 2.5, local(event)); }}>
        <div className="lightbox__zoom" style={{ transform: `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})` }}>
          <img ref={imageRef} src={photo.public_url} alt={title} draggable={false} onLoad={() => commit(1, { x: 0, y: 0 })} />
        </div>
        <div className="lightbox__zoom-controls">
          <button type="button" className="lightbox__zoom-btn" onClick={() => zoom(view.scale / 1.35)} disabled={view.scale === 1} aria-label="Alejar">−</button>
          <button type="button" className="lightbox__zoom-btn lightbox__zoom-btn--label" onClick={() => zoom(1)} aria-label="Restablecer zoom">{Math.round(view.scale * 100)}%</button>
          <button type="button" className="lightbox__zoom-btn" onClick={() => zoom(view.scale * 1.35)} disabled={view.scale === 4} aria-label="Acercar">+</button>
        </div>
        <p className="lightbox__zoom-hint">Pellizcá para ampliar · Arrastrá para mover · Doble toque para ampliar o restablecer</p>
      </div>
      <div className="lightbox__footer"><p className="lightbox__caption">{title}</p>
        <p className="lightbox__date">{formatDateTime(getPhotoTimestamp(photo))}</p>
        {photo.taken_by && <p className="lightbox__meta">Subió: {photo.taken_by}</p>}
        {photo.notes && <p className="lightbox__notes">{photo.notes}</p>}
        {badges && <div className="lightbox__badges">{badges}</div>}
        {(actions || onDownload) && (
          <div className="lightbox__actions">
            {actions}
            {onDownload && <button type="button" className="btn btn--ghost" onClick={onDownload}>Descargar</button>}
          </div>
        )}
      </div>
    </div>
  </div>;
}
