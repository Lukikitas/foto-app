import { detectOrderFromPhoto } from './orderOcr.js';
import { updatePhoto } from './photos.js';
import { getUnresolvedTicket } from './unresolvedTicketStore.js';

export async function retryUnresolvedTicket(photo) {
  const ticket = await getUnresolvedTicket(photo?.id);
  if (!ticket) throw new Error('El ticket ya no está disponible en este celular.');

  const detected = await detectOrderFromPhoto(ticket);
  if (!detected?.displayCode) return null;

  return updatePhoto(photo.id, detected.displayCode, {
    notes: photo.notes || '',
    has_complaint: Boolean(photo.has_complaint),
    taken_by: photo.taken_by || '',
    is_refutado: Boolean(photo.is_refutado),
  });
}
