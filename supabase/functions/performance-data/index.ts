import { createClient } from 'npm:@supabase/supabase-js@2';
import { performanceView } from '../../../src/lib/performanceViews.js';
import { listHistoryItems, parseHistory } from '../../../src/lib/complaintHistory.js';
import { compactCode } from '../../../src/lib/complaintMatch.js';

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return Response.json({ error: 'Método inválido' }, { status: 405, headers });
  try {
    const { view, from, to, aggregator = 'all', preset = '' } = await request.json();
    if (!['overview','staff','report','complaints','pending'].includes(view) || !/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to ||
      !['all','pedidosya','rappi','rappi_turbo','mercadopago'].includes(aggregator)) return Response.json({ error: 'Período inválido' }, { status: 400, headers });
    // Use the caller's existing permissions; this endpoint never uses service_role.
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: request.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const documents = await Promise.all(['metrics','history'].map(async document_key => {
      const { data, error } = await db.rpc('foto_document_read', { document_key });
      if (error) throw error;
      return data?.data;
    }));
    const [metrics, history] = documents;
    const photos: Record<string, unknown>[] = [];
    const extras = new Map<string, Record<string, unknown>>();
    const columns = 'id,name,file_path,public_url,created_at,taken_by,has_complaint,is_refutado,aggregator';
    if (view === 'staff') {
      // Read metadata in bounded pages on the server, never full image files.
      let cursor: { created_at: string; id: string } | null = null;
      for (;;) {
        const nextDay = new Date(Date.parse(`${to}T00:00:00Z`)+86400000).toISOString().slice(0,10);
        let query = db.from('photos').select(columns).gte('created_at', `${from}T00:00:00-03:00`).lt('created_at', `${nextDay}T00:00:00-03:00`)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000);
        if (aggregator !== 'all') query = query.eq('aggregator', aggregator);
        if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
        const { data, error } = await query;
        if (error) throw error;
        photos.push(...(data || []));
        if (!data?.length || data.length < 1000) break;
        cursor = data.at(-1)!;
      }
      const items = listHistoryItems(parseHistory(history), { from, to, aggregator });
      const ids = new Set(photos.map(photo => photo.id));
      const codes = new Set(photos.map(photo => compactCode(String(photo.name || ''))));
      const missingIds = [...new Set(items.map(item => item.photoId).filter(id => id && !ids.has(id)))];
      for (let n = 0; n < missingIds.length; n += 50) {
        const { data, error } = await db.from('photos').select(columns).in('id', missingIds.slice(n,n+50));
        if (error) throw error;
        for (const photo of data || []) extras.set(photo.id,photo);
      }
      const tokens = new Set<string>();
      for (const item of items) {
        const name = compactCode(item.photoName || '');
        const token = name && !codes.has(name) ? name : item.photoId && !ids.has(item.photoId) ? compactCode(item.orderCode) : '';
        if (token.length >= 4) { tokens.add(token); const digits = token.replace(/\D/g,''); if (digits.length>=4) tokens.add(digits); }
      }
      const list = [...tokens];
      for (let n=0;n<list.length;n+=20) {
        for (let offset=0;offset<2000;offset+=1000) {
          const { data,error } = await db.from('photos').select(columns).or(list.slice(n,n+20).map(token => `name.ilike.%${token}%`).join(','))
            .order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999);
          if (error) throw error;
          for (const photo of data || []) if (!photo.file_path?.startsWith('files/')) extras.set(photo.id,photo);
          if (!data || data.length<1000) break;
        }
      }
    }
    return Response.json(performanceView({ view, metrics, history, from, to, aggregator, preset, photos, extraPhotos: [...extras.values()] }), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudieron consultar los datos actuales.' }, { status: 500, headers });
  }
});
