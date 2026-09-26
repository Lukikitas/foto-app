import { createClient } from 'npm:@supabase/supabase-js@2';
import { inspectOrderFromOcrTexts, isCompleteOrderCode } from '../../../src/lib/orderCode.js';
import { detectAggregator } from '../../../src/lib/aggregators.js';
import { evaluateScheduledReadings } from '../../../src/lib/recoveryConfidence.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-secret, x-recovery-secret',
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
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';
const VALID_CODE = /^(?:\d{4,12}|\d{1,4}-\d{4,}|(?:PEYA|RAPPI(?:TURBO)?|MPD?)[A-Z0-9-]{1,28})$/;

function checked<T extends { error: unknown }>(result: T): T {
  if (result.error) throw result.error;
  return result;
}

async function getPhoto(photoId: string) {
  const { data, error } = await db.from('photos')
    .select('*')
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

async function visionRead(bytes: Uint8Array, scheduled = false) {
  const { data: reserved, error: quotaError } = await db.rpc(
    scheduled ? 'reserve_scheduled_order_ocr_unit' : 'reserve_order_ocr_unit',
  );
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
  if (!isCompleteOrderCode(inspection?.order)) return { code: null, aggregator: null, reliable: false };
  return {
    code: inspection.order.displayCode,
    aggregator: inspection.order.aggregator,
    reliable: Boolean(inspection.labeled),
  };
}

async function claimVisionWork(photoId: string) {
  const { data, error } = await db.rpc('claim_order_ocr_analysis', { p_photo_id: photoId });
  if (error) throw error;
  return Boolean(data);
}

async function failVisionWork(photoId: string) {
  await db.from('order_ocr_results').update({
    status: 'error', lease_until: null,
  }).eq('photo_id', photoId).eq('status', 'processing');
}

function argentinaParts() {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return { day: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

async function analyzeScheduled(photoId: string) {
  const photo = await getPhoto(photoId);
  if (!photo || photo.name !== NO_CODE || !photo.file_path?.startsWith('orders/')) {
    return { status: 'manual_override', code: null, aggregator: null, source: null,
      reliable: false, quotaExhausted: false, busy: false, details: {} };
  }
  const { data: cached } = await db.from('order_ocr_results')
    .select('code,aggregator,source,reliable,created_at,status').eq('photo_id', photoId).maybeSingle();
  if (cached?.status === 'done' && (cached.code ||
    Date.now() - Date.parse(cached.created_at) < 7 * 86400_000)) {
    return {
      status: cached.code ? 'proposed' : 'no_code', code: cached.code,
      aggregator: cached.aggregator || detectAggregator(cached.code), source: cached.source,
      reliable: false, quotaExhausted: false, busy: false, details: { cached: true },
    };
  }
  if (!visionKey) throw new Error('Google Vision no está configurado.');
  if (!await claimVisionWork(photoId)) {
    return { status: 'pending', code: null, aggregator: null, source: null,
      reliable: false, quotaExhausted: false, busy: true, details: {} };
  }
  try {
  const { data: ticket } = await db.from('unresolved_ticket_refs')
    .select('storage_path,expires_at').eq('photo_id', photoId).maybeSingle();
  const sources = [];
  if (ticket && Date.parse(ticket.expires_at) > Date.now()) {
    sources.push({ bucket: TICKET_BUCKET, path: ticket.storage_path, name: 'ticket' });
  }
  sources.push({ bucket: EVIDENCE_BUCKET, path: photo.file_path, name: 'evidence' });
  const readings = [];
  for (const source of sources) {
    const { data: blob, error } = await db.storage.from(source.bucket).download(source.path);
    if (error || !blob) continue;
    const read = await visionRead(new Uint8Array(await blob.arrayBuffer()), true);
    if (read.exhausted) {
      const partial = evaluateScheduledReadings(readings);
      await failVisionWork(photoId);
      return {
        status: partial.code ? 'proposed' : 'pending',
        code: partial.code, aggregator: partial.aggregator, source: partial.source,
        reliable: false, quotaExhausted: true, busy: false,
        details: { partial: true, readings },
      };
    }
    readings.push({ ...read, source: source.name });
  }
  if (!readings.length) throw new Error('No se encontró el ticket ni la foto de evidencia.');
  const decision = evaluateScheduledReadings(readings);
  const result = {
    status: decision.code ? 'proposed' : 'no_code',
    code: decision.code,
    aggregator: decision.aggregator,
    source: decision.source,
    reliable: decision.highConfidence,
    quotaExhausted: false, busy: false,
    details: { readings: readings.map(({ source, code, aggregator, reliable: labeled }) =>
      ({ source, code, aggregator, labeled })), conflict: decision.conflict },
  };
  checked(await db.from('order_ocr_results').upsert({
    photo_id: photoId, code: result.code, aggregator: result.aggregator, source: result.source,
    reliable: result.reliable, status: 'done', lease_until: null,
    created_at: new Date().toISOString(),
  }));
  return result;
  } catch (error) {
    await failVisionWork(photoId);
    throw error;
  }
}

async function scheduledRecovery() {
  const { data: settings, error: settingsError } = await db.from('order_recovery_settings')
    .select('enabled,start_time,mode').eq('id', true).single();
  if (settingsError) throw settingsError;
  const { day, time } = argentinaParts();
  if (!settings.enabled || time < String(settings.start_time).slice(0, 5)) return { status: 'not_due' };
  const { data: existing } = await db.from('order_recovery_runs').select('status').eq('day', day).maybeSingle();
  if (existing?.status === 'complete' || existing?.status === 'quota_exhausted') return { status: existing.status };
  checked(await db.from('order_recovery_runs').upsert(
    { day, status: 'running' }, { onConflict: 'day', ignoreDuplicates: true },
  ));
  const { data: used, error: usageError } = await db.rpc('current_order_ocr_usage');
  if (usageError) throw usageError;
  if (used >= 5500) {
    checked(await db.from('order_recovery_runs').update({ status: 'quota_exhausted' }).eq('day', day));
    return { status: 'quota_exhausted' };
  }
  const { data: claimed, error: claimError } = await db.rpc('claim_order_recovery_batch', {
    p_day: day, p_limit: 1,
  });
  if (claimError) throw claimError;
  if (!claimed?.length) {
    const { count: inFlight } = await db.from('order_recovery_items')
      .select('photo_id', { count: 'exact', head: true })
      .eq('status', 'processing').gt('lease_until', new Date().toISOString());
    if (inFlight) return { status: 'running', claimed: 0 };
    checked(await db.from('order_recovery_runs').update({
      status: 'complete', completed_at: new Date().toISOString(),
    }).eq('day', day));
    return { status: 'complete' };
  }
  for (const item of claimed) {
    const { data: currentSettings } = await db.from('order_recovery_settings')
      .select('enabled,mode').eq('id', true).single();
    if (!currentSettings?.enabled) break;
    try {
      const result = await analyzeScheduled(item.photo_id);
      if (result.busy) {
        await db.from('order_recovery_items').update({
          status: 'pending', lease_until: null, updated_at: new Date().toISOString(),
        }).eq('photo_id', item.photo_id).eq('status', 'processing');
        return { status: 'running', busy: true };
      }
      if (result.quotaExhausted && !result.code) {
        checked(await db.from('order_recovery_runs').update({ status: 'quota_exhausted' }).eq('day', day));
        return { status: 'quota_exhausted' };
      }
      let confirmed = false;
      if (result.reliable && result.code && result.aggregator && currentSettings.mode === 'auto_high') {
        const { data, error } = await db.rpc('apply_recovered_order_code', {
          p_photo_id: item.photo_id, p_expected_code: NO_CODE,
          p_code: result.code, p_aggregator: result.aggregator,
          p_kind: 'automatic', p_source: result.source, p_run_day: day,
        });
        if (error) throw error;
        confirmed = Boolean(data);
        if (confirmed) {
          try { await releaseTicket(item.photo_id); }
          catch (ticketError) { console.warn('El ticket se eliminará en la limpieza programada.', ticketError); }
        }
      }
      const latest = confirmed ? null : await getPhoto(item.photo_id);
      const status = confirmed ? 'confirmed' :
        latest?.name !== NO_CODE ? 'manual_override' : result.status;
      const savedItem = checked(await db.from('order_recovery_items').update({
        status, code: result.code, aggregator: result.aggregator, source: result.source,
        reliable: result.reliable, analyzed_at: new Date().toISOString(),
        next_attempt_at: status === 'no_code' ? new Date(Date.now() + 7 * 86400_000).toISOString() : null,
        lease_until: null, updated_at: new Date().toISOString(),
      }).eq('photo_id', item.photo_id).eq('status', 'processing').select('photo_id'));
      if (!confirmed && !savedItem.data?.length) continue;
      checked(await db.from('order_recovery_events').insert({
        photo_id: item.photo_id, run_day: day, kind: 'analyzed', source: result.source,
        new_code: result.code, new_aggregator: result.aggregator,
        details: { ...result.details, reliable: result.reliable, outcome: status },
      }));
      checked(await db.rpc('increment_order_recovery_run', { p_day: day, p_status: status }));
      if (result.quotaExhausted) {
        checked(await db.from('order_recovery_runs').update({ status: 'quota_exhausted' }).eq('day', day));
        return { status: 'quota_exhausted' };
      }
    } catch (error) {
      await db.from('order_recovery_items').update({
        status: 'error', lease_until: null,
        next_attempt_at: new Date(Date.now() + 86400_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('photo_id', item.photo_id);
      await db.from('order_recovery_events').insert({
        photo_id: item.photo_id, run_day: day, kind: 'error',
        details: { message: String(error) },
      });
      await db.from('order_recovery_runs').update({ last_error: String(error) }).eq('day', day);
      await db.rpc('increment_order_recovery_run', { p_day: day, p_status: 'error' });
    }
  }
  return { status: 'running', claimed: claimed.length };
}

async function analyze(photoId: string) {
  const photo = await getPhoto(photoId);
  if (!photo || photo.name !== NO_CODE || !photo.file_path?.startsWith('orders/')) {
    return reply({ error: 'Pedido sin código no disponible.' }, 404);
  }
  const { data: cached } = await db.from('order_ocr_results')
    .select('code,aggregator,source,reliable,status,created_at').eq('photo_id', photoId).maybeSingle();
  if (cached?.status === 'done' &&
    (cached.code || Date.now() - Date.parse(cached.created_at) < 7 * 86400_000)) {
    return reply({ ...cached, cached: true });
  }
  if (!visionKey) return reply({ code: null, unavailable: true });
  if (!await claimVisionWork(photoId)) {
    const { data: latest } = await db.from('order_ocr_results')
      .select('code,aggregator,source,reliable,status').eq('photo_id', photoId).maybeSingle();
    return reply(latest?.status === 'done' ? { ...latest, cached: true } : { code: null, busy: true });
  }

  try {
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
    if (read.exhausted) {
      if (candidate) {
        checked(await db.from('order_ocr_results').upsert({
          photo_id: photoId, ...candidate, status: 'done',
          lease_until: null, created_at: new Date().toISOString(),
        }));
      } else {
        await failVisionWork(photoId);
      }
      return reply({ code: candidate?.code || null, quotaExhausted: true });
    }
    if (read.code) candidate = { ...read, source: source.source };
    if (read.reliable) break;
  }
  const result = candidate || { code: null, source: null, reliable: false };
  checked(await db.from('order_ocr_results').upsert({
    photo_id: photoId, ...result, status: 'done',
    lease_until: null, created_at: new Date().toISOString(),
  }));
  return reply(result);
  } catch (error) {
    await failVisionWork(photoId);
    throw error;
  }
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
    if (body.action === 'scheduled') {
      if (!Deno.env.get('ORDER_RECOVERY_CRON_SECRET') ||
        request.headers.get('x-recovery-secret') !== Deno.env.get('ORDER_RECOVERY_CRON_SECRET')) {
        return reply({ error: 'No autorizado.' }, 401);
      }
      return reply(await scheduledRecovery());
    }
    const photoId = String(body.photoId || '');
    if (!photoId) return reply({ error: 'Falta el pedido.' }, 400);
    if (body.action === 'confirm' || body.action === 'correct') {
      const photo = await getPhoto(photoId);
      if (!photo) return reply({ error: 'Pedido no encontrado.' }, 404);
      const code = body.code == null ? null : String(body.code).trim().toUpperCase();
      const aggregator = body.aggregator == null ? null : String(body.aggregator);
      if ((code === null && body.action !== 'correct') ||
        (code !== null && (!VALID_CODE.test(code) ||
          (aggregator !== null && !['pedidosya', 'rappi', 'rappi_turbo', 'mercadopago'].includes(aggregator)) ||
          aggregator === null ||
          (detectAggregator(code) && detectAggregator(code) !== aggregator)))) {
        return reply({ error: 'Código o agregador inválido.' }, 400);
      }
      const { data: saved, error } = await db.rpc('apply_recovered_order_code', {
        p_photo_id: photoId, p_expected_code: String(body.expectedCode || ''),
        p_code: code, p_aggregator: aggregator,
        p_kind: body.action === 'correct' ? 'correction' : 'manual',
        p_source: body.source || null, p_run_day: null,
      });
      if (error) throw error;
      if (!saved) return reply({ error: 'El pedido cambió; actualizá la vista.' }, 409);
      if (code) {
        try { await releaseTicket(photoId); }
        catch (ticketError) { console.warn('El ticket se eliminará en la limpieza programada.', ticketError); }
      }
      return reply({ photo: await getPhoto(photoId) });
    }
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
