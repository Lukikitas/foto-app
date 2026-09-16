import { useEffect, useRef, useState } from 'react';
import { subscribe } from '../lib/uploadQueue';

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

export default function OrderCamera({ onCapturePair, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const ticketFileRef = useRef(null);
  const [status, setStatus] = useState('starting');
  const [step, setStep] = useState(STEPS.ticket);
  const [error, setError] = useState(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [queuedPairs, setQueuedPairs] = useState(0);
  const [pendingTasks, setPendingTasks] = useState(0);

  useEffect(() => {
    let active = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

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
      } catch (startError) {
        if (active) {
          setError(startError.message || 'No se pudo abrir la cámara.');
          setStatus('error');
        }
      }
    }

    startCamera();

    const unsubscribe = subscribe((items) => {
      setPendingTasks(
        items.filter((item) =>
          item.status === 'pending' || item.status === 'analyzing' || item.status === 'uploading'
        ).length,
      );
    });

    return () => {
      active = false;
      unsubscribe();
      document.body.style.overflow = previousOverflow;
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

  async function handleCapture() {
    if (status !== 'ready' || takingPhoto) return;

    setTakingPhoto(true);
    try {
      if (!videoRef.current?.videoWidth) {
        throw new Error('La cámara todavía no está lista.');
      }

      if (step === STEPS.ticket) {
        ticketFileRef.current = await makePhoto(videoRef.current, `ticket-${Date.now()}.jpg`);
        setStep(STEPS.evidence);
        setError(null);
        setTakingPhoto(false);
        return;
      }

      const evidenceFile = await makePhoto(videoRef.current, `evidencia-${Date.now()}.jpg`);
      const ticketFile = ticketFileRef.current;
      ticketFileRef.current = null;
      if (!ticketFile) {
        throw new Error('Falta la foto del ticket. Volvé a empezar el par.');
      }

      onCapturePair({ ticketFile, evidenceFile });
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
  const stepLabel = isTicketStep ? '1 de 2 · Foto del ticket' : '2 de 2 · Foto de evidencia';
  const guideText = isTicketStep
    ? 'Acercá la parte de arriba del ticket, donde dice CODIGO:'
    : 'Bolsa, contenido y ticket a la vista';
  const captureLabel = takingPhoto
    ? 'Tomando foto…'
    : isTicketStep
      ? 'Foto del ticket'
      : 'Foto de evidencia';

  return (
    <section className="order-camera" aria-label="Cámara rápida de pedidos">
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

      <p
        className={`order-camera__status order-camera__status--${status}`}
        role="status"
        aria-live="polite"
      >
        {status === 'starting' && 'Preparando cámara…'}
        {status === 'error' && 'No se pudo abrir la cámara.'}
        {status === 'ready' && stepLabel}
      </p>
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
        <button
          type="button"
          className="btn btn--primary btn--large order-camera__shutter"
          disabled={status !== 'ready' || takingPhoto}
          onClick={handleCapture}
        >
          {captureLabel}
        </button>
        <div className="order-camera__secondary">
          {step === STEPS.evidence && (
            <button type="button" className="btn btn--ghost" onClick={resetToTicket}>
              Repetir ticket
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={handleCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </section>
  );
}
