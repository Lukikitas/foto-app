import { detectOrderFromPhoto } from './orderOcr.js';
import { getUnresolvedTicket } from './unresolvedTicketStore.js';

export async function suggestUnresolvedOrderCode(photo, {
  getTicket = getUnresolvedTicket,
  detect = detectOrderFromPhoto,
  fetchPhoto = fetch,
} = {}) {
  let ticket = null;
  try {
    ticket = await getTicket(photo?.id);
  } catch (error) {
    console.warn('No se pudo consultar el ticket local; se intenta con la foto del pedido.', error);
  }
  if (ticket) {
    try {
      const detected = await detect(ticket);
      if (detected?.displayCode) return detected.displayCode;
    } catch (error) {
      console.warn('No se pudo releer el ticket local; se intenta con la foto del pedido.', error);
    }
  }

  if (!photo?.public_url) throw new Error('No se encontró la foto del pedido.');
  const response = await fetchPhoto(photo.public_url);
  if (!response.ok) throw new Error('No se pudo descargar la foto del pedido.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('La foto del pedido no es una imagen.');
  const evidence = new File([blob], 'evidencia.jpg', { type: blob.type });
  const detected = await detect(evidence, { evidence: true });
  return detected?.displayCode || null;
}
