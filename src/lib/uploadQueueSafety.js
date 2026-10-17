function unsafe(message) { return new Error(message+' No se actualizó la app. Conservá esta pestaña abierta y no descartes las fotos.'); }

async function sameFile(original, stored, label) {
  if (!original) {
    if (stored) throw unsafe('Cambió el '+label+' guardado.');
    return;
  }
  if (!stored || !original.size || original.size !== stored.size) throw unsafe('No se pudo verificar el '+label+' completo.');
  let left, right;
  try { left = new Uint8Array(await original.arrayBuffer()); right = new Uint8Array(await stored.arrayBuffer()); }
  catch { throw unsafe('El dispositivo no permite leer el '+label+' para comprobar su respaldo.'); }
  if (left.length !== original.size || right.length !== left.length || left.some((value,index)=>value!==right[index])) throw unsafe('La copia del '+label+' no coincide con la captura.');
}

/** A missing record is never proof that a memory-only capture uploaded. */
export function canRetireMissingItem(item) {
  return !item.initialPersistPending && item.localSaveFailed !== true;
}

export async function checkpointUploadQueue(records, {put, list}) {
  for (const record of records) {
    try { await put(record); }
    catch { throw unsafe('No se pudieron guardar todas las fotos en este dispositivo. Puede faltar espacio o fallar el almacenamiento del navegador.'); }
  }
  let stored;
  try { stored = new Map((await list()).map(record=>[record.id,record])); }
  catch { throw unsafe('No se pudo comprobar la cola guardada.'); }
  // Read one pair at a time to avoid materializing the whole queue on an iPhone.
  for (const record of records) {
    const copy = stored.get(record.id);
    if (!copy || copy.status === 'done') throw unsafe('Falta una foto pendiente en el respaldo local.');
    await sameFile(record.file,copy.file,'archivo de la foto');
    await sameFile(record.ticket,copy.ticket,'archivo del ticket');
    if (copy.createdAt !== record.createdAt || copy.storagePath !== record.storagePath) throw unsafe('Cambió la información de una captura pendiente.');
  }
  return {count:records.length};
}
