/**
 * Divide un texto en segmentos para resaltar la búsqueda:
 * highlightParts('Pedido #4821', '482') →
 *   [{ text: 'Pedido #', match: false }, { text: '482', match: true }, ...]
 * Sin query (o sin coincidencia) devuelve un único segmento sin marcar.
 */
export function highlightParts(text, query) {
  const value = String(text ?? '');
  const needle = String(query ?? '').trim();
  if (!needle) return [{ text: value, match: false }];

  const haystack = value.toLowerCase();
  const target = needle.toLowerCase();
  const parts = [];
  let from = 0;
  let index = haystack.indexOf(target);
  if (index === -1) return [{ text: value, match: false }];

  while (index !== -1) {
    if (index > from) parts.push({ text: value.slice(from, index), match: false });
    parts.push({ text: value.slice(index, index + needle.length), match: true });
    from = index + needle.length;
    index = haystack.indexOf(target, from);
  }
  if (from < value.length) parts.push({ text: value.slice(from), match: false });
  return parts;
}
