import { supabase } from './supabase.js';
import {
  collectDraftRefs, collectHistoryPhotoRefs, mergePhotoRefs, retentionCutoffIso,
} from './photoRetention.js';
import { cleanupCandidates, cleanupDateCutoffIso, executePhotoCleanup } from './photoCleanup.js';

const COLUMNS = 'id,file_path,name,created_at,public_url,has_complaint,is_refutado';

export async function loadCleanupRefs() {
  // Read authoritative data; a cached history can miss a recently opened claim.
  const { data: doc, error } = await supabase.rpc('foto_document_read', { document_key: 'history' });
  if (error) throw error;
  let history = doc?.data;
  if (!history) {
    const legacy = await supabase.storage.from('photos').download('complaints/history.json');
    if (legacy.error && !/not found|404/i.test(legacy.error.message || String(legacy.error.statusCode))) {
      throw legacy.error;
    }
    history = legacy.data ? JSON.parse(await legacy.data.text()) : { items: {} };
  }
  const { data: draft, error: draftError } = await supabase.rpc('foto_draft_action', { action: 'read' });
  if (draftError) throw draftError;
  return mergePhotoRefs(
    collectHistoryPhotoRefs(Object.values(history.items || {})), collectDraftRefs(draft),
  );
}

async function loadPhotos(ids) {
  const { data, error } = await supabase.from('photos').select(COLUMNS).in('id', ids);
  if (error) throw error;
  return data || [];
}

export async function previewPhotoCleanup({ dateTo, days = 30, now = new Date() } = {}) {
  const cutoffIso = dateTo !== undefined ? cleanupDateCutoffIso(dateTo) : retentionCutoffIso(days, now);
  const refs = await loadCleanupRefs();
  const photos = [];
  {
    // Keyset pagination has no gallery limit and handles equal timestamps.
    let cursor = null;
    for (;;) {
      let query = supabase.from('photos').select(COLUMNS)
        .like('file_path', 'orders/%').not('public_url', 'is', null)
        .order('id', { ascending: true }).limit(500);
      if (cursor !== null) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) break;
      photos.push(...data);
      cursor = data[data.length - 1].id;
    }
  }
  const eligible = cleanupCandidates(photos, { cutoffIso, refs });
  return { photos: eligible, cutoffIso, dateTo, excluded: photos.length - eligible.length };
}

export async function removePhotoFiles(preview, onProgress) {
  return executePhotoCleanup(preview, {
    loadRefs: loadCleanupRefs,
    loadPhotos,
    loadRelated: loadCleanupRelated,
    async removeFiles(paths) {
      const { error } = await supabase.storage.from('photos').remove(paths);
      if (error) throw error;
    },
    async clearUrls(photos) {
      const updated = [];
      // Guard against a concurrent replacement: do not clear its new URL.
      for (let start = 0; start < photos.length; start += 10) {
        const responses = await Promise.allSettled(photos.slice(start, start + 10).map(photo =>
          supabase.from('photos').update({ public_url: null })
            .eq('id', photo.id).eq('file_path', photo.file_path).eq('public_url', photo.public_url)
            .select(),
        ));
        for (const response of responses) {
          if (response.status === 'fulfilled' && !response.value.error) {
            updated.push(...response.value.data || []);
          }
        }
      }
      return updated;
    },
  }, onProgress);
}

async function loadCleanupRelated(paths) {
  const rows=[]; let cursor=null;
  for (;;) {
    let query=supabase.from('photos').select(COLUMNS).in('file_path',[...new Set(paths)]).order('id',{ascending:true}).limit(500);
    if(cursor!==null)query=query.gt('id',cursor);
    const {data,error}=await query;if(error)throw error;if(!data?.length)break;
    rows.push(...data);cursor=data.at(-1).id;
  }
  return rows;
}
