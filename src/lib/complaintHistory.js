import { detectAggregator, getPhotoAggregator } from './aggregators.js';
import { compactCode } from './complaintMatch.js';
import { toArgentinaDate } from './metrics.js';

export function emptyHistory() {
  return {
    version: 1,
    updatedAt: null,
    items: {},
  };
}

export function complaintDay(complaint) {
  if (complaint?.orderAtIso) return toArgentinaDate(complaint.orderAtIso);
  return '';
}

export function complaintHistoryId(complaint) {
  const compact = compactCode(complaint?.orderCode);
  const day = complaintDay(complaint) || 'nodate';
  return `${compact}|${day}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function normalizeHistoryItem(raw, fallback = {}) {
  const orderCode = String(raw?.orderCode || fallback.orderCode || '').trim();
  const compact = compactCode(orderCode);
  if (!compact) return null;

  const orderAtIso = raw?.orderAtIso || fallback.orderAtIso || null;
  const timeOfDay = raw?.timeOfDay || fallback.timeOfDay || null;
  const dateAssumed = Boolean(raw?.dateAssumed ?? fallback.dateAssumed);
  const day = raw?.day || complaintDay({ orderAtIso }) || fallback.day || '';
  const aggregator =
    raw?.aggregator ||
    fallback.aggregator ||
    detectAggregator(orderCode) ||
    null;

  return {
    id: raw?.id || complaintHistoryId({ orderCode, orderAtIso }),
    orderCode,
    compact,
    aggregator,
    orderAtIso,
    timeOfDay,
    dateAssumed,
    day,
    reason: String(raw?.reason || fallback.reason || '').trim(),
    comment: String(raw?.comment || fallback.comment || '').trim(),
    accepted: Boolean(raw?.accepted ?? fallback.accepted),
    refutado: Boolean(raw?.refutado ?? fallback.refutado),
    photoId: raw?.photoId || fallback.photoId || null,
    photoName: raw?.photoName || fallback.photoName || null,
    photoUrl: raw?.photoUrl || fallback.photoUrl || null,
    importedAt: raw?.importedAt || fallback.importedAt || nowIso(),
    updatedAt: raw?.updatedAt || nowIso(),
  };
}

export function parseHistory(raw) {
  const store = emptyHistory();
  if (!raw || typeof raw !== 'object') return store;
  store.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  const source = raw.items && typeof raw.items === 'object' ? raw.items : {};
  for (const value of Object.values(source)) {
    const item = normalizeHistoryItem(value);
    if (item) store.items[item.id] = item;
  }
  return store;
}

function mergeText(current, incoming) {
  const next = String(incoming || '').trim();
  const prev = String(current || '').trim();
  if (!next) return prev;
  if (!prev) return next;
  if (prev.includes(next)) return prev;
  return `${prev}\n${next}`.slice(0, 500);
}

export function upsertHistoryItems(store, complaints, { importedAt } = {}) {
  const next = parseHistory(store);
  const stamp = importedAt || nowIso();
  let added = 0;
  let updated = 0;

  complaints.forEach((complaint) => {
    const id = complaintHistoryId(complaint);
    const existing = next.items[id];
    const incoming = normalizeHistoryItem(
      {
        ...complaint,
        id,
        importedAt: existing?.importedAt || stamp,
        updatedAt: stamp,
        accepted: existing?.accepted,
        refutado: existing?.refutado,
        photoId: existing?.photoId,
        photoName: existing?.photoName,
      },
      existing,
    );
    if (!incoming) return;

    if (existing) {
      incoming.reason = mergeText(existing.reason, complaint.reason);
      incoming.comment = mergeText(existing.comment, complaint.comment);
      incoming.accepted = Boolean(existing.accepted);
      incoming.refutado = Boolean(existing.refutado);
      incoming.photoId = existing.photoId || incoming.photoId;
      incoming.photoName = existing.photoName || incoming.photoName;
      incoming.photoUrl = existing.photoUrl || incoming.photoUrl;
      incoming.importedAt = existing.importedAt;
      incoming.updatedAt = stamp;
      next.items[id] = incoming;
      updated += 1;
    } else {
      incoming.importedAt = stamp;
      next.items[id] = incoming;
      added += 1;
    }
  });

  next.updatedAt = stamp;
  return { store: next, added, updated };
}

export function patchHistoryItem(store, id, patch) {
  const next = parseHistory(store);
  const current = next.items[id];
  if (!current) return next;
  next.items[id] = normalizeHistoryItem(
    {
      ...current,
      ...patch,
      id,
      updatedAt: nowIso(),
    },
    current,
  );
  next.updatedAt = next.items[id].updatedAt;
  return next;
}

export function attachPhotosToHistory(store, rows) {
  const next = parseHistory(store);
  let changed = false;
  const stamp = nowIso();

  rows.forEach((row) => {
    const id = complaintHistoryId(row.complaint);
    const current = next.items[id];
    if (!current) return;
    const photoId = row.photo?.id || current.photoId || null;
    const photoName = row.photo?.name || current.photoName || null;
    const photoUrl = row.photo?.public_url || current.photoUrl || null;
    const aggregator =
      current.aggregator || getPhotoAggregator(row.photo) || detectAggregator(row.complaint.orderCode) || null;
    const refutado = current.refutado || Boolean(row.photo?.is_refutado);
    if (
      current.photoId === photoId &&
      current.photoName === photoName &&
      current.photoUrl === photoUrl &&
      current.aggregator === aggregator &&
      current.refutado === refutado
    ) {
      return;
    }
    next.items[id] = {
      ...current,
      photoId,
      photoName,
      photoUrl,
      aggregator,
      refutado,
      updatedAt: stamp,
    };
    changed = true;
  });

  if (changed) next.updatedAt = stamp;
  return next;
}

export function historyResolution(item) {
  if (item?.accepted && item?.refutado) return 'refutado_aceptado';
  if (item?.refutado) return 'refutado';
  if (item?.accepted) return 'aceptado';
  return 'pendiente';
}

export function listHistoryItems(store, { aggregator = 'all', search = '' } = {}) {
  const items = Object.values(parseHistory(store).items);
  const raw = String(search || '').trim().toLowerCase();
  const needle = compactCode(search);
  return items
    .filter((item) => {
      if (aggregator && aggregator !== 'all' && item.aggregator !== aggregator) return false;
      if (!raw) return true;
      if (needle && item.compact.includes(needle)) return true;
      if (item.orderCode.toLowerCase().includes(raw)) return true;
      if (item.reason.toLowerCase().includes(raw)) return true;
      if (item.comment.toLowerCase().includes(raw)) return true;
      return false;
    })
    .sort((left, right) =>
      String(right.orderAtIso || right.updatedAt).localeCompare(String(left.orderAtIso || left.updatedAt)),
    );
}

export function groupHistoryFlags(store, from, to) {
  const map = {};
  Object.values(parseHistory(store).items).forEach((item) => {
    if (!item.day || (from && item.day < from) || (to && item.day > to)) return;
    if (!item.aggregator) return;
    if (!map[item.day]) map[item.day] = {};
    if (!map[item.day][item.aggregator]) {
      map[item.day][item.aggregator] = { accepted: 0, refuted: 0, refutedAccepted: 0 };
    }
    const bucket = map[item.day][item.aggregator];
    if (item.accepted) bucket.accepted += 1;
    if (item.refutado) bucket.refuted += 1;
    if (item.accepted && item.refutado) bucket.refutedAccepted += 1;
  });
  return map;
}

export function findHistoryForPhoto(store, photo) {
  const compact = compactCode(photo?.name);
  if (!compact) return null;
  const day = photo?.created_at ? toArgentinaDate(photo.created_at) : '';
  const items = Object.values(parseHistory(store).items);
  return (
    items.find((item) => item.photoId && photo?.id && item.photoId === photo.id) ||
    items.find((item) => item.compact === compact && item.day && item.day === day) ||
    items.find((item) => item.compact === compact) ||
    null
  );
}

export function attachHistoryToRows(rows, store) {
  const items = parseHistory(store).items;
  return rows.map((row) => ({
    ...row,
    history: items[complaintHistoryId(row.complaint)] || null,
  }));
}

export function historyItemToRow(item, photos = []) {
  const fromGallery =
    photos.find((photo) => item.photoId && photo.id === item.photoId) ||
    photos.find((photo) => compactCode(photo.name) === item.compact) ||
    null;

  const photo =
    fromGallery ||
    (item.photoId || item.photoUrl
      ? {
          id: item.photoId,
          name: item.photoName || item.orderCode,
          public_url: item.photoUrl,
          created_at: item.orderAtIso,
          is_refutado: item.refutado,
          has_complaint: true,
        }
      : null);

  return {
    complaint: {
      id: item.id,
      orderCode: item.orderCode,
      orderAtIso: item.orderAtIso,
      timeOfDay: item.timeOfDay,
      dateAssumed: item.dateAssumed,
      reason: item.reason,
      comment: item.comment,
    },
    photo,
    history: item,
    status: photo ? 'matched' : 'unmatched',
    candidates: [],
  };
}
