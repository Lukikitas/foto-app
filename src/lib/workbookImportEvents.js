const listeners = new Set();
export function subscribeWorkbookImport(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function announceWorkbookImport(result) {
  for (const listener of listeners) { try { listener(result); } catch { /* A subscriber cannot invalidate a saved import. */ } }
}

let importing = false;
export function beginWorkbookImport() {
  if (importing) throw new Error('Ya hay una importación de Excel en curso. Esperá a que termine.');
  importing = true;
  return () => { importing = false; };
}
