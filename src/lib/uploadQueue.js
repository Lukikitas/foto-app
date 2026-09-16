import { compressImage } from './compressImage';
import { detectOrderFromPhoto } from './orderOcr';
import { OCR_ENGINE_ERROR } from './tesseract';
import { uploadFile, uploadPhoto, uploadUnidentifiedOrder } from './photos';

const queue = [];
const listeners = new Set();
let processing = false;
let onCompleteHandler = null;

function snapshot() {
  return queue.map((item) => ({
    id: item.id,
    status: item.status,
    label: item.label,
    error: item.error,
    createdAt: item.createdAt,
  }));
}

function notify() {
  const data = snapshot();
  listeners.forEach((fn) => fn(data));
}

export function setUploadCompleteHandler(handler) {
  onCompleteHandler = handler;
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function enqueue({
  file,
  ocrFile,
  kind = 'order',
  orderDigits = '',
  title = '',
  aggregator = '',
  meta,
}) {
  const item = {
    id: crypto.randomUUID(),
    file,
    ocrFile,
    kind,
    orderDigits,
    title,
    aggregator,
    label: kind === 'order'
      ? orderDigits ? `Pedido #${orderDigits}` : 'Buscando código…'
      : title || file.name,
    meta,
    status: 'pending',
    error: null,
    createdAt: Date.now(),
  };

  queue.push(item);
  notify();
  processQueue();
  return item.id;
}

export function retryUpload(id) {
  const item = queue.find((entry) => entry.id === id);
  if (!item || item.status !== 'error') return;

  item.status = 'pending';
  item.error = null;
  notify();
  processQueue();
}

export function dismissUpload(id) {
  const index = queue.findIndex((entry) => entry.id === id);
  if (index === -1) return;

  queue.splice(index, 1);
  notify();
  processQueue();
}

async function processQueue() {
  if (processing) return;

  const next = queue.find((entry) => entry.status === 'pending');
  if (!next) return;

  processing = true;
  try {
    let detectedOrder = null;
    const needsOcr = next.kind !== 'file' && !next.orderDigits;

    if (needsOcr) {
      next.status = 'analyzing';
      next.label = 'Buscando código…';
      notify();
      detectedOrder = await detectOrderFromPhoto(
        next.ocrFile || next.file,
        next.ocrFile ? [next.file] : [],
      );
    }

    const preparedFile = next.file.type.startsWith('image/')
      ? await compressImage(next.file)
      : next.file;

    let photo;
    if (next.kind === 'file') {
      next.status = 'uploading';
      notify();
      photo = await uploadFile(preparedFile, next.title, next.meta);
    } else if (next.orderDigits) {
      next.status = 'uploading';
      notify();
      photo = await uploadPhoto(preparedFile, next.orderDigits, next.meta, next.aggregator);
    } else if (detectedOrder) {
      next.status = 'uploading';
      next.label = `Pedido #${detectedOrder.displayCode}`;
      notify();
      photo = await uploadPhoto(
        preparedFile,
        detectedOrder.displayCode,
        next.meta,
        detectedOrder.aggregator || 'sin_agregador',
      );
    } else {
      next.status = 'uploading';
      next.label = 'Código no encontrado';
      notify();
      photo = await uploadUnidentifiedOrder(preparedFile, next.meta);
    }
    next.status = 'done';
    next.error = null;
    notify();
    onCompleteHandler?.(photo);

    setTimeout(() => {
      const index = queue.findIndex((entry) => entry.id === next.id);
      if (index !== -1 && queue[index].status === 'done') {
        queue.splice(index, 1);
        notify();
      }
    }, 4000);
  } catch (err) {
    const analyzing = next.status === 'analyzing';
    next.status = 'error';
    next.error = err.message || (analyzing ? OCR_ENGINE_ERROR : 'Error al subir la foto.');
    notify();
  } finally {
    processing = false;
    processQueue();
  }
}

export function getPendingCount() {
  return queue.filter((entry) =>
    entry.status === 'pending' || entry.status === 'analyzing' || entry.status === 'uploading'
  ).length;
}
