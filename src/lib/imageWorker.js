import { compressImage } from './compressImage.js';

self.onmessage = async (event) => {
  const { id, file, options } = event.data || {};
  try {
    const prepared = await compressImage(file, options);
    self.postMessage({ id, prepared });
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'No se pudo mejorar la foto.' });
  }
};
