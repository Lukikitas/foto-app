import { useEffect, useRef, useState } from 'react';
import { AGGREGATOR_OPTIONS, detectAggregator } from '../lib/aggregators';
import {
  fetchPhotosByIds,
  fetchUnidentifiedPhotosPage,
  isUnidentifiedOrder,
  isValidOrderDigits,
} from '../lib/photos';
import { suggestUnresolvedOrderCode } from '../lib/unresolvedTicketReview';
import { confirmRecoveredCode } from '../lib/recoverySettings';

const STORE_KEY = 'foto-app-code-recovery-v1';
const PAGE_SIZE = 20;

function readSavedJob() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved?.asOf && Number.isInteger(saved.offset) && Array.isArray(saved.results)) {
      return { ...saved, cursor: saved.cursor || null };
    }
  } catch { /* Ignore an invalid local checkpoint. */ }
  return null;
}

function RecoveryPreview({ url, preview }) {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const [rotation, setRotation] = useState(preview?.rotation ?? 90);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return undefined;
    let active = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      const loaded = new Image();
      loaded.onload = () => { if (active) setImage(loaded); };
      loaded.src = url;
      observer.disconnect();
    });
    observer.observe(canvas);
    return () => { active = false; observer.disconnect(); };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const region = !showFull && preview?.crop
      ? preview.crop
      : { left: 0, top: 0, width: 1, height: 1 };
    const sx = Math.floor(image.naturalWidth * region.left);
    const sy = Math.floor(image.naturalHeight * region.top);
    const sw = Math.max(1, Math.floor(image.naturalWidth * region.width));
    const sh = Math.max(1, Math.floor(image.naturalHeight * region.height));
    const scale = Math.min(300 / sw, 300 / sh);
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    canvas.width = rotation % 180 ? height : width;
    canvas.height = rotation % 180 ? width : height;
    const context = canvas.getContext('2d');
    if (rotation === 90) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
    if (rotation === 180) { context.translate(canvas.width, canvas.height); context.rotate(Math.PI); }
    if (rotation === 270) { context.translate(0, canvas.height); context.rotate(-Math.PI / 2); }
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  }, [image, preview, rotation, showFull]);

  return (
    <div className="code-recovery__preview">
      <a href={url} target="_blank" rel="noreferrer" aria-label="Abrir foto completa para comprobar el código">
        <canvas ref={canvasRef} role="img" aria-label="Recorte girado de la foto del pedido" />
      </a>
      <div>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => setRotation((value) => (value + 90) % 360)}>Girar ↻</button>
        {preview?.crop && (
          <button type="button" className="btn btn--small btn--ghost" onClick={() => setShowFull((value) => !value)}>
            {showFull ? 'Ver recorte' : 'Ver completa'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CodeRecoveryPanel({ onUpdated }) {
  const [job, setJob] = useState(readSavedJob);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const controllerRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  function save(next) {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
    setJob(next);
  }

  async function run() {
    if (running) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError('');
    let current = job?.done
      ? { asOf: new Date().toISOString(), offset: 0, cursor: null, results: job.results, done: false }
      : job;
    if (!current) current = { asOf: new Date().toISOString(), offset: 0, cursor: null, results: [], done: false };
    save(current);
    try {
      while (!controller.signal.aborted) {
        const page = await fetchUnidentifiedPhotosPage({
          cursor: current.cursor,
          limit: PAGE_SIZE,
          asOf: current.asOf,
        });
        if (!page.length) {
          current = { ...current, done: true };
          save(current);
          break;
        }
        for (const photo of page) {
          if (controller.signal.aborted) break;
          if (current.results.some((item) => item.photo.id === photo.id)) {
            current = {
              ...current, offset: current.offset + 1,
              cursor: { created_at: photo.created_at, id: photo.id },
            };
            save(current);
            continue;
          }
          let code = '';
          let preview = null;
          let issue = '';
          try {
            const suggestion = await suggestUnresolvedOrderCode(photo, { signal: controller.signal, withDetails: true });
            code = suggestion?.code || '';
            preview = suggestion?.preview || null;
          } catch (failure) {
            if (controller.signal.aborted) break;
            issue = failure.message || 'No se pudo analizar.';
          }
          if (controller.signal.aborted) break;
          current = {
            ...current,
            offset: current.offset + 1,
            cursor: { created_at: photo.created_at, id: photo.id },
            results: [...current.results, {
              photo: { id: photo.id, public_url: photo.public_url }, code,
              aggregator: detectAggregator(code) || '', preview, issue, selected: Boolean(code),
            }],
          };
          save(current);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (page.length < PAGE_SIZE && !controller.signal.aborted) {
          current = { ...current, done: true };
          save(current);
          break;
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || 'No se pudo continuar el análisis.');
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  }

  function pause() {
    controllerRef.current?.abort();
  }

  function editResult(photoId, patch) {
    save({
      ...job,
      results: job.results.map((result) => result.photo.id === photoId ? { ...result, ...patch } : result),
    });
  }

  async function confirmSelected() {
    const chosen = job.results.filter((item) => item.selected &&
      isValidOrderDigits(item.code) && (item.aggregator || detectAggregator(item.code)));
    if (!chosen.length) return;
    setSaving(true);
    setError('');
    const savedIds = new Set();
    try {
      const fresh = await fetchPhotosByIds(chosen.map((item) => item.photo.id));
      const byId = new Map(fresh.map((photo) => [photo.id, photo]));
      for (const item of chosen) {
        const photo = byId.get(item.photo.id);
        if (!isUnidentifiedOrder(photo)) {
          savedIds.add(item.photo.id);
          continue;
        }
        try {
          const updated = await confirmRecoveredCode(photo.id, photo.name, item.code,
            item.aggregator || detectAggregator(item.code), { source: 'manual-review' });
          savedIds.add(photo.id);
          onUpdated(updated);
        } catch (failure) {
          setError(failure.message || 'Algunas fotos no se pudieron actualizar.');
        }
      }
      save({ ...job, results: job.results.filter((item) => !savedIds.has(item.photo.id)) });
    } catch (failure) {
      setError(failure.message || 'No se pudieron confirmar los códigos.');
    } finally {
      setSaving(false);
    }
  }

  const reviewable = job?.results.filter((item) => item.selected &&
    isValidOrderDigits(item.code) && (item.aggregator || detectAggregator(item.code))).length || 0;

  return (
    <section className="code-recovery" aria-label="Recuperar códigos pendientes">
      <div className="code-recovery__toolbar">
        <strong>Recuperar códigos</strong>
        <span>{job ? `${job.offset} analizadas · ${job.results.filter((item) => item.code).length} propuestas` : 'Pendientes sin analizar'}</span>
        {running ? (
          <button type="button" className="btn btn--small btn--ghost" onClick={pause}>Pausar</button>
        ) : (
          <button type="button" className="btn btn--small btn--primary" onClick={run}>
            {job && !job.done ? 'Reanudar análisis' : 'Analizar pendientes'}
          </button>
        )}
      </div>
      {running && <p role="status">Analizando sin bloquear la pantalla. Al salir de la galería se pausa y después podés reanudar.</p>}
      {error && <p className="message message--error" role="alert">{error}</p>}
      {job?.results.length > 0 && (
        <>
          <div className="code-recovery__results">
            {job.results.map((item) => (
              <div className="code-recovery__result" key={item.photo.id}>
                <RecoveryPreview url={item.photo.public_url} preview={item.preview} />
                <label>
                  <span>{item.code ? 'Código propuesto: comprobalo en la foto' : 'Sin propuesta: podés completarlo manualmente'}</span>
                  <input value={item.code} onChange={(event) => editResult(item.photo.id, {
                    code: event.target.value.toUpperCase(),
                    aggregator: detectAggregator(event.target.value) || item.aggregator || '',
                  })} placeholder="Código del pedido" />
                </label>
                <label>
                  <span>Agregador</span>
                  <select value={item.aggregator || detectAggregator(item.code) || ''}
                    onChange={(event) => editResult(item.photo.id, { aggregator: event.target.value })}>
                    <option value="">Elegir agregador</option>
                    {AGGREGATOR_OPTIONS.map((agg) =>
                      <option key={agg.id} value={agg.id}>{agg.label}</option>)}
                  </select>
                </label>
                <input type="checkbox" checked={item.selected} onChange={(event) => editResult(item.photo.id, { selected: event.target.checked })} aria-label="Seleccionar para confirmar" />
                {item.issue && <small>{item.issue}</small>}
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--primary btn--small" onClick={confirmSelected} disabled={!reviewable || saving || running}>
            {saving ? 'Guardando…' : `Confirmar revisadas (${reviewable})`}
          </button>
        </>
      )}
    </section>
  );
}
