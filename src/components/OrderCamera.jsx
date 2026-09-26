import { useEffect, useRef, useState } from 'react';
import { setTrackTorch, trackSupportsTorch } from '../lib/cameraFlash';
import { getCameraFlash, getTakenByHistory, saveCameraFlash, saveLastTakenBy } from '../lib/storage';
import { subscribe } from '../lib/uploadQueue';
import { inspectCaptureCanvas, isSameCapturedScene } from '../lib/imageQuality';
import PhotographerPicker from './PhotographerPicker';

const STEPS = {
  ticket: 'ticket',
  evidence: 'evidence',
};

function drawFrame(video, canvas, maxWidth = 2560, zoom = 1) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(1, maxWidth / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const cropWidth = sourceWidth / zoom;
  const cropHeight = sourceHeight / zoom;
  context.drawImage(
    video,
    (sourceWidth - cropWidth) / 2,
    (sourceHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    width,
    height,
  );
}

function waitForVideo(video) {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('La cámara no devolvió imagen.'));
    }, 8000);

    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('loadedmetadata', onReady);
    };

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('loadedmetadata', onReady);
    onReady();
  });
}

function canvasToFile(canvas, name, type, quality) {
  return new Promise((resolve, reject) => {
    const args = type === 'image/jpeg' ? [type, quality] : [type];
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo preparar la foto.'));
          return;
        }
        resolve(
          new File([blob], name, {
            type,
            lastModified: Date.now(),
          }),
        );
      },
      ...args,
    );
  });
}

async function captureFrameOrPhoto(video, track, name, zoom = 1, softwareZoom = false, ticket = false) {
  if (!video?.videoWidth || !video?.videoHeight) {
    throw new Error('La cámara todavía no está lista.');
  }

  // Freeze the video frame at the shutter as a fast fallback; supported phones
  // can supply a full still image with their own camera autofocus and processing.
  const fallback = document.createElement('canvas');
  drawFrame(video, fallback, 2560, softwareZoom ? zoom : 1);

  const quality = inspectCaptureCanvas(fallback, { ticket });
  let upgrade = Promise.resolve(null);
  if (!softwareZoom && typeof ImageCapture === 'function' && track?.readyState === 'live') {
    upgrade = (async () => {
      try {
      const capture = new ImageCapture(track);
      const blob = await Promise.race([
        capture.takePhoto(),
        new Promise((_, reject) =>
          window.setTimeout(() => reject(new Error('Timeout de foto')), 1200)
        ),
      ]);
      if (blob?.size && blob.type?.startsWith('image/')) {
        const extension = blob.type === 'image/png' ? 'png' : 'jpg';
        const still = new File([blob], name.replace(/\.jpg$/, `.${extension}`), {
          type: blob.type,
          lastModified: Date.now(),
        });
        const bitmap = await createImageBitmap(still);
        try {
          if (!isSameCapturedScene(fallback, bitmap)) return null;
          const stillQuality = inspectCaptureCanvas(bitmap, { ticket });
          if (stillQuality.issue === 'blurry' && quality.issue !== 'blurry') return null;
          if (stillQuality.sharpness < quality.sharpness * 0.8) return null;
          return still;
        } finally {
          bitmap.close();
        }
      }
      } catch { /* The frozen frame remains available on unsupported devices. */ }
      return null;
    })();
  }

  const file = await canvasToFile(fallback, name, 'image/jpeg', 0.95);
  return { file, quality, upgrade };
}

function makeTicketPhoto(video, track, name, zoom, softwareZoom) {
  return captureFrameOrPhoto(video, track, name, zoom, softwareZoom, true);
}

function makeEvidencePhoto(video, track, name, zoom, softwareZoom) {
  return captureFrameOrPhoto(video, track, name, zoom, softwareZoom, false);
}

function getLiveTrack(stream) {
  return stream?.getVideoTracks?.()[0] || null;
}

