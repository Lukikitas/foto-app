import { createClient } from 'npm:@supabase/supabase-js@2';
import { captureOrderFromOcr } from '../../../src/lib/captureOcr.js';

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const base = Deno.env.get('SUPABASE_URL') || '';
const db = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 40_000) return reply({ error: 'Solicitud demasiado grande.' }, 413);
    const body = JSON.parse(raw);
    const id = String(body.captureId || '').toLowerCase();
    const author = String(body.takenBy || '').trim();
    const capturedAt = String(body.capturedAt || '');
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
        || !author || author.length > 120 || !Number.isFinite(Date.parse(capturedAt))) {
      return reply({ error: 'Datos de captura inválidos.' }, 400);
    }
    // Reuse the exact parsing/validation rules used by the web. ML Kit sends
    // on-device OCR text; this does not invoke a paid cloud OCR provider.
    const order = captureOrderFromOcr(body);
    const path = `orders/mobile/${id}.jpg`;
    const publicUrl = `${base}/storage/v1/object/public/photos/${path}`;
    const { data, error } = await db.rpc('register_photo_capture', {
      p_capture_id: id, p_file_path: path, p_public_url: publicUrl,
      p_name: order?.displayCode || 'Código no encontrado', p_taken_by: author,
      p_aggregator: order?.aggregator || null, p_captured_at: capturedAt,
    });
    if (error) {
      console.error('capture-sync registration', error.code);
      return reply({ error: 'No se pudo confirmar la captura.' }, error.code === '22023' ? 400 : 503);
    }
    const photo = Array.isArray(data) ? data[0] : data;
    if (!photo?.id) return reply({ error: 'El servidor no confirmó el registro.' }, 503);
    return reply({ photo });
  } catch (error) {
    if (error instanceof SyntaxError) return reply({ error: 'Solicitud inválida.' }, 400);
    console.error('capture-sync failed');
    return reply({ error: 'No se pudo confirmar la captura.' }, 503);
  }
});
