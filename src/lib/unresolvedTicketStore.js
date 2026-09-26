const DB_NAME = 'foto-app-unresolved-tickets';
const STORE_NAME = 'tickets';
const TICKET_TTL_MS = 72 * 60 * 60 * 1000;
const isExpired = (record, now = Date.now()) =>
  !Number.isFinite(record?.savedAt) || now - record.savedAt >= TICKET_TTL_MS;
const memoryTickets = new Map();
let dbPromise = null;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completeTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('No se pudo conservar el ticket.'));
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export async function saveUnresolvedTicket(photoId, ticketFile) {
  if (!photoId || !ticketFile) throw new Error('No se pudo conservar el ticket.');
  const record = {
    id: String(photoId),
    ticket: ticketFile,
    name: ticketFile.name || 'ticket.jpg',
    type: ticketFile.type || 'image/jpeg',
    savedAt: Date.now(),
  };
  if (typeof indexedDB === 'undefined') {
    memoryTickets.set(record.id, record);
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const done = completeTransaction(tx);
  tx.objectStore(STORE_NAME).put(record);
  await done;
}

export async function hasUnresolvedTicket(photoId) {
  if (!photoId) return false;
  if (typeof indexedDB === 'undefined') {
    const record = memoryTickets.get(String(photoId));
    if (record && isExpired(record)) {
      memoryTickets.delete(String(photoId));
      return false;
    }
    return Boolean(record);
  }
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const done = completeTransaction(tx);
  const store = tx.objectStore(STORE_NAME);
  const record = await requestResult(store.get(String(photoId)));
  await done;
  if (record && isExpired(record)) {
    await deleteUnresolvedTicket(photoId);
    return false;
  }
  return Boolean(record);
}

export async function getUnresolvedTicket(photoId) {
  if (!photoId) return null;
  let record;
  if (typeof indexedDB === 'undefined') {
    record = memoryTickets.get(String(photoId));
  } else {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const done = completeTransaction(tx);
    record = await requestResult(tx.objectStore(STORE_NAME).get(String(photoId)));
    await done;
  }
  if (!record?.ticket) return null;
  if (isExpired(record)) {
    await deleteUnresolvedTicket(photoId);
    return null;
  }
  if (typeof File === 'function') {
    return new File([record.ticket], record.name, { type: record.type });
  }
  return record.ticket;
}

export async function deleteUnresolvedTicket(photoId) {
  if (!photoId) return;
  if (typeof indexedDB === 'undefined') {
    memoryTickets.delete(String(photoId));
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const done = completeTransaction(tx);
  tx.objectStore(STORE_NAME).delete(String(photoId));
  await done;
}

export async function purgeExpiredUnresolvedTickets(now = Date.now()) {
  if (typeof indexedDB === 'undefined') {
    for (const [id, record] of memoryTickets) {
      if (isExpired(record, now)) memoryTickets.delete(id);
    }
    return;
  }
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const done = completeTransaction(tx);
  const store = tx.objectStore(STORE_NAME);
  const records = await requestResult(store.getAll());
  for (const record of records) {
    if (isExpired(record, now)) store.delete(record.id);
  }
  await done;
}
