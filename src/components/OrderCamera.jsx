import { useEffect, useRef, useState } from 'react';
import { detectOrderCode } from '../lib/orderCode';
import { loadTesseract } from '../lib/tesseract';

const SCAN_INTERVAL_MS = 450;
const NO_CODE_NOTICE_AFTER_MS = 3500;
const ROTATION_RETRY_AFTER_MS = 2200;
const ROTATION_RETRY_COOLDOWN_MS = 3500;

function drawFrame(video, canvas, maxWidth = 1280, rotation = 0) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(1, maxWidth / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  canvas.width = rotation ? height : width;
  canvas.height = rotation ? width : height;
  const context = canvas.getContext('2d', { alpha: false });
  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(video, 0, 0, width, height);
}

function makePhoto(video) {
  const canvas = document.createElement('canvas');
  drawFrame(video, canvas, 1920);

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
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const restartScanRef = useRef(null);
  const [status, setStatus] = useState('starting');
  const [detectedOrder, setDetectedOrder] = useState(null);
  const [error, setError] = useState(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [lastQueued, setLastQueued] = useState(null);

  useEffect(() => {
    let active = true;
    let startedAt = 0;
    let lastRotationRetryAt = 0;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function scheduleScan(scan) {
      timerRef.current = window.setTimeout(scan, SCAN_INTERVAL_MS);
    }

    async function startScanner() {
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
        if (!active) return;

        const Tesseract = await loadTesseract();
        if (!Tesseract?.createWorker) {
          throw new Error('No se pudo iniciar el lector del ticket.');
        }

        const worker = await Tesseract.createWorker('eng');
        if (!active) {
          worker.terminate();
          return;
        }
        workerRef.current = worker;

        startedAt = Date.now();
        setStatus('scanning');

        const scan = async () => {
          if (!active || !videoRef.current?.videoWidth || !workerRef.current) return;

          try {
            drawFrame(videoRef.current, canvasRef.current);
            let {
              data: { text },
            } = await workerRef.current.recognize(canvasRef.current);
            if (!active) return;

            let order = detectOrderCode(text);
            const shouldTryRotation = !order
              && Date.now() - startedAt >= ROTATION_RETRY_AFTER_MS
              && Date.now() - lastRotationRetryAt >= ROTATION_RETRY_COOLDOWN_MS;

            if (shouldTryRotation) {
              lastRotationRetryAt = Date.now();
              for (const rotation of [90, 270]) {
                drawFrame(videoRef.current, canvasRef.current, 1280, rotation);
                ({ data: { text } } = await workerRef.current.recognize(canvasRef.current));
                if (!active) return;
                order = detectOrderCode(text);
                if (order) break;
              }
            }

            if (order) {
              setDetectedOrder(order);
              setStatus('found');
              return;
            }

            if (Date.now() - startedAt >= NO_CODE_NOTICE_AFTER_MS) {
              setStatus('not-found');
            }
          } catch (scanError) {
            if (active) setError(scanError.message || 'No se pudo leer el ticket.');
          }

          if (active) scheduleScan(scan);
        };

        restartScanRef.current = scan;
        scan();
      } catch (startError) {
        if (active) {
          setError(startError.message || 'No se pudo abrir la cámara.');
          setStatus('error');
        }
      }
    }

    startScanner();

    return () => {
      active = false;
      window.clearTimeout(timerRef.current);
      restartScanRef.current = null;
      document.body.style.overflow = previousOverflow;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      workerRef.current?.terminate();
    };
  }, []);

  async function handleCapture() {
    if (!detectedOrder || takingPhoto) return;

    setTakingPhoto(true);
    try {
      const file = await makePhoto(videoRef.current);
      onCapture(file, detectedOrder);
      setQueuedCount((count) => count + 1);
      setLastQueued(detectedOrder);
      setDetectedOrder(null);
      setStatus('scanning');
      setError(null);
      setTakingPhoto(false);
      window.setTimeout(() => restartScanRef.current?.(), 180);
    } catch (captureError) {
      setError(captureError.message || 'No se pudo tomar la foto.');
      setTakingPhoto(false);
    }
  }

  const message = {
    starting: 'Preparando cámara y lector…',
    scanning: 'Buscando “CODIGO:” y el agregador…',
    'not-found': 'No se detecta “CODIGO:” seguido de PEYA, RAPPI, RAPPITURBO o MPD.',
    found: `${detectedOrder?.aggregatorLabel}: ${detectedOrder?.displayCode} detectado.`,
    error: 'No se pudo iniciar la lectura automática.',
  }[status];

  return (
    <section className="order-camera" aria-label="Lectura del código del pedido">
      <div className="order-camera__viewport">
        <video ref={videoRef} className="order-camera__video" autoPlay muted playsInline />
        <div className="order-camera__guide" aria-hidden="true">
          <span>Mostrá el ticket con “CODIGO:” dentro de esta zona</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="order-camera__canvas" aria-hidden="true" />

      <p
        className={`order-camera__status order-camera__status--${status}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {lastQueued && (
        <p className="order-camera__summary" role="status" aria-live="polite">
          {lastQueued.aggregatorLabel} · {lastQueued.displayCode} en cola · {queuedCount}{' '}
          {queuedCount === 1 ? 'foto' : 'fotos'}
        </p>
      )}
      {error && <p className="message message--error">{error}</p>}

      <div className="order-camera__actions">
        <button
          type="button"
          className="btn btn--primary btn--large"
          disabled={!detectedOrder || takingPhoto}
          onClick={handleCapture}
        >
          {takingPhoto ? 'Guardando foto…' : 'Sacar foto y seguir'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  );
}
