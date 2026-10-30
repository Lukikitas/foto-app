import { recordReliability } from './reliabilityDiagnostics.js';

let database;
let testBackend;
async function db() {
  if (!globalThis.indexedDB) throw new Error('Este navegador no permite guardar las capturas.');
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('foto-app-capture-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null; };
      resolve(request.result);
    };
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

async function transaction(mode, operation) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction('drafts', mode);
    const request = operation(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || new Error('No se pudo guardar la captura.'));
    tx.onabort = () => reject(tx.error || new Error('No se pudo guardar la captura.'));
  });
}

export async function saveCaptureDraft(draft) {
  if (!draft?.id || !draft.ticketFile?.size) throw new Error('Falta el ticket para guardar el borrador.');
  try {
    const { id, createdAt, ticketFile, evidenceFile, meta } = draft;
    const record = { id, createdAt, ticketFile, evidenceFile: evidenceFile || null, meta };
    if (testBackend) await testBackend.put(record);
    else await transaction('readwrite', store => store.put(record));
    recordReliability('capture.saved');
  } catch (error) { recordReliability('capture.failed'); throw error; }
}
export async function getCaptureDraft(id) {
  return testBackend ? testBackend.get(id) : transaction('readonly', store => store.get(id));
}
export async function deleteCaptureDraft(id) {
  return testBackend ? testBackend.delete(id) : transaction('readwrite', store => store.delete(id));
}
export async function listCaptureDraftIds() {
  return testBackend ? testBackend.keys() : transaction('readonly', store => store.getAllKeys());
}
export function setCaptureDraftStoreForTests(backend) { testBackend = backend; }

// A draft is removed only after the upload queue has acknowledged its durable
// copy. A crash between the two writes is safe because queue IDs are stable.
export async function commitCaptureDraft(id, enqueue) {
  const draft = await getCaptureDraft(id);
  if (!draft?.evidenceFile) return false;
  await enqueue({ id: draft.id, file: draft.evidenceFile, ticketFile: draft.ticketFile,
    createdAt: draft.createdAt, kind: 'order', meta: draft.meta });
  await deleteCaptureDraft(id);
  return true;
}

export async function recoverCompletedCaptureDrafts(enqueue) {
  for (const id of await listCaptureDraftIds()) await commitCaptureDraft(id, enqueue);
}
