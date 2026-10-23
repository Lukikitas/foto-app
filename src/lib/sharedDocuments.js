import { supabase } from './supabase.js';
import { withRequestTimeout } from './requestTimeout.js';
const baselines = new WeakMap();
const paths = { history: 'complaints/history.json', metrics: 'metrics/dashboard.json' };
const reads = new Map();
const verified = new Map();
let conditionalSupported = true;
function rememberDocument(key, document) {
  const current = verified.get(key);
  if (current && current.revision > document.revision) return current;
  verified.set(key, document);
  return document;
}
export function sharedError(error) {
  if (['PGRST202','42P01'].includes(error?.code) || /Could not find the function.*foto_|schema cache.*foto_/i.test(error?.message || '')) {
    return new Error('Falta activar la actualización 1.5 de la base de datos. No se guardaron cambios.');
  }
  return new Error(error?.message || 'No se pudieron guardar los cambios compartidos.');
}
export function trackDocument(value, document) { baselines.set(value, document); return value; }
export function documentBaseline(value) { return baselines.get(value); }
export async function readDocument(key, empty) {
  if (reads.has(key)) return reads.get(key);
  const request = readFreshDocument(key, empty).finally(() => reads.delete(key));
  reads.set(key, request);
  return request;
}
async function readFreshDocument(key, empty) {
  if (conditionalSupported) {
    const previous = verified.get(key);
    const result = await withRequestTimeout(signal=>supabase.rpc('foto_document_read_if_changed', { document_key: key, known_revision: previous?.revision ?? null }).abortSignal(signal));
    if (!result.error) {
      if (result.data?.unchanged && previous) return verified.get(key) || previous;
      if (result.data?.data) return rememberDocument(key, result.data);
    } else if (['PGRST202', '42883'].includes(result.error.code)) conditionalSupported = false;
    else throw sharedError(result.error);
  }
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
  return data ? rememberDocument(key,data) : data;
}
export async function commitDocuments(changes, options = {}) {
  const { data, error } = await supabase.rpc('foto_documents_commit', { changes, ...options });
  if (error) throw sharedError(error);
  for (const document of data?.documents || []) rememberDocument(document.key, document);
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
