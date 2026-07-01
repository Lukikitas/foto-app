import { uploadFile, uploadPhoto } from './photos';

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

export function enqueue({ file, kind = 'order', orderDigits = '', title = '', meta }) {
  const item = {
    id: crypto.randomUUID(),
    file,
    kind,
    orderDigits,
    title,
    label: kind === 'order' ? `Pedido #${orderDigits}` : title || file.name,
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
  next.status = 'uploading';
  notify();

  try {
    const photo = next.kind === 'file'
      ? await uploadFile(next.file, next.title, next.meta)
      : await uploadPhoto(next.file, next.orderDigits, next.meta);
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
    next.status = 'error';
    next.error = err.message || 'Error al subir la foto.';
    notify();
  } finally {
    processing = false;
    processQueue();
  }
}

export function getPendingCount() {
  return queue.filter((entry) => entry.status === 'pending' || entry.status === 'uploading').length;
}
