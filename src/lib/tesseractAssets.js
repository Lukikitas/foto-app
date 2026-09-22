export const OCR_ENGINE_ERROR = 'No se pudo leer el ticket.';
export const OCR_CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-: #';

export const PSM = {
  OSD_ONLY: '0',
  AUTO_OSD: '1',
  AUTO_ONLY: '2',
  AUTO: '3',
  SINGLE_COLUMN: '4',
  SINGLE_BLOCK_VERT_TEXT: '5',
  SINGLE_BLOCK: '6',
  SINGLE_LINE: '7',
  SINGLE_WORD: '8',
  CIRCLE_WORD: '9',
  SINGLE_CHAR: '10',
  SPARSE_TEXT: '11',
  SPARSE_TEXT_OSD: '12',
  RAW_LINE: '13',
};

export function tessAssetUrl(relative) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  const assetPath = `${base}tesseract/${relative}`;
  const origin = globalThis.location?.origin;
  if (!origin) return assetPath;
  return new URL(assetPath, origin).href;
}

export function isAbortError(error) {
  return error?.name === 'AbortError';
}
