import { compressImage } from './compressImage.js';

let imageWorker = null;
let nextId = 1;
const jobs = new Map();

function getImageWorker() {
  if (imageWorker) return imageWorker;
  imageWorker = new Worker(new URL('./imageWorker.js', import.meta.url), { type: 'module' });
  imageWorker.onmessage = (event) => {
    const { id, prepared, error } = event.data || {};
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(prepared);
  };
  imageWorker.onerror = () => {
    for (const job of jobs.values()) job.reject(new Error('No se pudo procesar la foto en segundo plano.'));
    jobs.clear();
    imageWorker?.terminate();
    imageWorker = null;
  };
  return imageWorker;
}

export async function compressImageInWorker(file, options) {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
    return compressImage(file, options);
  }

  try {
    const worker = getImageWorker();
    const id = nextId++;
    return await new Promise((resolve, reject) => {
      jobs.set(id, { resolve, reject });
      worker.postMessage({ id, file, options });
    });
  } catch (error) {
    console.warn('Se procesa la evidencia en la página.', error);
    return compressImage(file, options);
  }
}
