const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/zip': 'zip',
};

const photoBlobCache = new Map();

export function fileExtensionFromName(value = '') {
  const clean = String(value || '').split('?')[0].split('#')[0];
  const parts = clean.split('.');
  if (parts.length <= 1) return '';
  const ext = parts.pop()?.toLowerCase().trim();
  if (ext && /^[a-z0-9]{1,10}$/.test(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return '';
}

export function extensionFromMime(mime = '') {
  if (!mime) return '';
  const clean = String(mime).toLowerCase().split(';')[0].trim();
  return MIME_TO_EXT[clean] || '';
}

function later(fn, ms) {
  const timer = typeof window !== 'undefined' ? window.setTimeout : setTimeout;
  return timer(fn, ms);
}

export function uniqueDownloadFilename(filename, usedNames = new Set()) {
  const safe = String(filename || 'archivo')
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim() || 'archivo';

  const dot = safe.lastIndexOf('.');
  const base = dot === -1 ? safe : safe.slice(0, dot);
  const ext = dot === -1 ? '' : safe.slice(dot);
  let next = safe;
  let counter = 2;

  while (usedNames.has(next)) {
    next = `${base}-${counter}${ext}`;
    counter += 1;
  }

  usedNames.add(next);
  return next;
}

export function getDownloadFilename(photo, usedNames = new Set()) {
  const rawName = String(photo?.name || 'archivo').trim();
  const rawExt = fileExtensionFromName(rawName);

  const ext =
    rawExt ||
    fileExtensionFromName(photo?.file_path) ||
    fileExtensionFromName(photo?.public_url) ||
    extensionFromMime(photo?.mime_type) ||
    'jpg';

  let baseName = rawName;
  if (rawExt) {
    baseName = rawName.slice(0, -(rawExt.length + 1));
  }

  const safeBase = String(baseName || 'archivo')
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim() || 'archivo';

  return uniqueDownloadFilename(`${safeBase}.${ext}`, usedNames);
}

export function cachedPhotoBlob(url) {
  return photoBlobCache.get(url) || null;
}

export async function fetchPhotoBlob(url) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error('No se pudo descargar la foto');
  return response.blob();
}

export async function prefetchPhotoBlob(url) {
  if (!url) return null;
  if (photoBlobCache.has(url)) return photoBlobCache.get(url);
  try {
    const blob = await fetchPhotoBlob(url);
    photoBlobCache.set(url, blob);
    return blob;
  } catch {
    return null;
  }
}

export function triggerBlobDownload(blob, filename) {
  if (!blob || typeof document === 'undefined') return false;
  if (typeof navigator !== 'undefined' && typeof navigator.msSaveOrOpenBlob === 'function') {
    navigator.msSaveOrOpenBlob(blob, filename);
    return true;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename || 'evidencia.jpg';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  later(() => {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }, 10000);
  return true;
}

export function triggerUrlDownload(url, filename) {
  if (!url || typeof document === 'undefined') return false;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'evidencia.jpg';
  link.target = '_blank';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  later(() => link.remove(), 2000);
  return true;
}

function ensureExtensionFromBlob(filename, blob) {
  if (!blob?.type) return filename;
  const mimeExt = extensionFromMime(blob.type);
  if (mimeExt && filename.endsWith('.jpg') && mimeExt !== 'jpg') {
    return filename.slice(0, -4) + '.' + mimeExt;
  }
  return filename;
}

export function startPhotoDownload(photo, usedNames = new Set(), filenameOverride) {
  const url = photo?.public_url;
  if (!url) return false;
  let filename = filenameOverride
    ? uniqueDownloadFilename(filenameOverride, usedNames)
    : getDownloadFilename(photo, usedNames);
  const cached = photoBlobCache.get(url);
  if (cached) {
    filename = ensureExtensionFromBlob(filename, cached);
    return triggerBlobDownload(cached, filename);
  }
  return triggerUrlDownload(url, filename);
}

export async function downloadPhoto(photo, usedNames = new Set(), filenameOverride) {
  const url = photo?.public_url;
  if (!url) throw new Error('Este registro no tiene archivo para descargar.');

  let filename = filenameOverride
    ? uniqueDownloadFilename(filenameOverride, usedNames)
    : getDownloadFilename(photo, usedNames);

  try {
    const cached = photoBlobCache.get(url);
    const blob = cached || (await fetchPhotoBlob(url));
    if (!cached) photoBlobCache.set(url, blob);
    filename = ensureExtensionFromBlob(filename, blob);
    triggerBlobDownload(blob, filename);
  } catch {
    if (!triggerUrlDownload(url, filename)) {
      throw new Error('No se pudo descargar el archivo');
    }
  }
}
