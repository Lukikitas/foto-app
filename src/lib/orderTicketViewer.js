import { getUnresolvedTicket } from './unresolvedTicketStore.js';
import { getCloudTicketUrl } from './cloudOrderRecovery.js';

// Devuelve la foto del ticket de un pedido: primero la copia local del
// dispositivo que capturó el par y después el ticket remoto de Supabase.
// Resultado: { source: 'local'|'remote', url, file } o null si no hay ticket.
export async function loadOrderTicket(photoId, {
  getLocalTicket = getUnresolvedTicket,
  getRemoteTicket = getCloudTicketUrl,
  createUrl = (file) => URL.createObjectURL(file),
} = {}) {
  if (!photoId) return null;
  try {
    const file = await getLocalTicket(photoId);
    if (file) return { source: 'local', url: createUrl(file), file };
  } catch (error) {
    console.warn('No se pudo consultar el ticket local; se intenta el remoto.', error);
  }
  const url = await getRemoteTicket(photoId);
  return url ? { source: 'remote', url, file: null } : null;
}

// «Código no encontrado» y nombres con símbolos no sirven para el archivo.
export function ticketDownloadFilename(photo) {
  const raw = String(photo?.name || '').trim();
  const safe = raw && raw !== 'Código no encontrado'
    ? raw.replace(/[^A-Za-z0-9-]/g, '')
    : '';
  return safe ? `ticket-${safe}.jpg` : 'ticket.jpg';
}
