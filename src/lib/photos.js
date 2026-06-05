import { endOfDay, startOfDay } from './date';
import { supabase } from './supabase';

const BUCKET = 'photos';
const ORDER_DIGITS = /^\d{4}$/;

export function isValidOrderDigits(value) {
  return ORDER_DIGITS.test(value);
}

export async function fetchPhotos({ search, dateFrom, dateTo } = {}) {
  let query = supabase
    .from('photos')
    .select('*')
    .order('created_at', { ascending: false });

  const trimmedSearch = search?.trim();
  if (trimmedSearch) {
    query = query.ilike('name', `%${trimmedSearch}%`);
  }

  if (dateFrom) {
    query = query.gte('created_at', startOfDay(dateFrom));
  }

  if (dateTo) {
    query = query.lte('created_at', endOfDay(dateTo));
  }

  const { data, error } = await query;

  if (error) throw error;
  return data ?? [];
}

export async function uploadPhoto(file, orderDigits) {
  if (!isValidOrderDigits(orderDigits)) {
    throw new Error('El pedido debe tener exactamente 4 dígitos.');
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const filePath = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(filePath);

  const { data, error: dbError } = await supabase
    .from('photos')
    .insert({
      name: orderDigits,
      file_path: filePath,
      public_url: urlData.publicUrl,
    })
    .select()
    .single();

  if (dbError) {
    await supabase.storage.from(BUCKET).remove([filePath]);
    throw dbError;
  }

  return data;
}

export async function renamePhoto(id, orderDigits) {
  if (!isValidOrderDigits(orderDigits)) {
    throw new Error('El pedido debe tener exactamente 4 dígitos.');
  }

  const { data, error } = await supabase
    .from('photos')
    .update({ name: orderDigits })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deletePhoto(id, filePath) {
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([filePath]);

  if (storageError) throw storageError;

  const { error: dbError } = await supabase.from('photos').delete().eq('id', id);

  if (dbError) throw dbError;
}

export async function downloadPhoto(photo) {
  const response = await fetch(photo.public_url);
  if (!response.ok) throw new Error('No se pudo descargar la foto');

  const blob = await response.blob();
  const ext = photo.file_path.split('.').pop() || 'jpg';
  const timestamp = (photo.created_at || '')
    .slice(0, 16)
    .replace('T', '_')
    .replace(/:/g, '-');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pedido-${photo.name}${timestamp ? `-${timestamp}` : ''}.${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function getPhotoTimestamp(photo) {
  return photo.created_at;
}
