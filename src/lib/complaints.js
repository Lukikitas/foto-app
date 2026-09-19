import {
  matchComplaintsToPhotos,
  compactCode,
  complaintPhotoSearchTokens,
  complaintRowStatus,
  mergeComplaintNotes,
} from './complaintMatch.js';
import { detectAggregator } from './aggregators.js';
import { compressImage } from './compressImage.js';
import { fetchOrderPhotosMatchingNames, fetchPhotos, isValidOrderDigits, PHOTO_COLUMNS, PHOTO_GALLERY_KINDS, updatePhoto, uploadPhoto } from './photos.js';
import { COMPLAINT_STATUS_LABELS } from './complaintHistory.js';
import { toDateInputValue } from './date.js';

const STORAGE_KEY = 'foto-app-complaints-batch';

export function getEvidenceFilename(complaint, photo) {
  const ext = photo.file_path?.split('.').pop()?.toLowerCase() || 'jpg';
  const code = compactCode(complaint.orderCode || photo.name) || 'pedido';
  return `${code}-evidencia.${ext}`;
}

export function complaintDateRange(complaints) {
  const timestamps = complaints
    .map((complaint) => complaint.orderAtIso)
    .filter(Boolean)
    .map((iso) => new Date(iso).getTime())
    .filter((value) => Number.isFinite(value));

  const to = new Date();
  const from = new Date();

  const hasTimeOnly = complaints.some(
    (complaint) => complaint.dateAssumed && !complaint.orderAtIso,
  );

  if (timestamps.length === 0) {
    from.setDate(from.getDate() - 14);
    return { dateFrom: toDateInputValue(from), dateTo: toDateInputValue(to) };
  }

  const min = new Date(Math.min(...timestamps));
  const max = new Date(Math.max(...timestamps));
  min.setDate(min.getDate() - 1);
  max.setDate(max.getDate() + 1);
  if (hasTimeOnly) {
    const floor = new Date();
    floor.setDate(floor.getDate() - 14);
    if (min > floor) min.setTime(floor.getTime());
    if (max < to) max.setTime(to.getTime());
  }
  return { dateFrom: toDateInputValue(min), dateTo: toDateInputValue(max) };
}

function hasWeakComplaintCodes(complaints) {
  return complaints.some((complaint) => {
    const digits = compactCode(complaint.orderCode).replace(/\D/g, '');
    return digits.length < 6;
  });
}

function needsGalleryFallback(complaints, photos) {
  if (hasWeakComplaintCodes(complaints)) return true;
  return matchComplaintsToPhotos(complaints, photos).some((row) => row.status !== 'matched');
}

export async function fetchPhotosForComplaints(complaints) {
  let byName;
  try {
    byName = await fetchOrderPhotosMatchingNames(complaintPhotoSearchTokens(complaints));
  } catch {
    byName = [];
  }

  if (byName.length > 0 && !needsGalleryFallback(complaints, byName)) {
    return byName;
  }

  if (hasWeakComplaintCodes(complaints) || byName.length === 0) {
    try {
      const extra = await fetchOrderPhotosMatchingNames(
        complaintPhotoSearchTokens(complaints, { includeShort: true }),
      );
      const merged = new Map();
      [...byName, ...extra].forEach((photo) => merged.set(photo.id, photo));
      byName = [...merged.values()];
    } catch {
      // seguimos con lo que haya y el dump de 90 días
    }
    if (byName.length > 0 && !needsGalleryFallback(complaints, byName)) {
      return byName;
    }
  }

  const recentFrom = new Date();
  recentFrom.setDate(recentFrom.getDate() - 90);
  const recent = await fetchPhotos({
    kind: PHOTO_GALLERY_KINDS.orders,
    dateFrom: toDateInputValue(recentFrom),
    dateTo: toDateInputValue(new Date()),
    columns: PHOTO_COLUMNS,
  });
  const byId = new Map();
  [...recent, ...byName].forEach((photo) => byId.set(photo.id, photo));
  return [...byId.values()];
}

export function saveComplaintBatch(complaints, pickedPhotoIds = {}) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        complaints,
        pickedPhotoIds,
      }),
    );
  } catch {
    // sessionStorage no disponible
  }
}

export function loadComplaintBatch() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.complaints)) return null;
    return {
      complaints: parsed.complaints,
      pickedPhotoIds: parsed.pickedPhotoIds || {},
    };
  } catch {
    return null;
  }
}

export function clearComplaintBatch() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage no disponible
  }
}

export async function applyComplaintToPhoto(photo, complaint, { refutado = false } = {}) {
  return updatePhoto(photo.id, photo.name, {
    notes: mergeComplaintNotes(photo.notes, complaint),
    has_complaint: true,
    taken_by: photo.taken_by || '',
    is_refutado: refutado ? true : Boolean(photo.is_refutado),
  });
}

export async function applyComplaintsToPhotos(rows, { refutado = false } = {}) {
  const targets = rows.filter((row) => row.photo);
  const updated = [];
  for (let index = 0; index < targets.length; index += 8) {
    const chunk = targets.slice(index, index + 8);
    const batch = await Promise.all(
      chunk.map((row) => applyComplaintToPhoto(row.photo, row.complaint, { refutado })),
    );
    updated.push(...batch);
  }
  return updated;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildComplaintExport(rows) {
  const header = [
    'codigo',
    'hora_pedido',
    'combo',
    'motivo',
    'comentario',
    'monto',
    'estado',
    'foto_url',
    'foto_hora',
    'codigo_foto',
  ];
  const lines = [header.join(',')];

  rows.forEach((row) => {
    const status = complaintRowStatus(row);
    lines.push(
      [
        row.complaint.orderCode,
        row.complaint.orderAtIso || row.complaint.timeOfDay || '',
        row.complaint.combo || row.history?.combo || '',
        row.complaint.reason,
        row.complaint.comment,
        row.complaint.amount ?? row.history?.amount ?? '',
        COMPLAINT_STATUS_LABELS[status] || status,
        row.photo?.public_url || '',
        row.photo?.created_at || '',
        row.photo?.name || '',
      ]
        .map(csvEscape)
        .join(','),
    );
  });

  return `${lines.join('\n')}\n`;
}

export async function uploadComplaintPhotoFile(file, complaint, aggregator) {
  if (!file) throw new Error('Elegí una foto.');
  const raw = String(complaint?.orderCode || '').trim();
  const compact = compactCode(raw);
  const digits = compact.replace(/\D/g, '');
  const code = [raw, compact, digits.length >= 4 ? digits.slice(-4) : ''].find(
    (value) => value && isValidOrderDigits(value),
  );
  if (!code) {
    throw new Error('Este código no se puede usar para nombrar la foto.');
  }
  const compressed = file.type?.startsWith('image/') ? await compressImage(file) : file;
  const partner = aggregator || detectAggregator(code) || detectAggregator(raw) || 'sin_agregador';
  return uploadPhoto(
    compressed,
    code,
    {
      has_complaint: true,
      notes: complaint.reason ? `Reclamo: ${complaint.reason}` : '',
    },
    partner,
  );
}

export function downloadTextFile(filename, contents, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function copyText(value) {
  const text = String(value || '');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export function replacePhotosInRows(rows, updatedPhotos) {
  const map = new Map(updatedPhotos.map((photo) => [photo.id, photo]));
  return rows.map((row) => {
    if (!row.photo || !map.has(row.photo.id)) return row;
    return { ...row, photo: map.get(row.photo.id) };
  });
}

export { matchComplaintsToPhotos, mergeComplaintNotes };
