import { supabase } from './supabase.js';

export const RECOVERY_MODES = [
  { id: 'propose', label: 'Solo proponer códigos' },
  { id: 'auto_high', label: 'Confirmar solo alta confianza' },
];

export async function loadRecoverySettings() {
  const { data, error } = await supabase.from('order_recovery_settings')
    .select('enabled,start_time,mode,updated_at').eq('id', true).single();
  if (error) throw error;
  return data;
}

export async function saveRecoverySettings(patch) {
  const { data, error } = await supabase.from('order_recovery_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', true).select('enabled,start_time,mode,updated_at').single();
  if (error) throw error;
  return data;
}

export async function loadRecoveryProgress() {
  const [runs, items, usage, pending] = await Promise.all([
    supabase.from('order_recovery_runs').select('*').order('day', { ascending: false }).limit(5),
    supabase.from('order_recovery_items').select(
      'photo_id,status,code,aggregator,source,reliable,analyzed_at',
    ).in('status', ['proposed', 'confirmed', 'manual_override'])
      .order('analyzed_at', { ascending: false }).limit(100),
    supabase.rpc('current_order_ocr_usage'),
    supabase.from('photos').select('id', { count: 'exact', head: true })
      .eq('name', 'Código no encontrado').like('file_path', 'orders/%'),
  ]);
  for (const result of [runs, items, usage, pending]) if (result.error) throw result.error;
  return {
    runs: runs.data || [], proposals: items.data || [],
    usage: usage.data || 0, pending: pending.count || 0,
  };
}

export async function confirmRecoveredCode(photoId, expectedCode, code, aggregator, {
  correction = false, source = null,
} = {}) {
  const { data, error } = await supabase.functions.invoke('order-code-recovery', {
    body: {
      action: correction ? 'correct' : 'confirm',
      photoId, expectedCode, code: code || null, aggregator: aggregator || null, source,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data.photo;
}

export async function loadRecoveryEvents(photoId) {
  const { data, error } = await supabase.from('order_recovery_events')
    .select('*').eq('photo_id', photoId).order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  return data || [];
}
