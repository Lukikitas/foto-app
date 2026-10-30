import { inspectOrderFromOcrTexts, isCompleteOrderCode, isConfidentOrderMatch } from './orderCode.js';

export function captureOrderFromOcr(body = {}) {
  const texts = Array.isArray(body.ocrTexts)
    ? body.ocrTexts.slice(0, 2).map(text => String(text || '').slice(0, 8000))
    : [String(body.ocrText || '').slice(0, 16000)];
  const inspection = inspectOrderFromOcrTexts(texts);
  return isCompleteOrderCode(inspection?.order) && isConfidentOrderMatch(inspection) ? inspection.order : null;
}
