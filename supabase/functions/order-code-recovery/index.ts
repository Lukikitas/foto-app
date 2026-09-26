import { createClient } from 'npm:@supabase/supabase-js@2';
import { inspectOrderFromOcrTexts, isCompleteOrderCode } from '../../../src/lib/orderCode.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const url = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const visionKey = Deno.env.get('GOOGLE_VISION_API_KEY') || '';
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const TICKET_BUCKET = 'order-tickets';
const EVIDENCE_BUCKET = 'photos';
const NO_CODE = 'Código no encontrado';

async function getPhoto(photoId: string) {
  const { data, error } = await db.from('photos')
    .select('id,name,file_path,created_at')
    .eq('id', photoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function releaseTicket(photoId: string) {
  const { data: ref } = await db.from('unresolved_ticket_refs')
    .select('storage_path').eq('photo_id', photoId).maybeSingle();
  if (!ref) return;
  const { error } = await db.storage.from(TICKET_BUCKET).remove([ref.storage_path]);
  if (error) throw error;
  await db.from('unresolved_ticket_refs').delete().eq('photo_id', photoId);
}

async function cleanupTickets() {
  let removed = 0;
  const now = new Date().toISOString();
  const { data: expired, error } = await db.from('unresolved_ticket_refs')
    .select('photo_id').lte('expires_at', now).limit(200);
  if (error) throw error;
  for (const ref of expired || []) {
    await releaseTicket(ref.photo_id);
    removed += 1;
  }
  return removed;
}

function base64(bytes: Uint8Array) {
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(raw);
}

async function visionRead(bytes: Uint8Array) {
  const { data: reserved, error: quotaError } = await db.rpc('reserve_order_ocr_unit');
  if (quotaError) throw quotaError;
  if (!reserved) return { exhausted: true, code: null, reliable: false };
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(visionKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{
      image: { content: base64(bytes) },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
    }] }),
  });
  if (!response.ok) throw new Error(`Google Vision devolvió ${response.status}`);
  const payload = await response.json();
  const result = payload.responses?.[0];
  if (result?.error) throw new Error(result.error.message || 'No se pudo usar Google Vision.');
  const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || '';
  const inspection = inspectOrderFromOcrTexts([text]);
  if (!isCompleteOrderCode(inspection?.order)) return { code: null, reliable: false };
  return { code: inspection.order.displayCode, reliable: Boolean(inspection.labeled) };
}

async function analyze(photoId: string) {
  const photo = await getPhoto(photoId);
  if (!photo || photo.name !== NO_CODE || !photo.file_path?.startsWith('orders/')) {
    return reply({ error: 'Pedido sin código no disponible.' }, 404);
  }
  const { data: cached } = await db.from('order_ocr_results')
    .select('code,source,reliable').eq('photo_id', photoId).maybeSingle();
  if (cached) return reply({ ...cached, cached: true });
  if (!visionKey) return reply({ code: null, unavailable: true });

  const { data: ticketRef } = await db.from('unresolved_ticket_refs')
    .select('storage_path,expires_at').eq('photo_id', photoId).maybeSingle();
  const sources = [];
  if (ticketRef && new Date(ticketRef.expires_at).getTime() > Date.now()) {
    sources.push({ bucket: TICKET_BUCKET, path: ticketRef.storage_path, source: 'ticket' });
  }
  sources.push({ bucket: EVIDENCE_BUCKET, path: photo.file_path, source: 'evidence' });
  let candidate = null;
  for (const source of sources) {
    const { data: blob, error } = await db.storage.from(source.bucket).download(source.path);
    if (error || !blob) continue;
    const read = await visionRead(new Uint8Array(await blob.arrayBuffer()));
    if (read.exhausted) return reply({ code: candidate?.code || null, quotaExhausted: true });
    if (read.code) candidate = { ...read, source: source.source };
    if (read.reliable) break;
  }
  const result = candidate || { code: null, source: null, reliable: false };
  await db.from('order_ocr_results').upsert({ photo_id: photoId, ...result });
  return reply(result);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  if (!url || !serviceKey) return reply({ error: 'Servicio no configurado.' }, 503);
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const photoId = String(form.get('photoId') || '');
      const ticket = form.get('ticket');
      if (!photoId || !(ticket instanceof File) || !ticket.type.startsWith('image/') || ticket.size > 3_000_000) {
        return reply({ error: 'Ticket inválido.' }, 400);
      }
      const photo = await getPhoto(photoId);
      if (!photo || photo.name !== NO_CODE) return reply({ error: 'Pedido no disponible.' }, 404);
      if (Date.now() - new Date(photo.created_at).getTime() > 30 * 60 * 1000) {
        return reply({ error: 'El plazo para guardar el ticket terminó.' }, 409);
      }
      const { data: existingTicket } = await db.from('unresolved_ticket_refs')
        .select('photo_id').eq('photo_id', photoId).maybeSingle();
      if (existingTicket) return reply({ stored: true, cached: true });
      const path = `${photoId}.jpg`;
      const { data: reserved, error: reserveError } = await db.rpc('reserve_order_ticket', {
        ticket_photo_id: photoId,
        ticket_path: path,
        ticket_bytes: ticket.size,
      });
      if (reserveError) throw reserveError;
      if (!reserved) return reply({ stored: false, reason: 'quota' });
      const { error } = await db.storage.from(TICKET_BUCKET).upload(path, ticket, {
        upsert: false, contentType: ticket.type,
      });
      if (error) {
        await db.from('unresolved_ticket_refs').delete().eq('photo_id', photoId);
        return reply({ stored: false, reason: 'storage' });
      }
      return reply({ stored: true });
    }
    const body = await request.json();
    if (body.action === 'cleanup') {
      if (!Deno.env.get('TICKET_CLEANUP_SECRET') || request.headers.get('x-cleanup-secret') !== Deno.env.get('TICKET_CLEANUP_SECRET')) {
        return reply({ error: 'No autorizado.' }, 401);
      }
      return reply({ removed: await cleanupTickets() });
    }
    const photoId = String(body.photoId || '');
    if (!photoId) return reply({ error: 'Falta el pedido.' }, 400);
    if (body.action === 'release') {
      const photo = await getPhoto(photoId);
      if (photo?.name === NO_CODE) return reply({ error: 'El pedido sigue sin código.' }, 409);
      await releaseTicket(photoId);
      return reply({ released: true });
    }
    if (body.action === 'analyze') return analyze(photoId);
    return reply({ error: 'Acción desconocida.' }, 400);
  } catch (error) {
    console.error('order-code-recovery:', error);
    return reply({ error: 'No se pudo procesar la solicitud.' }, 500);
  }
});
