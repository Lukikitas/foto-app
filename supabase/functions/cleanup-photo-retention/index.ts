import { createClient } from 'npm:@supabase/supabase-js@2';

// Función AUTOCONTENIDA a propósito: el editor del dashboard de Supabase (deploy
// sin CLI) solo empaqueta los archivos dentro de la carpeta de la función, así
// que no puede importar ../../../src/lib/. La lógica compartida va copiada entre
// marcadores y photoRetention.test.js la compara carácter a carácter con
// src/lib/photoRetention.js + compactCode: si algo cambia allá, el test obliga a
// sincronizar esta copia. Mantener la verificación JWT activa (el workflow envía
// Authorization: Bearer <anon> además del x-cleanup-secret).
/* RETENTION_SOURCE_START */
export function compactCode(value = '') {
  return String(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

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
/* RETENTION_SOURCE_END */

// Limpieza diaria de fotos de pedidos sin queja fuera del plazo (Ajustes →
// «Liberación de fotos»). Borra SOLO el archivo del bucket y marca la fila con
// public_url = null: la metadata queda viva para que las métricas (Desempeño de
// personal, conteos, historial) no cambien nunca. Fotos con queja/refutación o
// referenciadas por el historial o el draft activo jamás se tocan.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, x-cleanup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const url = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const EVIDENCE_BUCKET = 'photos';
// Cursor del barrido: permite avanzar más allá de las filas protegidas (que
// siguen siendo candidatas viejas) aunque una corrida no alcance a terminar.
const CURSOR_PATH = 'system/photo-retention-cursor.json';
const LEGACY_HISTORY_PATH = 'complaints/history.json';
const PAGE_SIZE = 200;
const MAX_PAGES = 60;
const BATCH = 100;
const MAX_MS = 45_000;

function isNotFound(error: { message?: string; statusCode?: string } | null) {
  return /not found|404/i.test(error?.message || String(error?.statusCode || ''));
}

async function loadSettings() {
  const { data, error } = await db.from('photo_cleanup_settings')
    .select('enabled,retention_days').eq('id', true).maybeSingle();
  // Sin la migración no hay config: fallamos en voz alta en el log del workflow.
  if (error) throw new Error(`Falta la migración photo_cleanup_settings: ${error.message}`);
  return {
    enabled: data ? Boolean(data.enabled) : true,
    retentionDays: normalizeRetentionDays(data?.retention_days),
  };
}

async function loadHistoryRefs() {
  const { data: doc, error } = await db.from('foto_app_documents')
    .select('data').eq('key', 'history').maybeSingle();
  // Un fallo de lectura NUNCA puede interpretarse como «sin historial»:
  // abortamos para no borrar fotos de quejas.
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
  if (doc?.data) return collectHistoryPhotoRefs(Object.values(doc.data.items || {}));

  const { data: file, error: fileError } = await db.storage
    .from(EVIDENCE_BUCKET).download(LEGACY_HISTORY_PATH);
  if (fileError) {
    if (isNotFound(fileError)) return collectHistoryPhotoRefs([]);
    throw new Error(`No se pudo leer el historial legado: ${fileError.message}`);
  }
  try {
    const parsed = JSON.parse(await file.text());
    return collectHistoryPhotoRefs(Object.values(parsed?.items || {}));
  } catch {
    throw new Error('El historial legado no se pudo interpretar; limpieza cancelada.');
  }
}

async function loadActiveDraft() {
  const { data, error } = await db.rpc('foto_draft_action', { action: 'read' });
  if (error) throw new Error(`No se pudo leer la lista pendiente: ${error.message}`);
  return data;
}

type Cursor = { createdAt: string; id: string };

async function loadCursor(): Promise<Cursor | null> {
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).download(CURSOR_PATH);
  if (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(await data.text());
    // Legacy cursors lacked an id: restart once to avoid skipping ties.
    return typeof parsed.createdAt === 'string' && typeof parsed.id === 'string'
      ? { createdAt: parsed.createdAt, id: parsed.id } : null;
  } catch {
    return null;
  }
}

async function saveCursor(cursor: Cursor | null) {
  const body = JSON.stringify({ ...cursor, updatedAt: new Date().toISOString() });
  const { error } = await db.storage.from(EVIDENCE_BUCKET)
    .upload(CURSOR_PATH, body, { contentType: 'application/json', upsert: true });
  if (error) throw error;
}

function candidatesQuery(cutoffIso: string, cursor: Cursor | null) {
  let query = db.from('photos')
    .select('id,file_path,name,created_at,public_url,has_complaint,is_refutado')
    .lt('created_at', cutoffIso)
    .eq('has_complaint', false)
    .eq('is_refutado', false)
    .not('public_url', 'is', null)
    .like('file_path', 'orders/%')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(PAGE_SIZE);
  if (cursor) query = query.or(
    `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
  );
  return query;
}

async function loadRelatedPaths(paths: string[]) {
  const rows=[];let cursor=null;
  if (!paths.length) return rows;
  for (;;) {
    let query=db.from('photos').select('id,file_path,name,created_at,public_url,has_complaint,is_refutado').in('file_path',[...new Set(paths)]).order('id',{ascending:true}).limit(500);
    if(cursor!==null)query=query.gt('id',cursor);
    const {data,error}=await query;if(error)throw error;if(!data?.length)break;
    rows.push(...data);cursor=data.at(-1).id;
  }
  return rows;
}

type RunOptions = { dryRun: boolean };

async function runCleanup({ dryRun }: RunOptions) {
  const started = Date.now();
  const settings = await loadSettings();
  if (!settings.enabled && !dryRun) {
    return {
      removed: 0, failed: 0, scanned: 0, hasMore: false,
      retentionDays: settings.retentionDays, disabled: true,
    };
  }

  const cutoffIso = retentionCutoffIso(settings.retentionDays);
  const historyRefs = await loadHistoryRefs();
  const activeDraft = await loadActiveDraft();
  const refs = mergePhotoRefs(historyRefs, collectDraftRefs(activeDraft));
  // El preview lee desde el principio: el dry-run debe devolver el total real.
  let cursor = dryRun ? null : await loadCursor();
  let removed = 0;
  let failed = 0;
  let scanned = 0;
  let candidates = 0;
  let finished = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (Date.now() - started > MAX_MS) break;
    const { data, error } = await candidatesQuery(cutoffIso, cursor);
    if (error) throw error;
    const batch = data || [];
    scanned += batch.length;

    if (batch.length === 0) {
      // Fin del barrido: reiniciamos el cursor para re chequear las filas
      // protegidas (p. ej. una queja deshecha) en la próxima pasada.
      if (!dryRun) await saveCursor(null);
      finished = true;
      break;
    }

    const currentRefs = dryRun ? refs : mergePhotoRefs(await loadHistoryRefs(), collectDraftRefs(await loadActiveDraft()));
    const related = await loadRelatedPaths(batch.map(photo=>photo.file_path));
    const safeIds = new Set(safePhotoCleanupCandidates(related,{cutoffIso,refs:currentRefs}).map(photo=>photo.id));
    const eligible = batch.filter(photo=>safeIds.has(photo.id));
    candidates += eligible.length;

    if (!dryRun && eligible.length > 0) {
      for (let index = 0; index < eligible.length; index += BATCH) {
        const chunk = eligible.slice(index, index + BATCH);
        const { data: fresh, error: freshError } = await db.from('photos')
          .select('id,file_path,name,created_at,public_url,has_complaint,is_refutado')
          .in('id', chunk.map(photo => photo.id));
        if (freshError) throw freshError;
        const original = new Map(chunk.map(photo => [photo.id, photo]));
        const relatedFresh = await loadRelatedPaths((fresh || []).map(photo=>photo.file_path));
        const latestRefs = mergePhotoRefs(await loadHistoryRefs(),collectDraftRefs(await loadActiveDraft()));
        const safeFreshIds = new Set(safePhotoCleanupCandidates(relatedFresh,{cutoffIso,refs:latestRefs}).map(photo=>photo.id));
        const safe = (fresh || []).filter(photo =>
          safeFreshIds.has(photo.id) &&
          isRetentionCandidate(photo, { cutoffIso, refs: currentRefs }) &&
          original.get(photo.id)?.file_path === photo.file_path &&
          original.get(photo.id)?.public_url === photo.public_url,
        );
        if (!safe.length) continue;
        const { error: removeError } = await db.storage.from(EVIDENCE_BUCKET)
          .remove(safe.map((photo) => photo.file_path));
        if (removeError) { failed += safe.length; continue; }
        // Si la marca falla, la fila sigue publicada: el próximo intento repite
        // el remove (idempotente) y vuelve a intentar la marca.
        for (const photo of safe) {
          const { data: updated, error: updateError } = await db.from('photos')
            .update({ public_url: null }).eq('id', photo.id)
            .eq('file_path', photo.file_path).eq('public_url', photo.public_url).select('id');
          if (updateError) failed += 1;
          else removed += updated?.length || 0;
        }
      }
    }

    const last = batch[batch.length - 1];
    cursor = { createdAt: last.created_at, id: String(last.id) };
    if (!dryRun) await saveCursor(cursor);
    // Request an empty page to establish the end even if Max rows < PAGE_SIZE.
  }
  // Si salimos por tiempo o por el tope de páginas, queda trabajo pendiente.
  const hasMore = !finished;

  if (!dryRun) {
    try {
      const { error } = await db.from('photo_cleanup_settings')
        .update({ last_run_at: new Date().toISOString(), last_removed: removed })
        .eq('id', true);
      if (error) console.error('cleanup-photo-retention: stats', error);
    } catch (statsError) {
      console.error('cleanup-photo-retention: stats', statsError);
    }
  }

  return {
    removed,
    failed,
    scanned,
    candidates,
    hasMore,
    retentionDays: settings.retentionDays,
    dryRun,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const body = await request.json().catch(() => ({}));
    const secret = Deno.env.get('PHOTO_CLEANUP_SECRET');
    if (!secret || request.headers.get('x-cleanup-secret') !== secret) {
      return reply({ error: 'No autorizado.' }, 401);
    }
    if (body.action !== 'cleanup' && body.action !== 'dry-run') {
      return reply({ error: 'Acción desconocida.' }, 400);
    }
    return reply(await runCleanup({ dryRun: body.action === 'dry-run' }));
  } catch (error) {
    console.error('cleanup-photo-retention:', error);
    const message = error instanceof Error
      ? error.message
      : 'No se pudo procesar la solicitud.';
    return reply({ error: message }, 500);
  }
});
