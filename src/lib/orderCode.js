function normalizeOcrText(value = '') {
  return value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts the full code printed after "Código Ped.". */
export function detectOrderCode(ocrText) {
  const text = normalizeOcrText(ocrText);
  const match = text.match(
    /C[O0]D[I1L]G[O0](?:\s+PED(?:IDO)?)?[^0-9]{0,12}(\d[\d\s-]{2,24})/,
  );

  if (!match) return null;

  if (match[1].replace(/\D/g, '').length < 4) return null;

  const displayCode = match[1]
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '');

  return { displayCode };
}
