import { compactCode } from './complaintMatch.js';

export const PHOTO_RETENTION_DEFAULT_DAYS = 30;
export const PHOTO_RETENTION_MIN_DAYS = 7;
export const PHOTO_RETENTION_MAX_DAYS = 365;

// Mismo literal que photos.js/complaintMatch.js. No lo importamos de ahí porque
// photos.js arrastra el cliente de supabase: rompería los tests de Node y la
// función edge (Deno).
export const UNIDENTIFIED_ORDER = 'Código no encontrado';

/**
 * Plazo de retención válido (7 a 365 días). Vacío, inválido o no numérico →
 * default; fuera de rango → clamp.
 */
export function normalizeRetentionDays(value) {
  if (value === null || value === undefined || value === '') return PHOTO_RETENTION_DEFAULT_DAYS;
  const days = Number(value);
  if (!Number.isFinite(days)) return PHOTO_RETENTION_DEFAULT_DAYS;
  return Math.min(
    PHOTO_RETENTION_MAX_DAYS,
    Math.max(PHOTO_RETENTION_MIN_DAYS, Math.round(days)),
  );
}

/** ISO del corte: las fotos con created_at anterior a esta fecha son candidatas. */
export function retentionCutoffIso(days, now = new Date()) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCDate(cutoff.getUTCDate() - normalizeRetentionDays(days));
  return cutoff.toISOString();
}

/**
 * Fotos que ya están tomadas por el historial de reclamos (y el draft activo):
 * id directo, código compacto del pedido y nombre de foto compactado. Cualquiera
 * de las tres protege a la foto, igual que findHistoryForPhoto en la app.
 * Acepta items sin normalizar (sin el campo `compact`).
 */
export function collectHistoryPhotoRefs(items = []) {
  const photoIds = new Set();
  const compacts = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.photoId) photoIds.add(String(item.photoId));
    const byOrder = compactCode(item.compact || item.orderCode || '');
    if (byOrder) compacts.add(byOrder);
    const byName = compactCode(item.photoName || '');
    if (byName) compacts.add(byName);
  }
  return { photoIds, compacts };
}

/**
 * Protecciones de la lista de importación activa (siempre hay a lo sumo una):
 * las fotos ya elegidas y los códigos de sus reclamos, para no dejar la
 * revisión ni un cruce sin evidencia mientras la lista está pendiente.
 */
export function collectDraftRefs(draft) {
  const photoIds = new Set();
  const compacts = new Set();
  const data = draft && typeof draft === 'object' ? (draft.data || {}) : {};
  for (const id of Object.values(data.pickedPhotoIds || {})) {
    if (id) photoIds.add(String(id));
  }
  for (const complaint of data.complaints || []) {
    const compact = compactCode(complaint?.orderCode || '');
    if (compact) compacts.add(compact);
  }
  return { photoIds, compacts };
}

/** Une varias protecciones (historial + draft) en un solo conjunto. */
export function mergePhotoRefs(...refSets) {
  const photoIds = new Set();
  const compacts = new Set();
  for (const refs of refSets) {
    for (const id of refs?.photoIds || []) photoIds.add(id);
    for (const compact of refs?.compacts || []) compacts.add(compact);
  }
  return { photoIds, compacts };
}

/**
 * ¿Puede la limpieza borrar el archivo de esta foto? Es la única
 * fuente de verdad: la usa la función edge, el preview de Ajustes y los tests.
 * Protege: solo pedidos (orders/), sin queja ni refutación,
 * con archivo todavía publicado, distinto de «Código no encontrado», y sin
 * referencias del historial ni del draft de importación activo.
 */
export function isPhotoCleanupCandidate(photo, { refs = null } = {}) {
  if (!photo) return false;
  const filePath = String(photo.file_path || '');
  if (!filePath.startsWith('orders/')) return false;
  if (photo.has_complaint || photo.is_refutado) return false;
  // Sin URL no hay archivo que borrar: ya fue purgada (idempotente).
  if (!photo.public_url) return false;
  if (String(photo.name || '') === UNIDENTIFIED_ORDER) return false;

  const id = photo.id != null ? String(photo.id) : '';
  if (id && refs?.photoIds?.has(id)) return false;
  const compact = compactCode(photo.name || '');
  if (compact && refs?.compacts?.has(compact)) return false;
  return true;
}

export function isRetentionCandidate(photo, { cutoffIso, refs = null } = {}) {
  if (!isPhotoCleanupCandidate(photo, { refs })) return false;
  const createdAt = Date.parse(photo.created_at || '');
  const cutoff = Date.parse(cutoffIso || '');
  return Number.isFinite(createdAt) && Number.isFinite(cutoff) && createdAt < cutoff;
}

// A shared object must remain while any published row still needs it.
export function safePhotoCleanupCandidates(photos, { cutoffIso = null, refs = null } = {}) {
  const eligible = photo => cutoffIso ? isRetentionCandidate(photo,{cutoffIso,refs}) : isPhotoCleanupCandidate(photo,{refs});
  const blocked = new Set(photos.filter(photo=>photo.public_url && !eligible(photo)).map(photo=>photo.file_path));
  return photos.filter(photo=>eligible(photo) && !blocked.has(photo.file_path));
}
