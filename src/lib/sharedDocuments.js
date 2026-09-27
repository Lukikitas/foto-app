import { supabase } from './supabase.js';
const baselines = new WeakMap();
const paths = { history: 'complaints/history.json', metrics: 'metrics/dashboard.json' };
export function sharedError(error) {
  if (['PGRST202','42P01'].includes(error?.code) || /Could not find the function.*foto_|schema cache.*foto_/i.test(error?.message || '')) {
    return new Error('Falta activar la actualización 1.5 de la base de datos. No se guardaron cambios.');
  }
  return new Error(error?.message || 'No se pudieron guardar los cambios compartidos.');
}
export function trackDocument(value, document) { baselines.set(value, document); return value; }
export function documentBaseline(value) { return baselines.get(value); }
export async function readDocument(key, empty) {
  let { data, error } = await supabase.rpc('foto_document_read', { document_key: key });
  if (error) throw sharedError(error);
  if (!data) {
    const legacy = await supabase.storage.from('photos').download(paths[key]);
    let initial = empty();
    if (legacy.error) {
      if (!/not found|404/i.test(legacy.error.message || String(legacy.error.statusCode))) throw sharedError(legacy.error);
    } else initial = JSON.parse(await legacy.data.text());
    ({ data, error } = await supabase.rpc('foto_document_read', { document_key: key, initial_data: initial }));
    if (error) throw sharedError(error);
  }
  return data;
}
export async function commitDocuments(changes, options = {}) {
  const { data, error } = await supabase.rpc('foto_documents_commit', { changes, ...options });
  if (error) throw sharedError(error);
  return data;
}
export async function mutateDocument(key, empty, parse, mutator) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readDocument(key, empty);
    const result = mutator(parse(current.data));
    const data = result?.store || result;
    try {
      const saved = await commitDocuments([{ key, revision: current.revision, data }]);
      const document = saved.documents[0];
      const store = trackDocument(parse(document.data), document);
      return result?.store ? { ...result, store } : store;
    } catch (error) {
      if (!error.message.includes('REVISION_CONFLICT') || attempt === 3) throw error;
    }
  }
}
