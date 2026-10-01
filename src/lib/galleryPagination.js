// Paginación de la galería: la lista completa queda en memoria (traída en
// bloques) y se pinta de a GALLERY_PAGE_SIZE tarjetas para no renderizar
// hasta 1000 PhotoCard de golpe.
export const GALLERY_PAGE_SIZE = 100;

export function galleryPageCount(total, pageSize = GALLERY_PAGE_SIZE) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : GALLERY_PAGE_SIZE;
  const count = Number(total) > 0 ? Math.ceil(Number(total) / size) : 0;
  return Math.max(1, count);
}

export function clampPage(page, total, pageSize = GALLERY_PAGE_SIZE) {
  const pages = galleryPageCount(total, pageSize);
  const value = Math.floor(Number(page));
  const current = Number.isFinite(value) ? value : 1;
  return Math.min(Math.max(1, current), pages);
}

/**
 * Ventana de la página pedida. `page` fuera de rango se recorta (p. ej. si en
 * vivo borraron todo lo de la última página) para que el render nunca quede
 * vacío por un índice inválido.
 */
export function galleryPage(items = [], page, pageSize = GALLERY_PAGE_SIZE) {
  const current = clampPage(page, items.length, pageSize);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    pageCount: galleryPageCount(items.length, pageSize),
    total: items.length,
    start,
    items: items.slice(start, start + pageSize),
  };
}

/**
 * Números a mostrar en el paginador con saltos («1 … 4 5 6 … 12»).
 * `edge` conserva los extremos y `around` los vecinos de la página actual;
 * si todo entra junto no se insertan guiones.
 */
export function pageNumbers(page, pages, { edge = 1, around = 1 } = {}) {
  const total = Math.max(1, Math.floor(Number(pages)) || 1);
  const current = Math.min(Math.max(1, Math.floor(Number(page)) || 1), total);

  const wanted = new Set();
  for (let i = 1; i <= edge; i += 1) {
    wanted.add(i);
    wanted.add(total - i + 1);
  }
  for (let i = current - around; i <= current + around; i += 1) {
    if (i >= 1 && i <= total) wanted.add(i);
  }

  const sorted = [...wanted].sort((a, b) => a - b);
  const result = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) result.push('…');
    result.push(value);
    previous = value;
  }
  return result;
}
