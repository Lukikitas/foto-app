import { createWorker, PSM as TESSERACT_PSM } from 'tesseract.js';
import { OCR_ENGINE_ERROR, tessAssetUrl } from './tesseractAssets.js';

export { createWorker, OCR_ENGINE_ERROR, tessAssetUrl };
export const PSM = TESSERACT_PSM;

export function loadTesseract() {
  return Promise.resolve({ createWorker, PSM, tessAssetUrl });
}
