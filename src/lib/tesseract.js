import { createWorker, PSM } from 'tesseract.js';

export { createWorker, PSM };

export const OCR_ENGINE_ERROR = 'No se pudo leer el ticket.';

export function tessAssetUrl(relative) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  const assetPath = `${base}tesseract/${relative}`;
  if (typeof window === 'undefined') return assetPath;
  return new URL(assetPath, window.location.origin).href;
}

export function loadTesseract() {
  return Promise.resolve({ createWorker, PSM, tessAssetUrl });
}
