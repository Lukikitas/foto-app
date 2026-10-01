// Supabase (PostgREST) devuelve como máximo «Max rows» por consulta — 1000
// por defecto en los proyectos nuevos. Quien pide muchas filas sin paginar
// recibe silenciosamente las primeras N y se cree que son todas.
export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Recorre una query en páginas de `pageSize` hasta agotar los resultados o
 * llegar a `maxRows`. `buildQuery` debe construir la query nueva en cada
 * página (los builders de supabase no se pueden reutilizar después de esperar).
 *
 * `onPage(rows)` se invoca con el acumulado (deduplicado) después de cada
 * bloque recibido: permite pintar la primera tira de datos al instante y seguir
 * cargando el resto en segundo plano sin esperar a agotar `maxRows`.
 *
 * Nota: si el proyecto tiene «Max rows» configurado por debajo de `pageSize`,
 * cada página viene cortada y se detiene igual que antes del paginado (nunca
 * peor que el comportamiento anterior).
 */
export async function fetchAllPages(
  buildQuery,
  { pageSize = DEFAULT_PAGE_SIZE, maxRows = Infinity, maxPages = 1000, onPage } = {},
) {
  const rows = [];
  const seen = new Set();
  let from = 0;
  for (let page = 0; page < maxPages && rows.length < maxRows; page += 1) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = Array.isArray(data) ? data : [];
    // Si llega una foto nueva mientras paginamos, puede repetirse en el corte:
    // se deduplica por id para no romper las claves de React.
    for (const row of chunk) {
      if (row?.id != null) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      rows.push(row);
    }
    if (onPage) onPage(rows.slice());
    if (chunk.length < pageSize) break;
    from += chunk.length;
  }
  return rows.length > maxRows ? rows.slice(0, maxRows) : rows;
}
