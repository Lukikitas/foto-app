import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, x-session-id, x-token-hash, x-storage-path, x-content-sha256',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = 'native-captures';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_HASH = /^[0-9a-f]{64}$/i;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function validatePath(sessionId: string, storagePath: string) {
  const escaped = sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}/[1-9]\\d*/(?:ticket|evidence)\\.jpg$`).test(storagePath);
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  const sessionId = request.headers.get('x-session-id')?.trim() || '';
  const tokenHash = request.headers.get('x-token-hash')?.trim().toLowerCase() || '';
  const storagePath = request.headers.get('x-storage-path')?.trim() || '';

  if (!UUID.test(sessionId) || !TOKEN_HASH.test(tokenHash) || !validatePath(sessionId, storagePath)) {
    return json({ error: 'Solicitud de transferencia inválida.' }, 400);
  }

  const { data: session, error: sessionError } = await db
    .from('native_capture_sessions')
    .select('id, state, expires_at')
    .eq('id', sessionId)
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (sessionError || !session) return json({ error: 'Sesión no autorizada.' }, 401);

  // Both upload and recovery use the two-hour deadline from session creation.
  if (request.method === 'POST') {
    const uploadDeadline = new Date(session.expires_at).getTime();
    if (uploadDeadline <= Date.now()) {
      return json({ error: 'El plazo para subir nuevas capturas expiró.' }, 410);
    }

    if (!['active', 'finishing'].includes(session.state)) {
      return json({ error: 'La sesión no acepta más archivos.' }, 409);
    }

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_FILE_BYTES) return json({ error: 'El archivo supera el límite permitido.' }, 413);

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) return json({ error: 'Tamaño de archivo inválido.' }, 413);

    const expectedHash = request.headers.get('x-content-sha256')?.trim().toLowerCase();
    if (expectedHash && (!TOKEN_HASH.test(expectedHash) || await sha256Hex(bytes) !== expectedHash)) {
      return json({ error: 'La verificación de integridad del archivo falló.' }, 422);
    }

    const { error } = await db.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ path: storagePath });
  }

  // DELETE: cleanup temporary storage only after confirmed final publication
  if (request.method === 'DELETE') {
    const { error } = await db.storage.from(BUCKET).remove([storagePath]);
    if (error) return json({ error: error.message }, 500);
    return json({ deleted: true, path: storagePath });
  }

  // GET: the same fixed deadline applies to transferring a saved capture.
  const recoveryDeadline = new Date(session.expires_at).getTime();
  if (recoveryDeadline <= Date.now()) {
    return json({ error: 'El plazo de recuperación de archivos expiró.' }, 410);
  }

  const { data, error } = await db.storage.from(BUCKET).download(storagePath);
  if (error || !data) return json({ error: error?.message || 'Archivo no encontrado.' }, 404);

  return new Response(data, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': data.type || 'image/jpeg',
      'Cache-Control': 'private, no-store',
    },
  });
});
