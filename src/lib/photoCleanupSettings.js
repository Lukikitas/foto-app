import { normalizeRetentionDays } from './photoRetention.js';
import { previewPhotoCleanup } from './photoCleanupStore.js';
import { supabase } from './supabase.js';

const SETTINGS_COLUMNS = 'enabled,retention_days,updated_at,last_run_at,last_removed';

export async function loadPhotoCleanupSettings() {
  const { data, error } = await supabase
    .from('photo_cleanup_settings')
    .select(SETTINGS_COLUMNS)
    .eq('id', true)
    .single();
  if (error) throw error;
  return { ...data, retention_days: normalizeRetentionDays(data.retention_days) };
}

export async function savePhotoCleanupSettings(patch = {}) {
  const clean = {};
  if (typeof patch.enabled === 'boolean') clean.enabled = patch.enabled;
  if (patch.retention_days !== undefined) {
    clean.retention_days = normalizeRetentionDays(patch.retention_days);
  }
  const { data, error } = await supabase
    .from('photo_cleanup_settings')
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq('id', true)
    .select(SETTINGS_COLUMNS)
    .single();
  if (error) throw error;
  return { ...data, retention_days: normalizeRetentionDays(data.retention_days) };
}

/**
 * Cuántas fotos borraría la limpieza con `days` de plazo. Usa la misma
 * predicción pura (isRetentionCandidate) y las mismas fuentes de protección
 * (historial de reclamos + draft de importación activo) que la función edge
 * cleanup-photo-retention, así que el número que ve el usuario es el que se
 * borra de verdad en la próxima corrida.
 */
export async function countPhotoRetentionCandidates({ days, now = new Date() } = {}) {
  const preview = await previewPhotoCleanup({ days, now });
  return preview.photos.length;
}
