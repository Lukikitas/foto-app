import {
  matchComplaintsToPhotos,
  compactCode,
  complaintRowStatus,
  mergeComplaintNotes,
} from './complaintMatch.js';
import { fetchPhotos, PHOTO_GALLERY_KINDS, updatePhoto } from './photos.js';
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

export async function fetchPhotosForComplaints(complaints) {
  const range = complaintDateRange(complaints);
  return fetchPhotos({
    kind: PHOTO_GALLERY_KINDS.orders,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  });
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
  const updated = [];
  for (const row of rows) {
    if (!row.photo) continue;
    updated.push(await applyComplaintToPhoto(row.photo, row.complaint, { refutado }));
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
    'motivo',
    'comentario',
    'estado',
    'foto_url',
    'foto_hora',
    'codigo_foto',
  ];
  const lines = [header.join(',')];

  rows.forEach((row) => {
    lines.push(
      [
        row.complaint.orderCode,
        row.complaint.orderAtIso || row.complaint.timeOfDay || '',
        row.complaint.reason,
        row.complaint.comment,
        complaintRowStatus(row),
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
