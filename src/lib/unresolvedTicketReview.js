import { detectOrderFromPhoto } from './orderOcr.js';
import { getUnresolvedTicket } from './unresolvedTicketStore.js';
import { isCompleteOrderCode } from './orderCode.js';
import { recoverOrderCodeInCloud } from './cloudOrderRecovery.js';
import { isAbortError } from './tesseractAssets.js';

export async function suggestUnresolvedOrderCode(photo, {
  getTicket = getUnresolvedTicket,
  detect = detectOrderFromPhoto,
  fetchPhoto = fetch,
  cloudRecover = recoverOrderCodeInCloud,
  signal,
  withDetails = false,
} = {}) {
  const suggestion = (code, preview = null) => withDetails ? { code, preview } : code;
  let ticket = null;
  try {
    ticket = await getTicket(photo?.id);
  } catch (error) {
    console.warn('No se pudo consultar el ticket local; se intenta con la foto del pedido.', error);
  }
  if (ticket) {
    try {
      const detected = await detect(ticket, { requireStrong: true, budgetMs: 15_000, signal });
      if (detected?.displayCode) return suggestion(detected.displayCode);
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn('No se pudo releer el ticket local; se intenta con la foto del pedido.', error);
    }
  }

  if (!photo?.public_url) throw new Error('No se encontró la foto del pedido.');
  let detected = null;
  let evidenceError = null;
  try {
    const response = await fetchPhoto(photo.public_url, { signal });
    if (!response.ok) throw new Error('No se pudo descargar la foto del pedido.');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('La foto del pedido no es una imagen.');
    const evidence = new File([blob], 'evidencia.jpg', { type: blob.type });
    detected = await detect(evidence, { evidence: true, budgetMs: 35_000, signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    evidenceError = error;
  }
  if (isCompleteOrderCode(detected)) return suggestion(detected.displayCode, detected.preview);
  try {
    const cloud = await cloudRecover(photo.id);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (cloud?.displayCode) return suggestion(cloud.displayCode);
  } catch (error) {
    if (isAbortError(error)) throw error;
    console.warn('No se pudo usar el OCR de respaldo.', error);
  }
  if (evidenceError) throw evidenceError;
  return detected?.displayCode ? suggestion(detected.displayCode, detected.preview) : null;
}
