export function normalizeStoreName(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().trim()
    .replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-');
}

export function rappiStoreName(value) {
  return normalizeStoreName(normalizeStoreName(value).replace(/\bTURBO\b/g, ' '));
}

// An import always targets one store; never aggregate unrelated branches.
export function resolveImportStore(names, requested = '', normalize = normalizeStoreName) {
  const stores = [...new Set(names.map(normalize).filter(Boolean))];
  const selected = normalize(requested);
  if (selected) {
    if (!stores.includes(selected)) throw new Error('No se encontró el local indicado en el Excel. Revisá el nombre completo.');
    return selected;
  }
  if (stores.length > 1) throw new Error('El Excel contiene varios locales. Indicá el nombre del local antes de importar.');
  if (!stores.length) throw new Error('No se encontraron locales en el Excel.');
  return stores[0];
}
