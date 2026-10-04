import { getUnresolvedTicket } from './unresolvedTicketStore.js';
import { getCloudTicketUrl, keepTicketForRecovery } from './cloudOrderRecovery.js';

// Reintenta subir a Supabase un ticket que la cola no llegó a guardar (idempotente:
// si ya existe devuelve sin subir; si el pedido ya tiene código, Supabase rechaza).
// Nunca lanza: el ticket local siempre se puede ver igual.
export async function syncTicketToCloud(photoId, file, {
  hasRemoteTicket = getCloudTicketUrl,
  uploadTicket = keepTicketForRecovery,
} = {}) {
  try {
    if (await hasRemoteTicket(photoId)) return false;
    return Boolean(await uploadTicket(photoId, file));
  } catch (error) {
    console.warn('No se pudo sincronizar el ticket con Supabase.', error);
    return false;
  }
}

// Devuelve la foto del ticket de un pedido: primero la copia local del
// dispositivo que capturó el par y después el ticket remoto de Supabase.
// Resultado: { source: 'local'|'remote', url, file, sync } o null si no hay ticket.
// `sync` es la promesa (fire-and-forget) del reintento de subida del ticket local;
// `syncLocalTicket: null` lo desactiva.
export async function loadOrderTicket(photoId, {
  getLocalTicket = getUnresolvedTicket,
  getRemoteTicket = getCloudTicketUrl,
  createUrl = (file) => URL.createObjectURL(file),
  syncLocalTicket = syncTicketToCloud,
} = {}) {
  if (!photoId) return null;
  try {
    const file = await getLocalTicket(photoId);
    if (file) {
      const sync = syncLocalTicket
        ? Promise.resolve()
          .then(() => syncLocalTicket(photoId, file))
          .catch(() => false)
        : null;
      return { source: 'local', url: createUrl(file), file, sync };
    }
  } catch (error) {
    console.warn('No se pudo consultar el ticket local; se intenta el remoto.', error);
  }
  const url = await getRemoteTicket(photoId);
  return url ? { source: 'remote', url, file: null, sync: null } : null;
}

// «Código no encontrado» y nombres con símbolos no sirven para el archivo.
export function ticketDownloadFilename(photo) {
  const raw = String(photo?.name || '').trim();
  const safe = raw && raw !== 'Código no encontrado'
    ? raw.replace(/[^A-Za-z0-9-]/g, '')
    : '';
  return safe ? `ticket-${safe}.jpg` : 'ticket.jpg';
}