function getHardwareZoomRange(track) {
  const range = track?.getCapabilities?.().zoom;
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= 1) {
    return null;
  }
  return { min: range.min, max: Math.min(range.max, Math.max(4, range.min)), step: range.step };
}

function nextHardwareZoom(current, direction, range) {
  const step = Number.isFinite(range.step) && range.step > 0 ? range.step : 0;
  const desired = current + direction * Math.max(0.5, step);
  const snapped = step
    ? range.min + Math.round((desired - range.min) / step) * step
    : desired;
  return Math.max(1, range.min, Math.min(range.max, Number(snapped.toFixed(2))));
}

export default function OrderCamera({ takenBy, onTakenByChange, onCapturePair, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const ticketFileRef = useRef(null);
  const ticketUpgradeRef = useRef(null);
  const pendingPairRef = useRef(null);
  const flashOnRef = useRef(getCameraFlash());
  const [status, setStatus] = useState('starting');
  const [step, setStep] = useState(STEPS.ticket);
  const [error, setError] = useState(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [queuedPairs, setQueuedPairs] = useState(0);
  const [pendingTasks, setPendingTasks] = useState(0);
  const [flashOn, setFlashOn] = useState(getCameraFlash);
  const [flashSupported, setFlashSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(3);
  const [hardwareZoom, setHardwareZoom] = useState(false);
  const [zoomBusy, setZoomBusy] = useState(false);
  const [qualityNotice, setQualityNotice] = useState(null);
  const [takenByHistory, setTakenByHistory] = useState(getTakenByHistory);
  const [whoOpen, setWhoOpen] = useState(() => !takenBy?.trim());

  useEffect(() => {
    flashOnRef.current = flashOn;
  }, [flashOn]);

  useEffect(() => {
    let active = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    async function applyFlash(track) {
      const supported = trackSupportsTorch(track);
      if (!active) return;
      setFlashSupported(supported);
      if (supported) {
        await setTrackTorch(track, flashOnRef.current);
      }
    }

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Este dispositivo no permite usar la cámara desde la app.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 2560 },
            height: { ideal: 1920 },
          },
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await waitForVideo(videoRef.current);
        if (!active) return;
        const track = getLiveTrack(stream);
        const zoomRange = getHardwareZoomRange(track);
        if (zoomRange) {
          try {
            await track.applyConstraints({ advanced: [{ zoom: Math.max(1, zoomRange.min) }] });
            if (!active) return;
            setHardwareZoom(true);
            setMinZoom(Math.max(1, zoomRange.min));
            setMaxZoom(zoomRange.max);
            setZoom(track.getSettings?.().zoom ?? 1);
          } catch {
            // Some browsers report zoom support but reject zoom constraints.
          }
        }
        setStatus('ready');
        await applyFlash(track);
      } catch (startError) {
        if (active) {
          setError(startError.message || 'No se pudo abrir la cámara.');
          setStatus('error');
        }
      }
    }

    startCamera();

    const torchRetry = window.setTimeout(() => {
      if (!active) return;
      applyFlash(getLiveTrack(streamRef.current));
    }, 700);

    const unsubscribe = subscribe((items) => {
      setPendingTasks(
        items.filter((item) =>
          item.status === 'pending' || item.status === 'analyzing' || item.status === 'uploading'
        ).length,
      );
    });

    return () => {
      active = false;
      window.clearTimeout(torchRetry);
      unsubscribe();
      document.body.style.overflow = previousOverflow;
      const track = getLiveTrack(streamRef.current);
      if (track && flashOnRef.current) {
        setTrackTorch(track, false);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      flushPendingPair(false);
      ticketFileRef.current = null;
    };
  }, []);

  function resetToTicket() {
    ticketFileRef.current = null;
    ticketUpgradeRef.current = null;
    setStep(STEPS.ticket);
    setTakingPhoto(false);
    setQualityNotice(null);
  }

  function handleCancel() {
    flushPendingPair();
    ticketFileRef.current = null;
    onCancel();
  }

  function handlePhotographerChange(name, meta) {
    onTakenByChange(name);
    if (meta?.selected && name.trim()) {
      saveLastTakenBy(name);
      setTakenByHistory(getTakenByHistory());
      setWhoOpen(false);
    }
    if (name.trim()) setError(null);
  }

  async function handleFlashToggle() {
    if (status !== 'ready') return;

    const track = getLiveTrack(streamRef.current);
    const supported = trackSupportsTorch(track);
    setFlashSupported(supported);
    if (!supported || !track) {
      setError('Este celular no deja usar el flash desde la app.');
      return;
    }

    const next = !flashOn;
    const applied = await setTrackTorch(track, next);
    if (!applied) {
      setFlashSupported(false);
      setError('Este celular no deja usar el flash desde la app.');
      return;
    }

    setFlashOn(next);
    flashOnRef.current = next;
    saveCameraFlash(next);
    setError(null);
  }

  async function handleZoom(direction) {
    if (status !== 'ready' || zoomBusy || takingPhoto) return;

    const track = getLiveTrack(streamRef.current);
    const range = hardwareZoom ? getHardwareZoomRange(track) : null;
    const next = range
      ? nextHardwareZoom(zoom, direction, range)
      : Math.max(1, Math.min(maxZoom, Math.round((zoom + direction * 0.5) * 10) / 10));
    if (next === zoom) return;

    if (hardwareZoom) {
      setZoomBusy(true);
      try {
        await track.applyConstraints({ advanced: [{ zoom: next }] });
        setZoom(track.getSettings?.().zoom ?? next);
        setError(null);
      } catch {
        setError('No se pudo ajustar el zoom de esta cámara.');
      } finally {
        setZoomBusy(false);
      }
    } else {
      setZoom(next);
    }
  }

  async function resetZoom() {
    if (zoom <= 1) return;
    const track = getLiveTrack(streamRef.current);
    setZoomBusy(true);
    if (hardwareZoom && track?.readyState === 'live') {
      try {
        await track.applyConstraints({ advanced: [{ zoom: minZoom }] });
      } catch { /* Keep the camera usable when a device rejects the reset. */ }
    }
    setZoom(hardwareZoom ? (track?.getSettings?.().zoom ?? minZoom) : 1);
    setZoomBusy(false);
  }

  function commitPair({ ticketFile, ticketUpgrade, evidenceFile, evidenceUpgrade }) {
    void Promise.all([ticketUpgrade || null, evidenceUpgrade || null])
      .then(([betterTicket, betterEvidence]) => onCapturePair({
        ticketFile: betterTicket || ticketFile,
        evidenceFile: betterEvidence || evidenceFile,
      }))
      .then(() => setQueuedPairs((count) => count + 1))
      .catch((captureError) => setError(captureError.message || 'No se pudo guardar el par. Revisá la cola.'));
  }

  function flushPendingPair(updateNotice = true) {
    const pending = pendingPairRef.current;
    if (!pending) return;
    pendingPairRef.current = null;
    window.clearTimeout(pending.timer);
    pending.commit();
    if (updateNotice) setQualityNotice(null);
  }

  function repeatLastEvidence() {
    const pending = pendingPairRef.current;
    if (!pending || step !== STEPS.ticket || takingPhoto) return;
    window.clearTimeout(pending.timer);
    pendingPairRef.current = null;
    ticketFileRef.current = pending.pair.ticketFile;
    ticketUpgradeRef.current = pending.pair.ticketUpgrade;
    setStep(STEPS.evidence);
    setQualityNotice(null);
  }

  async function handleCapture() {
    if (status !== 'ready' || takingPhoto || zoomBusy) return;

    if (!takenBy?.trim()) {
      setWhoOpen(true);
      setError('Poné quién está sacando la foto.');
      return;
    }

    setWhoOpen(false);
    if (step === STEPS.ticket) flushPendingPair();
    setTakingPhoto(true);
    try {
      if (!videoRef.current?.videoWidth) {
        throw new Error('La cámara todavía no está lista.');
      }

      saveLastTakenBy(takenBy);
      setTakenByHistory(getTakenByHistory());
      if (navigator.vibrate) navigator.vibrate(25);

      if (step === STEPS.ticket) {
        const shot = await makeTicketPhoto(
          videoRef.current,
          getLiveTrack(streamRef.current),
          `ticket-${Date.now()}.jpg`,
          zoom,
          !hardwareZoom && zoom > 1,
        );
        ticketFileRef.current = shot.file;
        ticketUpgradeRef.current = shot.upgrade;
        if (navigator.vibrate) navigator.vibrate(35);
        setStep(STEPS.evidence);
        setQualityNotice(shot.quality.issue ? { issue: shot.quality.issue, step: STEPS.ticket } : null);
        void resetZoom();
        setError(null);
        setTakingPhoto(false);
        return;
      }

      const shot = await makeEvidencePhoto(
        videoRef.current,
        getLiveTrack(streamRef.current),
        `evidencia-${Date.now()}.jpg`,
        zoom,
        !hardwareZoom && zoom > 1,
      );
      const ticketFile = ticketFileRef.current;
      const ticketUpgrade = ticketUpgradeRef.current;
      ticketFileRef.current = null;
      ticketUpgradeRef.current = null;
      if (!ticketFile) {
        throw new Error('Falta la foto del ticket. Volvé a empezar el par.');
      }

      const pair = { ticketFile, ticketUpgrade, evidenceFile: shot.file, evidenceUpgrade: shot.upgrade };
      if (shot.quality.issue) {
        const pending = { pair, timer: null, commit: () => commitPair(pair) };
        pending.timer = window.setTimeout(() => {
          if (pendingPairRef.current === pending) flushPendingPair();
        }, 5000);
        pendingPairRef.current = pending;
        setQualityNotice({ issue: shot.quality.issue, step: STEPS.evidence });
      } else {
        commitPair(pair);
        setQualityNotice(null);
      }
      if (navigator.vibrate) navigator.vibrate([35, 50, 45]);
      setError(null);
      setStep(STEPS.ticket);
      setTakingPhoto(false);
      void resetZoom();
    } catch (captureError) {
      setError(captureError.message || 'No se pudo tomar la foto.');
      if (step === STEPS.evidence && !ticketFileRef.current) {
        setStep(STEPS.ticket);
      }
      setTakingPhoto(false);
    }
  }

  const isTicketStep = step === STEPS.ticket;
  const photographerReady = Boolean(takenBy?.trim());
  const stepLabel = isTicketStep ? '1 de 2 · Ticket' : '2 de 2 · Pedido';
  const guideText = isTicketStep
    ? 'CÓDIGO: dentro del recuadro, enfocado y con buena luz'
    : 'Bolsa, contenido y ticket a la vista';
  const captureLabel = takingPhoto
    ? 'Tomando foto…'
    : isTicketStep
      ? 'Sacar foto del ticket'
      : 'Sacar foto del pedido';
  const canCapture = status === 'ready' && !takingPhoto && !zoomBusy && photographerReady;
  const qualityMessage = {
    dark: 'La foto salió oscura.',
    blurry: 'La foto podría estar movida.',
    cropped: 'El ticket parece cortado.',
  }[qualityNotice?.issue];

  return (
    <section className={`order-camera${whoOpen ? ' order-camera--who-open' : ''}`} aria-label="Cámara rápida de pedidos">
      <div className="order-camera__viewport">
        <video
          ref={videoRef}
          className="order-camera__video"
          style={!hardwareZoom && zoom > 1 ? { transform: `scale(${zoom})` } : undefined}
          autoPlay
          muted
          playsInline
        />
        <div
          className={`order-camera__guide order-camera__guide--${step}`}
          aria-hidden="true"
        >
          {isTicketStep && <span className="order-camera__guide-focus" />}
          <span>{guideText}</span>
        </div>
      </div>

      <header className="order-camera__top">
        <button
          type="button"
          className="order-camera__icon-btn"
          onClick={handleCancel}
          aria-label="Cerrar cámara"
        >
          ✕
        </button>
        <p
          className={`order-camera__status order-camera__status--${status}`}
          role="status"
          aria-live="polite"
        >
          {status === 'starting' && 'Preparando cámara…'}
          {status === 'error' && 'No se pudo abrir la cámara.'}
          {status === 'ready' && !photographerReady && 'Poné tu nombre'}
          {status === 'ready' && photographerReady && stepLabel}
        </p>
      </header>

      <div className="order-camera__who">
        {photographerReady && !whoOpen ? (
          <button
            type="button"
            className="order-camera__who-toggle"
            onClick={() => setWhoOpen(true)}
          >
            Saca la foto: <strong>{takenBy.trim()}</strong>
          </button>
        ) : (
          <PhotographerPicker
            value={takenBy}
            history={takenByHistory}
            onChange={handlePhotographerChange}
            compact
            autoFocus={!photographerReady}
          />
        )}
      </div>

      {(queuedPairs > 0 || pendingTasks > 0) && (
        <p className="order-camera__summary" role="status" aria-live="polite">
          {queuedPairs > 0 && (
            <>
              {queuedPairs} {queuedPairs === 1 ? 'par tomado' : 'pares tomados'}
            </>
          )}
          {pendingTasks > 0 && (
            <>
              {queuedPairs > 0 ? ' · ' : ''}
              {pendingTasks} {pendingTasks === 1 ? 'par pendiente' : 'pares pendientes'}
            </>
          )}
        </p>
      )}
      {error && <p className="message message--error">{error}</p>}
      {qualityMessage && (
        <div className="order-camera__quality" role="status">
          <span>{qualityMessage}</span>
          {qualityNotice.step === STEPS.evidence && pendingPairRef.current && step === STEPS.ticket && (
            <button type="button" onClick={repeatLastEvidence}>Repetir última foto</button>
          )}
          {qualityNotice.step === STEPS.ticket && step === STEPS.evidence && (
            <button type="button" onClick={resetToTicket}>Repetir última foto</button>
          )}
        </div>
      )}

      <div className="order-camera__actions">
        <div className="order-camera__zoom" aria-label="Zoom de cámara">
          <button type="button" onClick={() => handleZoom(-1)} disabled={status !== 'ready' || zoomBusy || takingPhoto || zoom <= minZoom} aria-label="Disminuir zoom">−</button>
          <output aria-live="polite">{Number(zoom.toFixed(1))}×</output>
          <button type="button" onClick={() => handleZoom(1)} disabled={status !== 'ready' || zoomBusy || takingPhoto || zoom >= maxZoom} aria-label="Aumentar zoom">+</button>
        </div>
        {step === STEPS.evidence && (
          <div className="order-camera__shutter-side">
            <button type="button" className="btn btn--ghost order-camera__repeat" onClick={resetToTicket}>
              Repetir ticket
            </button>
          </div>
        )}
        <div className="order-camera__shutter-row">
          <button
            type="button"
            className="order-camera__shutter"
            disabled={!canCapture}
            onClick={handleCapture}
            aria-label={captureLabel}
          >
            <span className="order-camera__shutter-ring" />
            <span className="order-camera__shutter-core" />
          </button>
          <button
            type="button"
            className={`order-camera__flash${flashOn ? ' order-camera__flash--on' : ''}`}
            onClick={handleFlashToggle}
            disabled={status !== 'ready'}
            aria-pressed={flashOn}
            aria-label={flashOn ? 'Apagar flash' : 'Prender flash'}
            title={status === 'ready' && !flashSupported ? 'Flash no disponible en este celular' : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 2h10l-3 8h6L7 22l3.5-9H7L7 2z" />
            </svg>
            <span>{flashOn ? 'On' : 'Off'}</span>
          </button>
        </div>
        <p className="order-camera__shutter-label">
          {takingPhoto ? 'Mantené el celular quieto hasta la confirmación' : captureLabel}
        </p>
      </div>
    </section>
  );
}
