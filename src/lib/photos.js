import { endOfDateTime, endOfDay, startOfDateTime, startOfDay } from './date';
import { AGGREGATORS, getPhotoAggregator } from './aggregators';
import { supabase } from './supabase';
import { downloadPhoto } from './photoDownload.js';
import { deleteUnresolvedTicket } from './unresolvedTicketStore.js';

export {
  cachedPhotoBlob,
  downloadPhoto,
  getDownloadFilename,
  prefetchPhotoBlob,
  startPhotoDownload,
  uniqueDownloadFilename,
} from './photoDownload.js';

const BUCKET = 'photos';
const ORDER_CODE = /^(?:\d{4,12}|\d{1,4}-\d{4,}|(?:PEYA|RAPPI(?:TURBO)?|MPD?)[A-Z0-9-]{1,28})$/;
const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
export const UNIDENTIFIED_ORDER_NAME = 'Código no encontrado';

export const PHOTO_COLUMNS =
  'id,name,file_path,public_url,created_at,notes,has_complaint,is_refutado,taken_by';

export const PHOTO_GALLERY_KINDS = {
  orders: 'orders',
  files: 'files',
};

export function isValidOrderDigits(value) {
  return ORDER_CODE.test(value);
}

export function isOrderPhoto(photo) {
  if (photo?.file_path?.startsWith('files/')) return false;
  if (photo?.file_path?.startsWith('orders/')) return true;
  return isValidOrderDigits(photo?.name || '');
}

export function isUnidentifiedOrder(photo) {
  return isOrderPhoto(photo) && photo?.name === UNIDENTIFIED_ORDER_NAME;
}

export function photoMatchesGalleryKind(photo, kind) {
  if (kind === PHOTO_GALLERY_KINDS.orders) return isOrderPhoto(photo);
  if (kind === PHOTO_GALLERY_KINDS.files) return !isOrderPhoto(photo);
  return true;
}

export function getFileExtension(photo) {
  return photo?.file_path?.split('.').pop()?.toLowerCase() || '';
}

export function isImagePhoto(photo) {
  return IMAGE_EXTENSIONS.has(getFileExtension(photo));
}

export function getPhotoTitle(photo) {
  if (isUnidentifiedOrder(photo)) return UNIDENTIFIED_ORDER_NAME;
  if (isOrderPhoto(photo)) return `Pedido #${photo.name}`;
  return photo?.name || 'Archivo';
}

export function getPhotoKind(photo) {
  if (isOrderPhoto(photo)) return 'Pedido';
  if (isImagePhoto(photo)) return 'Foto';
  return 'Archivo';
}

export function normalizePhotoMeta(meta = {}) {
  return {
    notes: meta.notes?.trim() || null,
    has_complaint: Boolean(meta.has_complaint),
    taken_by: meta.taken_by?.trim() || null,
    is_refutado: Boolean(meta.is_refutado),
  };
}

export function normalizePhotoName(value, fallback = 'Archivo') {
  return value?.trim() || fallback;
}

export async function fetchPhotosByIds(ids = []) {
  const clean = [...new Set((ids || []).filter(Boolean))];
  if (clean.length === 0) return [];

  const photos = [];
  for (let index = 0; index < clean.length; index += 50) {
    const chunk = clean.slice(index, index + 50);
    const { data, error } = await supabase.from('photos').select(PHOTO_COLUMNS).in('id', chunk);
    if (error) throw error;
    photos.push(...(data ?? []));
  }
  return photos;
}

export async function fetchPhotos({
  kind,
  search,
  dateFrom,
  dateTo,
  timeFrom,
  timeTo,
  aggregator,
  codeNotFound,
  hasComplaint,
  isRefutado,
  takenBy,
  notes,
  columns,
} = {}) {
  let query = supabase
    .from('photos')
    .select(columns || '*')
    .order('created_at', { ascending: false });

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    query = query.ilike('name', `%${trimmedSearch}%`);
  }

  if (dateFrom) {
    query = query.gte(
      'created_at',
      timeFrom ? startOfDateTime(dateFrom, timeFrom) : startOfDay(dateFrom),
    );
  }

  if (dateTo) {
    query = query.lte(
      'created_at',
      timeTo ? endOfDateTime(dateTo, timeTo) : endOfDay(dateTo),
    );
  }

  if (hasComplaint) {
    query = query.eq('has_complaint', true);
  }

  if (isRefutado) {
    query = query.eq('is_refutado', true);
  }

  if (aggregator && AGGREGATORS[aggregator]) {
    query = query.or(`file_path.like.orders/${aggregator}/%,file_path.like.orders/no_code/%`);
  }

  const trimmedTakenBy = takenBy?.trim();
  if (trimmedTakenBy) {
    query = query.ilike('taken_by', `%${trimmedTakenBy}%`);
  }

  const trimmedNotes = notes?.trim();
  if (trimmedNotes) {
    query = query.ilike('notes', `%${trimmedNotes}%`);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []).filter((photo) =>
    photoMatchesFilters(photo, {
      kind,
      search,
      dateFrom,
      dateTo,
      timeFrom,
      timeTo,
      aggregator,
      codeNotFound,
      hasComplaint,
      isRefutado,
      takenBy,
      notes,
    }),
  );
}

