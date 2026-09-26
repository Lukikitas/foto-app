import { compressImage } from './compressImage.js';
import { detectAggregator } from './aggregators.js';

export const cloudRecoveryEnabled = import.meta.env?.VITE_CLOUD_OCR_ENABLED === 'true';

async function client() {
  return (await import('./supabase.js')).supabase;
}

export async function keepTicketForRecovery(photoId, ticket) {
  if (!cloudRecoveryEnabled || !photoId || !ticket) return false;
  const compressed = await compressImage(ticket, { maxDimension: 1600, jpegQuality: 0.86 });
  const form = new FormData();
  form.set('photoId', photoId);
  form.set('ticket', compressed, 'ticket.jpg');
  const supabase = await client();
  const { data, error } = await supabase.functions.invoke('order-code-recovery', { body: form });
  if (error) throw error;
  return Boolean(data?.stored);
}

export async function recoverOrderCodeInCloud(photoId) {
  if (!cloudRecoveryEnabled || !photoId) return null;
  const supabase = await client();
  const { data, error } = await supabase.functions.invoke('order-code-recovery', {
    body: { action: 'analyze', photoId },
  });
  if (error) throw error;
  return data?.code ? {
    displayCode: data.code,
    aggregator: detectAggregator(data.code),
    reliable: Boolean(data.reliable),
    source: data.source,
  } : null;
}

export async function releaseCloudTicket(photoId) {
  if (!cloudRecoveryEnabled || !photoId) return;
  const supabase = await client();
  const { error } = await supabase.functions.invoke('order-code-recovery', {
    body: { action: 'release', photoId },
  });
  if (error) throw error;
}
