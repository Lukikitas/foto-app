import { createClient } from 'npm:@supabase/supabase-js@2';
import { renderThumbnail } from './thumbnail.ts';
Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('PHOTO_THUMBNAIL_SECRET');
  if (!secret || request.headers.get('x-thumbnail-secret') !== secret) return new Response('Forbidden', { status: 403 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: garbage, error: gcError } = await db.from('foto_thumbnail_gc').select('path').limit(20);
  if (gcError) return Response.json({ error: gcError.message }, { status: 500 });
  if (garbage?.length) {
    const paths = garbage.map(row => row.path).filter(path => path.startsWith('thumbnails/'));
    const { error } = await db.storage.from('photos').remove(paths);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const removed = await db.from('foto_thumbnail_gc').delete().in('path',paths);
    if (removed.error) return Response.json({ error: removed.error.message }, { status: 500 });
  }
  const { data: job, error } = await db.rpc('foto_claim_thumbnail');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!job) return Response.json({ idle: true });
  const path = `thumbnails/${job.photo_id}/${job.lease_token}.jpg`;
  try {
    const { data: original, error: readError } = await db.storage.from('photos').download(job.source_path);
    if (readError) throw readError;
    if (!original || original.size > 10 * 1024 * 1024) throw new Error('La imagen excede el límite de procesamiento de miniaturas.');
    const result = await renderThumbnail(new Uint8Array(await original.arrayBuffer()));
    const uploaded = await db.storage.from('photos').upload(path,result,{ contentType:'image/jpeg',cacheControl:'31536000',upsert:true });
    if (uploaded.error) throw uploaded.error;
    const finished = await db.rpc('foto_finish_thumbnail',{photo_id:job.photo_id,token:job.lease_token,thumbnail:path});
    if (finished.error) throw finished.error;
    if (!finished.data) await db.storage.from('photos').remove([path]);
    return Response.json({ processed:true,attached:finished.data });
  } catch (failure) {
    await db.rpc('foto_finish_thumbnail',{photo_id:job.photo_id,token:job.lease_token,failure:failure instanceof Error ? failure.message : 'Error de miniatura'});
    await db.storage.from('photos').remove([path]);
    return Response.json({ processed:false }, { status: 500 });
  }
});
