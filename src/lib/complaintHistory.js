import { detectAggregator, getPhotoAggregator } from './aggregators.js';
import { compactCode } from './complaintMatch.js';
import { toArgentinaDate } from './metrics.js';

export const COMPLAINT_STATUSES = {
  queja: 'queja',
  refutado: 'refutado',
  refutado_aceptado: 'refutado_aceptado',
  refutado_rechazado: 'refutado_rechazado',
  no_refutable: 'no_refutable',
};

export const COMPLAINT_STATUS_LABELS = {
  queja: 'Queja',
  refutado: 'Refutado',
  refutado_aceptado: 'Ref. aceptado',
  refutado_rechazado: 'Ref. rechazado',
  no_refutable: 'No refutable',
  // Solo display: el estado guardado sigue siendo 'queja' (ver refutadoDeadline).
  queja_vencida: 'Queja vencida',
};

// Motivos ofrecidos al marcar «No se puede refutar». El motivo se guarda en el
// historial (unrefutableReason) y alimenta las métricas disciplinarias.
export const NO_REFUTABLE_REASONS = [
  'No hay foto',
  'Queja real',
  'Foto borrosa/invalida',
  'Código no visible',
];

export const EMPTY_COMBO_LABEL = 'Sin combo';

export const PENDING_COMPLAINT_DETAILS = 'Pendiente de cargar detalles del reclamo';

export function isPendingComplaintDetails(reason) {
  return String(reason || '').trim() === PENDING_COMPLAINT_DETAILS;
}

export function emptyHistory() {
  return {
    version: 2,
    updatedAt: null,
    items: {},
  };
}

export function emptyHistoryFlags() {
  return {
    queja: 0,
    refutado: 0,
    refutadoAceptado: 0,
    refutadoRechazado: 0,
    noRefutable: 0,
    complaintAmount: 0,
    recoveredAmount: 0,
    lostAmount: 0,
    undisputedAmount: 0,
    inProgressAmount: 0,
    disputedAmount: 0,
    confirmedLostAmount: 0,
  };
}

export function complaintDay(complaint) {
  if (complaint?.orderAtIso) return toArgentinaDate(complaint.orderAtIso);
  return /^\d{4}-\d{2}-\d{2}$/.test(complaint?.day || '') ? complaint.day : '';
}