export function sanitizePhotoSearchToken(token) {
  return String(token || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function fetchOrderPhotosMatchingNames(tokens, { dateFrom, dateTo } = {}) {
  const clean = [...new Set(
    tokens
      .map((token) => sanitizePhotoSearchToken(token))
      .filter((token) => token.length >= 4 && token.length <= 32 && !/[%_,]/.test(token)),
  )];

  if (clean.length === 0) return [];

  const photos = [];
  for (let index = 0; index < clean.length; index += 20) {
    const chunk = clean.slice(index, index + 20);
    let query = supabase
      .from('photos')
      .select(PHOTO_COLUMNS)
      .or(chunk.map((token) => `name.ilike.%${token}%`).join(','))
      .order('created_at', { ascending: false })
      .limit(1000);

    if (dateFrom) query = query.gte('created_at', startOfDay(dateFrom));
    if (dateTo) query = query.lte('created_at', endOfDay(dateTo));

    const { data, error } = await query;
    if (error) throw error;
    photos.push(...(data ?? []).filter(isOrderPhoto));
  }

  const byId = new Map();
  photos.forEach((photo) => byId.set(photo.id, photo));
  return [...byId.values()];
}

function includesInsensitive(value, query) {
  if (!query) return true;
  if (!value) return false;
  return value.toLowerCase().includes(query.toLowerCase());
}

function minutesFromTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function photoMatchesTimeOfDay(photo, timeFrom, timeTo) {
  const from = minutesFromTime(timeFrom);
  const to = minutesFromTime(timeTo);
  if (from === null && to === null) return true;

  const takenAt = new Date(photo.created_at);
  const current = takenAt.getHours() * 60 + takenAt.getMinutes();

  if (from !== null && to !== null && from > to) {
    return current >= from || current <= to;
  }
  if (from !== null && current < from) return false;
  if (to !== null && current > to) return false;
  return true;
}

export function photoMatchesFilters(
  photo,
  {
    kind,
    search,
    dateFrom,
    dateTo,
    timeFrom,
    timeTo,
    aggregator,
    codeNotFound,
    hasComplaint,
    isRefutado,
    takenBy,
    notes,
  } = {},
) {
  if (!photoMatchesGalleryKind(photo, kind)) {
    return false;
  }

  if (aggregator && getPhotoAggregator(photo) !== aggregator) return false;
  if (codeNotFound && !isUnidentifiedOrder(photo)) return false;

  const trimmedSearch = search?.trim();
  if (trimmedSearch && !includesInsensitive(photo.name, trimmedSearch)) {
    return false;
  }

  if (dateFrom) {
    const start = new Date(
      timeFrom ? startOfDateTime(dateFrom, timeFrom) : startOfDay(dateFrom),
    );
    if (new Date(photo.created_at) < start) return false;
  }

  if (dateTo) {
    const end = new Date(timeTo ? endOfDateTime(dateTo, timeTo) : endOfDay(dateTo));
    if (new Date(photo.created_at) > end) return false;
  }

  if (!dateFrom && !dateTo && !photoMatchesTimeOfDay(photo, timeFrom, timeTo)) {
    return false;
  }

  if (hasComplaint && !photo.has_complaint) return false;
  if (isRefutado && !photo.is_refutado) return false;

  const trimmedTakenBy = takenBy?.trim();
  if (trimmedTakenBy && !includesInsensitive(photo.taken_by, trimmedTakenBy)) {
    return false;
  }

  const trimmedNotes = notes?.trim();
  if (trimmedNotes && !includesInsensitive(photo.notes, trimmedNotes)) {
    return false;
  }

  return true;
}

async function insertStoredFile(file, name, meta = {}, folder = '', filePath = '') {
  const photoMeta = normalizePhotoMeta(meta);
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const resolvedPath = filePath || (folder ? `${folder}/${fileName}` : fileName);

  const { data: existing } = await supabase
    .from('photos')
    .select()
    .eq('file_path', resolvedPath)
    .maybeSingle();
  if (existing) return existing;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(resolvedPath, file, { cacheControl: '3600', upsert: true });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(resolvedPath);

  const { data, error: dbError } = await supabase
    .from('photos')
    .insert({
      name,
      file_path: resolvedPath,
      public_url: urlData.publicUrl,
      ...photoMeta,
    })
    .select()
    .single();

  if (dbError) {
    const { data: inserted } = await supabase
      .from('photos')
      .select()
      .eq('file_path', resolvedPath)
      .maybeSingle();
    if (inserted) return inserted;
    await supabase.storage.from(BUCKET).remove([resolvedPath]);
    throw dbError;
  }

  return data;
}

export async function uploadPhoto(file, orderDigits, meta = {}, aggregator = 'sin_agregador', filePath = '') {
  if (!isValidOrderDigits(orderDigits)) {
    throw new Error('Ingresá el código completo o los últimos 4 dígitos del pedido.');
  }

  const storageAggregator = AGGREGATORS[aggregator] ? aggregator : 'sin_agregador';
  const photo = await insertStoredFile(file, orderDigits, meta, `orders/${storageAggregator}`, filePath);
  if (photo?.name === UNIDENTIFIED_ORDER_NAME) {
    return updatePhoto(photo.id, orderDigits, meta);
  }
  return photo;
}

export async function uploadUnidentifiedOrder(file, meta = {}, filePath = '') {
  return insertStoredFile(file, UNIDENTIFIED_ORDER_NAME, meta, 'orders/no_code', filePath);
}

export async function uploadFile(file, title, meta = {}, filePath = '') {
  const fallback = file.name.replace(/\.[^.]+$/, '') || 'Archivo';
  const name = normalizePhotoName(title, fallback);
  return insertStoredFile(
    file,
    name,
    {
      ...meta,
      has_complaint: false,
      is_refutado: false,
    },
    'files',
    filePath,
  );
}

export async function updatePhoto(id, name, meta = {}) {
  const nextName = normalizePhotoName(name, '');
  if (!nextName) {
    throw new Error('Ingresá un nombre.');
  }

  const photoMeta = normalizePhotoMeta(meta);

  const { data, error } = await supabase
    .from('photos')
    .update({
      name: nextName,
      ...photoMeta,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  if (isValidOrderDigits(nextName)) {
    try {
      await deleteUnresolvedTicket(id);
    } catch (ticketError) {
      console.error('No se pudo eliminar el ticket local ya resuelto.', ticketError);
    }
  }
  return data;
}

export async function bulkUpdateTakenBy(photos, takenBy) {
  const trimmed = takenBy?.trim();
  if (!trimmed) {
    throw new Error('Ingresá quién sacó la foto.');
  }

  const ids = photos.map((photo) => photo.id);
  const { data, error } = await supabase
    .from('photos')
    .update({ taken_by: trimmed })
    .in('id', ids)
    .select();

  if (error) throw error;
  return data ?? [];
}

export async function deletePhoto(id, filePath) {
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([filePath]);

  if (storageError) throw storageError;

  const { error: dbError } = await supabase.from('photos').delete().eq('id', id);

  if (dbError) throw dbError;
  try {
    await deleteUnresolvedTicket(id);
  } catch (ticketError) {
    console.error('No se pudo eliminar el ticket local.', ticketError);
  }
}

export async function bulkDeletePhotos(photos) {
  const filePaths = photos.map((photo) => photo.file_path);
  const ids = photos.map((photo) => photo.id);

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove(filePaths);

  if (storageError) throw storageError;

  const { error: dbError } = await supabase.from('photos').delete().in('id', ids);

  if (dbError) throw dbError;
  await Promise.all(ids.map(async (id) => {
    try {
      await deleteUnresolvedTicket(id);
    } catch (ticketError) {
      console.error('No se pudo eliminar un ticket local.', ticketError);
    }
  }));
}

export async function downloadPhotos(photos) {
  const usedNames = new Set();

  for (const photo of photos) {
    await downloadPhoto(photo, usedNames);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function getPhotoTimestamp(photo) {
  return photo.created_at;
}
