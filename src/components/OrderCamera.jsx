import { useEffect, useRef, useState } from 'react';

function drawFrame(video, canvas, maxWidth = 1920) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(1, maxWidth / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
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

function makePhoto(video) {
  if (!video?.videoWidth || !video?.videoHeight) {
    return Promise.reject(new Error('La cámara todavía no está lista.'));
  }

  const canvas = document.createElement('canvas');
  drawFrame(video, canvas);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo preparar la foto.'));
          return;
        }
        resolve(
          new File([blob], `pedido-${Date.now()}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          }),
        );
      },
      'image/jpeg',
      0.92,
    );
  });
}

export default function OrderCamera({ onCapture, onCancel }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('starting');
  const [error, setError] = useState(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);

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
            width: { ideal: 1920 },
            height: { ideal: 1440 },
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

    return () => {
      active = false;
      document.body.style.overflow = previousOverflow;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function handleCapture() {
    if (status !== 'ready' || takingPhoto) return;

    setTakingPhoto(true);
    try {
      if (!videoRef.current?.videoWidth) {
        throw new Error('La cámara todavía no está lista.');
      }
      const file = await makePhoto(videoRef.current);
      onCapture(file);
      setQueuedCount((count) => count + 1);
      setError(null);
      setTakingPhoto(false);
    } catch (captureError) {
      setError(captureError.message || 'No se pudo tomar la foto.');
      setTakingPhoto(false);
    }
  }

  const message = {
    starting: 'Preparando cámara…',
    ready: 'Sacá todas las fotos que necesites. El código se busca después, sin frenar la cámara.',
    error: 'No se pudo abrir la cámara.',
  }[status];

  return (
    <section className="order-camera" aria-label="Cámara rápida de pedidos">
      <div className="order-camera__viewport">
        <video ref={videoRef} className="order-camera__video" autoPlay muted playsInline />
        <div className="order-camera__guide" aria-hidden="true">
          <span>Mostrá el ticket y el contenido de la bolsa</span>
        </div>
      </div>

      <p
        className={`order-camera__status order-camera__status--${status}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {queuedCount > 0 && (
        <p className="order-camera__summary" role="status" aria-live="polite">
          {queuedCount}{' '}
          {queuedCount === 1 ? 'foto' : 'fotos'}
          {' '}en cola para analizar y guardar
        </p>
      )}
      {error && <p className="message message--error">{error}</p>}

      <div className="order-camera__actions">
        <button
          type="button"
          className="btn btn--primary btn--large"
          disabled={status !== 'ready' || takingPhoto}
          onClick={handleCapture}
        >
          {takingPhoto ? 'Tomando foto…' : 'Sacar foto'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