export function complaintHistoryId(complaint) {
  const compact = compactCode(complaint?.orderCode);
  const day = complaintDay(complaint) || 'nodate';
  return `${compact}|${day}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function migrateComplaintStatus(raw = {}) {
  const direct = String(raw.status || '').trim();
  if (COMPLAINT_STATUSES[direct]) return direct;
  if (raw.accepted && raw.refutado) return COMPLAINT_STATUSES.refutado_aceptado;
  if (raw.refutado) return COMPLAINT_STATUSES.refutado;
  if (raw.accepted) return COMPLAINT_STATUSES.refutado_rechazado;
  return COMPLAINT_STATUSES.queja;
}

export function statusIsDisputed(status) {
  return (
    status === COMPLAINT_STATUSES.refutado ||
    status === COMPLAINT_STATUSES.refutado_aceptado ||
    status === COMPLAINT_STATUSES.refutado_rechazado
  );
}

function toAmount(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

function normalizeFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const fields = {};
  for (const [key, item] of Object.entries(value)) {
    const label = String(key || '').trim();
    const text = String(item ?? '').trim();
    if (!label || !text) continue;
    fields[label] = text;
  }
  return fields;
}

function mergeFields(current, incoming) {
  return { ...normalizeFields(current), ...normalizeFields(incoming) };
}

export function normalizeHistoryItem(raw, fallback = {}) {
  const orderCode = String(raw?.orderCode || fallback.orderCode || '').trim();
  const compact = compactCode(orderCode);
  if (!compact) return null;

  const orderAtIso = raw?.orderAtIso || fallback.orderAtIso || null;
  const timeOfDay = raw?.timeOfDay || fallback.timeOfDay || null;
  const dateAssumed = Boolean(raw?.dateAssumed ?? fallback.dateAssumed);
  const day = raw?.day || complaintDay({ orderAtIso }) || fallback.day || '';
  const aggregator = raw?.aggregator !== undefined
    ? raw.aggregator
    : fallback.aggregator !== undefined
      ? fallback.aggregator
      : detectAggregator(orderCode) || null;
  const status = migrateComplaintStatus({
    status: raw?.status ?? fallback.status,
    accepted: raw?.accepted ?? fallback.accepted,
    refutado: raw?.refutado ?? fallback.refutado,
  });
  // El motivo solo aplica mientras el estado sea «No refutable»: cambiarlo
  // (lote, importación de reintegros, etc.) lo limpia para no dejar datos viejos.
  const unrefutableReason =
    status === COMPLAINT_STATUSES.no_refutable
      ? String(raw?.unrefutableReason || fallback.unrefutableReason || '').trim()
      : '';
  const amount = toAmount(raw?.amount ?? fallback.amount);
  const combo = String(raw?.combo || fallback.combo || '').trim();

  return {
    id: raw?.id || complaintHistoryId({ orderCode, orderAtIso, day }),
    orderCode,
    compact,
    aggregator,
    orderAtIso,
    timeOfDay,
    dateAssumed,
    day,
    reason: String(raw?.reason || fallback.reason || '').trim(),
    comment: String(raw?.comment || fallback.comment || '').trim(),
    combo,
    amount,
    fields: mergeFields(fallback.fields, raw?.fields),
    status,
    unrefutableReason,
    photoId: raw?.photoId || fallback.photoId || null,
    photoName: raw?.photoName || fallback.photoName || null,
    photoUrl: raw?.photoUrl || fallback.photoUrl || null,
    sourceId: raw?.sourceId || fallback.sourceId || null,
    manualEdit: Boolean(raw?.manualEdit ?? fallback.manualEdit),
    importedAt: raw?.importedAt || fallback.importedAt || nowIso(),
    updatedAt: raw?.updatedAt || nowIso(),
  };
}

const NORMALIZED_KEYS = [
  'id', 'orderCode', 'compact', 'aggregator', 'orderAtIso', 'timeOfDay', 'dateAssumed',
  'day', 'reason', 'comment', 'combo', 'amount', 'fields', 'status', 'unrefutableReason',
  'photoId', 'photoName', 'photoUrl', 'sourceId', 'manualEdit', 'importedAt', 'updatedAt',
];

function alreadyNormalized(item) {
  // Si un ítem no tiene exactamente la forma que produce normalizeHistoryItem,
  // se toma la ruta lenta y se re-normaliza (nunca al revés).
  if (!item || typeof item !== 'object') return false;
  for (const key of NORMALIZED_KEYS) {
    if (!(key in item)) return false;
  }
  return typeof item.id === 'string' && item.id
    && typeof item.orderCode === 'string' && item.orderCode
    && typeof item.compact === 'string' && item.compact
    && typeof item.status === 'string' && Boolean(COMPLAINT_STATUSES[item.status])
    && typeof item.manualEdit === 'boolean'
    && typeof item.importedAt === 'string'
    && typeof item.updatedAt === 'string'
    && Boolean(item.fields) && typeof item.fields === 'object' && !Array.isArray(item.fields)
    && typeof item.amount === 'number';
}

export function parseHistory(raw) {
  const store = emptyHistory();
  if (!raw || typeof raw !== 'object') return store;
  store.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  const source = raw.items && typeof raw.items === 'object' ? raw.items : {};
  const values = Object.values(source);
  // Ruta rápida: si todo ya está normalizado (el caso habitual, porque cada
  // mutación pasa por parseHistory), alcanza con clonar los ítems. Re-normalizar
  // el store completo en cada llamada multiplicaba el costo de guardar un
  // lote grande por la cantidad de reclamos.
  if (values.every(alreadyNormalized)) {
    for (const item of values) store.items[item.id] = { ...item };
    return store;
  }
  for (const value of values) {
    const item = normalizeHistoryItem(value);
    if (item) store.items[item.id] = item;
  }
  return store;
}

function findHistoryForSheetComplaint(store, id, compact) {
  if (store.items[id]) return store.items[id];
  const manuallyEdited = Object.values(store.items).find((item) => item.sourceId === id);
  if (manuallyEdited) return manuallyEdited;
  if (!compact) return undefined;
  return Object.values(store.items).find(
    (item) => item.compact === compact && isPendingComplaintDetails(item.reason),
  );
}

function mergeSheetReason(existingReason, incomingReason) {
  const next = String(incomingReason || '').trim();
  const prev = String(existingReason || '').trim();
  if (isPendingComplaintDetails(prev)) return next;
  if (isPendingComplaintDetails(next)) return prev;
  return next || prev;
}

export function upsertHistoryItems(store, complaints, { importedAt } = {}) {
  const next = parseHistory(store);
  const stamp = importedAt || nowIso();
  let added = 0;
  let updated = 0;

  complaints.forEach((complaint) => {
    const id = complaintHistoryId(complaint);
    const compact = compactCode(complaint?.orderCode);
    const existing = findHistoryForSheetComplaint(next, id, compact);
    const incoming = normalizeHistoryItem(
      {
        ...complaint,
        id: existing?.manualEdit ? existing.id : id,
        orderCode: existing?.manualEdit ? existing.orderCode : complaint.orderCode,
        aggregator: existing?.manualEdit ? existing.aggregator : complaint.aggregator,
        sourceId: existing?.sourceId,
        manualEdit: existing?.manualEdit,
        importedAt: existing?.importedAt || stamp,
        updatedAt: stamp,
        status: existing?.status,
        photoId: existing?.photoId,
        photoName: existing?.photoName,
        photoUrl: existing?.photoUrl,
      },
      existing,
    );
    if (!incoming) return;

    if (existing) {
      incoming.reason = mergeSheetReason(existing.reason, complaint.reason);
      incoming.comment = String(complaint.comment || existing.comment || '').trim();
      incoming.combo = String(complaint.combo || existing.combo || '').trim();
      incoming.amount = toAmount(complaint.amount ?? existing.amount);
      incoming.fields = mergeFields(existing.fields, complaint.fields);
      incoming.status = existing.status;
      incoming.photoId = existing.photoId || incoming.photoId;
      incoming.photoName = existing.photoName || incoming.photoName;
      incoming.photoUrl = existing.photoUrl || incoming.photoUrl;
      incoming.importedAt = existing.importedAt;
      incoming.updatedAt = stamp;
      if (existing.id !== incoming.id) delete next.items[existing.id];
      next.items[incoming.id] = incoming;
      updated += 1;
    } else {
      incoming.importedAt = stamp;
      incoming.status = COMPLAINT_STATUSES.queja;
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

export function patchHistoryItems(store, ids, patch = {}) {
  const next = parseHistory(store);
  const idList = Array.isArray(ids) ? ids : [...(ids || [])];
  if (idList.length === 0) return next;
  const stamp = nowIso();
  let changed = false;

  idList.forEach((id) => {
    const current = next.items[id];
    if (!current) return;
    const itemPatch = { ...patch };
    if (itemPatch.commentAppend !== undefined) {
      delete itemPatch.commentAppend;
      const prev = current.comment || '';
      const addition = String(patch.commentAppend || '').trim();
      if (addition) {
        itemPatch.comment = prev ? `${prev} · ${addition}` : addition;
      }
    }
    const normalized = normalizeHistoryItem(
      {
        ...current,
        ...itemPatch,
        id,
        updatedAt: stamp,
      },
      current,
    );
    if (normalized) {
      next.items[id] = normalized;
      changed = true;
    }
  });

  if (changed) {
    next.updatedAt = stamp;
  }
  return next;
}

export function deleteHistoryItem(store, id) {
  const next = parseHistory(store);
  if (!next.items[id]) return next;
  delete next.items[id];
  next.updatedAt = nowIso();
  return next;
}

export function deleteHistoryItems(store, ids) {
  const next = parseHistory(store);
  const idList = Array.isArray(ids) ? ids : [...(ids || [])];
  if (idList.length === 0) return next;
  const stamp = nowIso();
  let changed = false;

  idList.forEach((id) => {
    if (next.items[id]) {
      delete next.items[id];
      changed = true;
    }
  });

  if (changed) {
    next.updatedAt = stamp;
  }
  return next;
}

export function clearHistoryItems(store) {
  const next = emptyHistory();
  next.updatedAt = store?.updatedAt ? nowIso() : nowIso();
  return next;
}

function galleryComplaintFromPhoto(photo) {
  return {
    orderCode: photo?.name,
    aggregator: getPhotoAggregator(photo),
    orderAtIso: photo?.created_at || null,
    reason: PENDING_COMPLAINT_DETAILS,
    comment: '',
    status: photo?.is_refutado ? COMPLAINT_STATUSES.refutado : COMPLAINT_STATUSES.queja,
    photoId: photo?.id || null,
    photoName: photo?.name || null,
    photoUrl: photo?.public_url || null,
  };
}

export function upsertGalleryComplaint(store, photo) {
  const next = parseHistory(store);
  const compact = compactCode(photo?.name);
  if (!compact || photo?.name === 'Código no encontrado') return next;

  const stamp = nowIso();
  const existing = findHistoryForPhoto(next, photo);
  const incoming = galleryComplaintFromPhoto(photo);
  const status =
    existing?.status === COMPLAINT_STATUSES.queja && photo?.is_refutado
      ? COMPLAINT_STATUSES.refutado
      : existing?.status || incoming.status;

  if (existing) {
    const pending = isPendingComplaintDetails(existing.reason);
    const nextCode = pending ? String(photo.name || existing.orderCode).trim() : existing.orderCode;
    const nextId =
      pending && compact !== existing.compact
        ? complaintHistoryId({ orderCode: nextCode, orderAtIso: existing.orderAtIso || photo.created_at })
        : existing.id;
    const item = normalizeHistoryItem(
      {
        ...existing,
        orderCode: nextCode,
        reason: pending || !existing.reason ? PENDING_COMPLAINT_DETAILS : existing.reason,
        photoId: photo.id || existing.photoId,
        photoName: photo.name || existing.photoName,
        photoUrl: photo.public_url || existing.photoUrl,
        status,
        id: nextId,
        updatedAt: stamp,
      },
      existing,
    );
    if (!item) return next;
    if (existing.id !== item.id) delete next.items[existing.id];
    next.items[item.id] = item;
    next.updatedAt = stamp;
    return next;
  }

  const created = normalizeHistoryItem({
    ...incoming,
    id: complaintHistoryId(incoming),
    importedAt: stamp,
    updatedAt: stamp,
  });
  if (!created) return next;
  next.items[created.id] = created;
  next.updatedAt = stamp;
  return next;
}

export function removeGalleryComplaint(store, photo) {
  const next = parseHistory(store);
  const existing = findHistoryForPhoto(next, photo);
  if (!existing) return next;
  delete next.items[existing.id];
  next.updatedAt = nowIso();
  return next;
}

// Kept as a compatibility alias for callers outside the current bundle.
export const removePendingGalleryComplaint = removeGalleryComplaint;

export function syncGalleryComplaintInStore(store, photo) {
  if (!photo || !compactCode(photo.name) || photo.name === 'Código no encontrado') {
    return parseHistory(store);
  }
  const next = syncEditedPhotoInStore(store, photo);
  if (photo.has_complaint) return upsertGalleryComplaint(next, photo);
  return removeGalleryComplaint(next, photo);
}

export function editHistoryItemInStore(store, id, { orderCode, aggregator, photo } = {}) {
  const next = parseHistory(store);
  const current = next.items[id];
  if (!current) throw new Error('No se encontró el reclamo para editar.');
  const code = String(orderCode || '').trim();
  const compact = compactCode(code);
  if (!compact) throw new Error('Ingresá un código de pedido válido.');
  const nextId = complaintHistoryId({ orderCode: code, orderAtIso: current.orderAtIso, day: current.day });
  if (nextId !== id && next.items[nextId]) {
    throw new Error('Ya existe un reclamo con ese código en la misma fecha.');
  }
  const stamp = nowIso();
  const updated = normalizeHistoryItem({
    ...current,
    id: nextId,
    orderCode: code,
    compact,
    aggregator: aggregator || null,
    sourceId: current.sourceId || id,
    manualEdit: true,
    photoId: photo?.id ?? current.photoId,
    photoName: photo?.name ?? current.photoName,
    photoUrl: photo?.public_url ?? current.photoUrl,
    updatedAt: stamp,
  });
  if (nextId !== id) delete next.items[id];
  next.items[nextId] = updated;
  next.updatedAt = stamp;
  return next;
}

export function syncEditedPhotoInStore(store, photo) {
  const next = parseHistory(store);
  const linked = Object.values(next.items).filter((item) => item.photoId === photo?.id);
  for (const item of linked) {
    const aggregator = getPhotoAggregator(photo);
    const updated = item.orderCode === photo.name && item.aggregator === aggregator
      ? patchHistoryItem(next, item.id, {
          photoId: photo.id,
          photoName: photo.name,
          photoUrl: photo.public_url,
        })
      : editHistoryItemInStore(next, item.id, {
          orderCode: photo.name,
          aggregator,
          photo,
        });
    next.items = updated.items;
    next.updatedAt = updated.updatedAt;
  }
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
    const status =
      current.status === COMPLAINT_STATUSES.queja && row.photo?.is_refutado
        ? COMPLAINT_STATUSES.refutado
        : current.status;
    if (
      current.photoId === photoId &&
      current.photoName === photoName &&
      current.photoUrl === photoUrl &&
      current.aggregator === aggregator &&
      current.status === status
    ) {
      return;
    }
    next.items[id] = {
      ...current,
      photoId,
      photoName,
      photoUrl,
      aggregator,
      status,
      updatedAt: stamp,
    };
    changed = true;
  });

  if (changed) next.updatedAt = stamp;
  return next;
}

export function historyResolution(item) {
  return migrateComplaintStatus(item);
}

export function listHistoryItems(
  store,
  { aggregator = 'all', search = '', status = 'all', from = '', to = '' } = {},
) {
  const items = Object.values(parseHistory(store).items);
  const raw = String(search || '').trim().toLowerCase();
  const needle = compactCode(search);
  return items
    .filter((item) => {
      if (aggregator && aggregator !== 'all' && item.aggregator !== aggregator) return false;
      if (status && status !== 'all' && item.status !== status) return false;
      if (from && item.day && item.day < from) return false;
      if (to && item.day && item.day > to) return false;
      if (from && !item.day) return false;
      if (!raw) return true;
      if (needle && item.compact.includes(needle)) return true;
      if (item.orderCode.toLowerCase().includes(raw)) return true;
      if (item.reason.toLowerCase().includes(raw)) return true;
      if (item.comment.toLowerCase().includes(raw)) return true;
      if (item.combo.toLowerCase().includes(raw)) return true;
      return Object.values(item.fields || {}).some((value) => String(value).toLowerCase().includes(raw));
    })
    .sort((left, right) =>
      String(right.orderAtIso || right.day || right.updatedAt).localeCompare(String(left.orderAtIso || left.day || left.updatedAt)),
    );
}

export function moneyForStatus(item) {
  const amount = Number(item?.amount);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return amount;
}

export function addMoneyToFlags(flags, item) {
  const amount = moneyForStatus(item);
  flags.complaintAmount += amount;
  if (item.status === COMPLAINT_STATUSES.refutado_aceptado) flags.recoveredAmount += amount;
  else if (item.status === COMPLAINT_STATUSES.refutado) flags.inProgressAmount += amount;
  else if (item.status === COMPLAINT_STATUSES.refutado_rechazado) flags.confirmedLostAmount += amount;
  else flags.undisputedAmount += amount;
  flags.lostAmount = flags.confirmedLostAmount + flags.undisputedAmount;
  flags.disputedAmount = flags.inProgressAmount;
  return flags;
}

export function groupHistoryFlags(store, from, to) {
  const map = {};
  Object.values(parseHistory(store).items).forEach((item) => {
    if (!item.day || (from && item.day < from) || (to && item.day > to)) return;
    const aggregator = item.aggregator || 'sin_agregador';
    if (!map[item.day]) map[item.day] = {};
    if (!map[item.day][aggregator]) {
      map[item.day][aggregator] = emptyHistoryFlags();
    }
    const bucket = map[item.day][aggregator];
    if (item.status === COMPLAINT_STATUSES.refutado_aceptado) bucket.refutadoAceptado += 1;
    else if (item.status === COMPLAINT_STATUSES.refutado_rechazado) bucket.refutadoRechazado += 1;
    else if (item.status === COMPLAINT_STATUSES.refutado) bucket.refutado += 1;
    else if (item.status === COMPLAINT_STATUSES.no_refutable) bucket.noRefutable += 1;
    else bucket.queja += 1;
    addMoneyToFlags(bucket, item);
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

export function buildPhotoIndex(photos = []) {
  const byId = new Map();
  const byCompact = new Map();
  for (const photo of photos) {
    if (photo?.id && !byId.has(photo.id)) byId.set(photo.id, photo);
    const compact = compactCode(photo?.name);
    if (compact && !byCompact.has(compact)) byCompact.set(compact, photo);
  }
  return { byId, byCompact };
}

export function attachHistoryToRows(rows, store) {
  const items = parseHistory(store).items;
  // Un índice por sourceId evita recorrer todo el historial por fila
  // (antes: O(filas × historial) con Object.values().find en cada una).
  const bySourceId = new Map();
  for (const item of Object.values(items)) {
    if (item.sourceId && !bySourceId.has(item.sourceId)) bySourceId.set(item.sourceId, item);
  }
  return rows.map((row) => ({
    ...row,
    history: items[complaintHistoryId(row.complaint)] ||
      bySourceId.get(complaintHistoryId(row.complaint)) || null,
  }));
}

export function historyItemToRow(item, photos = []) {
  // Acepta la lista de fotos o un índice prearmado (buildPhotoIndex) para no
  // recorrer todas las fotos por reclamo.
  const index = Array.isArray(photos) ? buildPhotoIndex(photos) : photos;
  const fromGallery =
    (item.photoId && index.byId.get(item.photoId)) ||
    (item.compact && index.byCompact.get(item.compact)) ||
    null;

  const photo =
    fromGallery ||
    (item.photoId || item.photoUrl
      ? {
          id: item.photoId,
          name: item.photoName || item.orderCode,
          public_url: item.photoUrl,
          created_at: item.orderAtIso,
          is_refutado: statusIsDisputed(item.status),
          has_complaint: true,
        }
      : null);

  return {
    complaint: {
      id: item.id,
      orderCode: item.orderCode,
      aggregator: item.aggregator,
      orderAtIso: item.orderAtIso,
      day: item.day,
      timeOfDay: item.timeOfDay,
      dateAssumed: item.dateAssumed,
      reason: item.reason,
      comment: item.comment,
      combo: item.combo,
      amount: item.amount,
      fields: item.fields,
    },
    photo,
    history: item,
    status: photo ? 'matched' : 'unmatched',
    candidates: [],
  };
}
