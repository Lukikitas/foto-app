import { supabase } from './supabase.js';
import { measurePerformance, recordPerformance } from './performanceMetrics.js';
import { withRequestTimeout } from './requestTimeout.js';

export async function readPage(rpc, filters, { page = 1, pageSize = 30, asOf, signal } = {}) {
  return measurePerformance(rpc, () => withRequestTimeout(async requestSignal => {
    let query = supabase.rpc(rpc, { filters, page, page_size: pageSize, ...(asOf ? { as_of: asOf } : {}) });
    query = query.abortSignal(requestSignal);
    const { data, error } = await query;
    if (signal?.aborted) throw new DOMException('Interrumpido', 'AbortError');
    if (error) throw new Error(['PGRST202','42883'].includes(error.code) ? 'Falta activar la migración de rendimiento. Los datos se conservan; actualizá la base antes de usar esta versión.' : error.message);
    if (!Array.isArray(data?.items)) throw new Error('El servidor no devolvió una página válida.');
    recordPerformance(`${rpc}.payload`, 0, { rows: data.items.length, bytes: JSON.stringify(data).length });
    return data;
  }, { signal }));
}

export async function readAllHistory(filters, { signal } = {}) {
  const items = [];
  let revision;
  for (let page = 1; ; page++) {
    const result = await readPage('foto_history_page', filters, { page, pageSize: 100, signal });
    if (revision !== undefined && result.revision !== revision) throw new Error('El historial cambió durante la exportación. Volvé a intentar para obtener una copia completa.');
    revision = result.revision;
    items.push(...result.items);
    if (items.length >= result.total) return items;
    if (!result.items.length || result.page !== page) throw new Error('La consulta cambió durante la exportación. Volvé a intentar.');
  }
}
