import { useEffect, useRef, useState } from 'react';
import { setTrackTorch, trackSupportsTorch } from '../lib/cameraFlash';
import { getCameraFlash, getTakenByHistory, saveCameraFlash, saveLastTakenBy } from '../lib/storage';
import { subscribe } from '../lib/uploadQueue';
import PhotographerPicker from './PhotographerPicker';

const STEPS = {
  ticket: 'ticket',
  evidence: 'evidence',
};

function drawFrame(video, canvas, maxWidth = 2560) {
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
  context.drawImage(video, 0, 0, width, height);
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

function makePhoto(video, name) {
  if (!video?.videoWidth || !video?.videoHeight) {
    return Promise.reject(new Error('La cámara todavía no está lista.'));
  }

  const canvas = document.createElement('canvas');
  drawFrame(video, canvas);
  return canvasToFile(canvas, name, 'image/jpeg', 0.95);
}

async function makeEvidencePhoto(video, track, name) {
  if (!video?.videoWidth || !video?.videoHeight) {
    throw new Error('La cámara todavía no está lista.');
  }

  // Freeze the video frame at the shutter as a fast fallback; supported phones
  // can supply a full still image with their own camera processing.
  const fallback = document.createElement('canvas');
  drawFrame(video, fallback);
  if (typeof ImageCapture === 'function' && track?.readyState === 'live') {
    try {
      const capture = new ImageCapture(track);
      const blob = await Promise.race([
        capture.takePhoto(),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('La foto tardó demasiado.')), 1500)),
      ]);
      if (blob?.size && blob.type?.startsWith('image/')) {
        const extension = blob.type === 'image/png' ? 'png' : 'jpg';
        return new File([blob], name.replace(/\.jpg$/, `.${extension}`), {
          type: blob.type,
          lastModified: Date.now(),
        });
      }
    } catch {
      // A video frame still keeps the two-photo flow working on unsupported devices.
    }
  }
  return canvasToFile(fallback, name, 'image/jpeg', 0.95);
}

function getLiveTrack(stream) {
  return stream?.getVideoTracks?.()[0] || null;
}

export default function OrderCamera({ takenBy, onTakenByChange, onCapturePair, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const ticketFileRef = useRef(null);
  const flashOnRef = useRef(getCameraFlash());
  const [status, setStatus] = useState('starting');
  const [step, setStep] = useState(STEPS.ticket);
  const [error, setError] = useState(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [queuedPairs, setQueuedPairs] = useState(0);
  const [pendingTasks, setPendingTasks] = useState(0);
  const [flashOn, setFlashOn] = useState(getCameraFlash);
  const [flashSupported, setFlashSupported] = useState(false);
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
        setStatus('ready');
        await applyFlash(getLiveTrack(stream));
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
      ticketFileRef.current = null;
    };
  }, []);

  function resetToTicket() {
    ticketFileRef.current = null;
    setStep(STEPS.ticket);
    setTakingPhoto(false);
  }

  function handleCancel() {
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

  async function handleCapture() {
    if (status !== 'ready' || takingPhoto) return;

    if (!takenBy?.trim()) {
      setWhoOpen(true);
      setError('Poné quién está sacando la foto.');
      return;
    }

    setWhoOpen(false);
    setTakingPhoto(true);
    try {
      if (!videoRef.current?.videoWidth) {
        throw new Error('La cámara todavía no está lista.');
      }

      saveLastTakenBy(takenBy);
      setTakenByHistory(getTakenByHistory());
      if (navigator.vibrate) navigator.vibrate(25);

      if (step === STEPS.ticket) {
        ticketFileRef.current = await makePhoto(videoRef.current, `ticket-${Date.now()}.jpg`);
        setStep(STEPS.evidence);
        setError(null);
        setTakingPhoto(false);
        return;
      }

      const evidenceFile = await makeEvidencePhoto(
        videoRef.current,
        getLiveTrack(streamRef.current),
        `evidencia-${Date.now()}.jpg`,
      );
      const ticketFile = ticketFileRef.current;
      ticketFileRef.current = null;
      if (!ticketFile) {
        throw new Error('Falta la foto del ticket. Volvé a empezar el par.');
      }

      await onCapturePair({ ticketFile, evidenceFile });
      setQueuedPairs((count) => count + 1);
      setError(null);
      setStep(STEPS.ticket);
      setTakingPhoto(false);
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
    ? 'Acercá la parte de arriba del ticket, donde dice CODIGO:'
    : 'Bolsa, contenido y ticket a la vista';
  const captureLabel = takingPhoto
    ? 'Tomando foto…'
    : isTicketStep
      ? 'Sacar foto del ticket'
      : 'Sacar foto del pedido';
  const canCapture = status === 'ready' && !takingPhoto && photographerReady;

  return (
    <section className={`order-camera${whoOpen ? ' order-camera--who-open' : ''}`} aria-label="Cámara rápida de pedidos">
      <div className="order-camera__viewport">
        <video ref={videoRef} className="order-camera__video" autoPlay muted playsInline />
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

      <div className="order-camera__actions">
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
        <p className="order-camera__shutter-label">{captureLabel}</p>
      </div>
    </section>
  );
}
