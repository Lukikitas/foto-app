import { AGGREGATORS, getAggregatorLabel, getPhotoAggregator } from './aggregators.js';

export const DEFAULT_COMPLAINT_TARGET_PCT = 2.4;
export const DEFAULT_AWT_TARGET_PCT = 11;
export const AWT_AGGREGATOR = 'pedidosya';
export const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

export const METRIC_AGGREGATORS = Object.keys(AGGREGATORS);

export const AGGREGATOR_SHORT_LABELS = {
  pedidosya: 'PEYA',
  rappi: 'Rappi',
  rappi_turbo: 'Turbo',
  mercadopago: 'MP',
};

export function getAggregatorShortLabel(aggregator) {
  return AGGREGATOR_SHORT_LABELS[aggregator] || getAggregatorLabel(aggregator);
}

export const METRIC_PAGE_TABS = [
  { id: 'overview', label: 'Resumen' },
  ...METRIC_AGGREGATORS.map((id) => ({ id, label: AGGREGATOR_SHORT_LABELS[id] })),
  { id: 'entry', label: 'Cargar' },
];

export const PERIOD_PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'days7', label: '7 días' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'custom', label: 'Rango' },
];

export function emptyDayStats() {
  return { orders: 0, complaints: 0, accepted: null, refuted: null, awt: 0 };
}

export function emptyStore() {
  return {
    version: 1,
    targetComplaintPct: DEFAULT_COMPLAINT_TARGET_PCT,
    targetAwtPct: DEFAULT_AWT_TARGET_PCT,
    updatedAt: null,
    days: {},
  };
}

export function parseStore(raw) {
  const store = emptyStore();
  if (!raw || typeof raw !== 'object') return store;

  const target = Number(raw.targetComplaintPct);
  if (Number.isFinite(target) && target >= 0 && target <= 100) {
    store.targetComplaintPct = target;
  }

  const awtTarget = Number(raw.targetAwtPct);
  if (Number.isFinite(awtTarget) && awtTarget >= 0 && awtTarget <= 100) {
    store.targetAwtPct = awtTarget;
  }

  store.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  store.version = 1;
  store.days = {};

  const days = raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const [day, aggregators] of Object.entries(days)) {
    if (!isIsoDate(day) || !aggregators || typeof aggregators !== 'object') continue;
    const next = {};
    for (const aggregator of METRIC_AGGREGATORS) {
      const row = aggregators[aggregator];
      if (!row || typeof row !== 'object') continue;
      next[aggregator] = normalizeDayStats(row);
    }
    if (Object.keys(next).length > 0) store.days[day] = next;
  }

  return store;
}

export function normalizeDayStats(row = {}) {
  return {
    orders: toCount(row.orders),
    complaints: toCount(row.complaints),
    accepted: toOptionalCount(row.accepted),
    refuted: toOptionalCount(row.refuted),
    awt: toCount(row.awt),
  };
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function argentinaToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ });
}

export function addDays(dateStr, amount) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function startOfWeek(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function endOfWeek(dateStr) {
  return addDays(startOfWeek(dateStr), 6);
}

export function startOfMonth(dateStr) {
  return `${String(dateStr).slice(0, 7)}-01`;
}

export function endOfMonth(dateStr) {
  const [year, month] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function enumerateDays(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return [];
  const days = [];
  let current = from;
  while (current <= to) {
    days.push(current);
    current = addDays(current, 1);
  }
  return days;
}

export function toArgentinaDate(isoString, now = isoString) {
  if (!isoString) return argentinaToday(now instanceof Date ? now : new Date());
  return new Date(isoString).toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ });
}

export function formatDayLabel(dateStr) {
  if (!isIsoDate(dateStr)) return dateStr || '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function resolvePeriod(preset, today = argentinaToday(), customFrom = '', customTo = '') {
  if (preset === 'yesterday') {
    const day = addDays(today, -1);
    return { from: day, to: day };
  }
  if (preset === 'days7') {
    return { from: addDays(today, -6), to: today };
  }
  if (preset === 'week') {
    return { from: startOfWeek(today), to: endOfWeek(today) };
  }
  if (preset === 'month') {
    return { from: startOfMonth(today), to: endOfMonth(today) };
  }
  if (preset === 'custom') {
    const from = isIsoDate(customFrom) ? customFrom : today;
    const to = isIsoDate(customTo) ? customTo : from;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return { from: today, to: today };
}

export function previousPeriod(from, to) {
  const days = enumerateDays(from, to);
  if (days.length === 0) return { from, to };
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days.length - 1));
  return { from: prevFrom, to: prevTo };
}

export function complaintRate(orders, complaints) {
  const total = Number(orders);
  if (!Number.isFinite(total) || total <= 0) return null;
  return (toCount(complaints) / total) * 100;
}

export function ratioPct(part, whole) {
  const total = Number(whole);
  if (!Number.isFinite(total) || total <= 0) return null;
  return (toCount(part) / total) * 100;
}

export function isOutOfTarget(rate, target = DEFAULT_COMPLAINT_TARGET_PCT) {
  if (rate == null || !Number.isFinite(rate)) return false;
  return rate > Number(target);
}

export function formatPct(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('es-AR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatNumber(value) {
  return toCount(value).toLocaleString('es-AR');
}

function isOrderPhotoPath(photo) {
  if (photo?.file_path?.startsWith('files/')) return false;
  return Boolean(photo?.file_path?.startsWith('orders/'));
}

export function groupPhotoFlags(photos = []) {
  const map = {};
  for (const photo of photos) {
    if (!isOrderPhotoPath(photo)) continue;
    const aggregator = getPhotoAggregator(photo);
    if (!aggregator || !METRIC_AGGREGATORS.includes(aggregator)) continue;
    const day = toArgentinaDate(photo.created_at);
    if (!map[day]) map[day] = {};
    if (!map[day][aggregator]) map[day][aggregator] = { complaintPhotos: 0, refutedPhotos: 0 };
    if (photo.is_refutado) map[day][aggregator].refutedPhotos += 1;
    else if (photo.has_complaint) map[day][aggregator].complaintPhotos += 1;
  }
  return map;
}

export function resolveDayAggregator(store, photoFlags, day, aggregator) {
  const entered = store?.days?.[day]?.[aggregator] || emptyDayStats();
  const photos = photoFlags?.[day]?.[aggregator] || { complaintPhotos: 0, refutedPhotos: 0 };
  const orders = toCount(entered.orders);
  const complaints = toCount(entered.complaints);
  const refuted =
    entered.refuted == null ? toCount(photos.refutedPhotos) : toCount(entered.refuted);
  const accepted =
    entered.accepted == null
      ? Math.max(0, complaints - refuted)
      : toCount(entered.accepted);
  const pending = Math.max(0, complaints - refuted - accepted);
  const awt = toCount(entered.awt);
  const rate = complaintRate(orders, complaints);

  return {
    aggregator,
    day,
    orders,
    complaints,
    awt,
    refuted,
    accepted,
    pending,
    photoRefuted: toCount(photos.refutedPhotos),
    photoComplaints: toCount(photos.complaintPhotos),
    usedPhotoRefuted: entered.refuted == null,
    usedAutoAccepted: entered.accepted == null,
    complaintPct: rate,
    awtPct: complaintRate(orders, awt),
    refutedPctOfComplaints: ratioPct(refuted, complaints),
    acceptedPctOfComplaints: ratioPct(accepted, complaints),
  };
}

export function summarizeRange(store, photoFlags, from, to) {
  const days = enumerateDays(from, to);
  const aggregators = METRIC_AGGREGATORS.map((aggregator) => {
    const rows = days.map((day) => resolveDayAggregator(store, photoFlags, day, aggregator));
    return rollupRows(aggregator, rows);
  });

  const overallRows = aggregators.flatMap((item) => item.rows);
  const overall = rollupRows('all', overallRows);
  const daily = days.map((day) => {
    const rows = METRIC_AGGREGATORS.map((aggregator) =>
      resolveDayAggregator(store, photoFlags, day, aggregator),
    );
    return { day, ...rollupRows(day, rows), aggregators: rows };
  });

  return { from, to, days, overall, aggregators, daily };
}

export function aggregatorDailySeries(summary, aggregator) {
  return (summary?.daily || []).map((day) => {
    const row = day.aggregators.find((item) => item.aggregator === aggregator) || emptyDayStats();
    return { day: day.day, ...row };
  });
}

export function compareSummaries(current, previous, target, awtTarget = DEFAULT_AWT_TARGET_PCT) {
  return {
    orders: delta(current.orders, previous.orders),
    complaints: delta(current.complaints, previous.complaints),
    complaintPct: delta(current.complaintPct, previous.complaintPct),
    awt: delta(current.awt, previous.awt),
    awtPct: delta(current.awtPct, previous.awtPct),
    refuted: delta(current.refuted, previous.refuted),
    accepted: delta(current.accepted, previous.accepted),
    outOfTarget: isOutOfTarget(current.complaintPct, target),
    outOfAwtTarget: isOutOfTarget(current.awtPct, awtTarget),
    previousOutOfTarget: isOutOfTarget(previous.complaintPct, target),
  };
}

export function upsertDayStats(store, day, aggregator, stats) {
  const next = parseStore(store);
  if (!isIsoDate(day) || !METRIC_AGGREGATORS.includes(aggregator)) return next;

  const normalized = normalizeDayStats(stats);
  const empty =
    normalized.orders === 0 &&
    normalized.complaints === 0 &&
    normalized.awt === 0 &&
    normalized.accepted == null &&
    normalized.refuted == null;

  if (!next.days[day]) next.days[day] = {};
  if (empty) delete next.days[day][aggregator];
  else next.days[day][aggregator] = normalized;
  if (Object.keys(next.days[day]).length === 0) delete next.days[day];
  return next;
}

export function setTargetComplaintPct(store, target) {
  const next = parseStore(store);
  const value = Number(target);
  next.targetComplaintPct =
    Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_COMPLAINT_TARGET_PCT;
  return next;
}

export function setTargetAwtPct(store, target) {
  const next = parseStore(store);
  const value = Number(target);
  next.targetAwtPct =
    Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_AWT_TARGET_PCT;
  return next;
}

export function copyDayStats(store, fromDay, toDay) {
  const next = parseStore(store);
  const source = next.days[fromDay];
  if (!source || !isIsoDate(toDay)) return next;
  next.days[toDay] = Object.fromEntries(
    Object.entries(source).map(([aggregator, stats]) => [aggregator, { ...stats }]),
  );
  return next;
}

function rollupRows(id, rows) {
  const orders = rows.reduce((sum, row) => sum + toCount(row.orders), 0);
  const complaints = rows.reduce((sum, row) => sum + toCount(row.complaints), 0);
  const awt = rows.reduce((sum, row) => sum + toCount(row.awt), 0);
  const refuted = rows.reduce((sum, row) => sum + toCount(row.refuted), 0);
  const accepted = rows.reduce((sum, row) => sum + toCount(row.accepted), 0);
  const pending = rows.reduce((sum, row) => sum + toCount(row.pending), 0);
  return {
    id,
    rows,
    orders,
    complaints,
    awt,
    refuted,
    accepted,
    pending,
    complaintPct: complaintRate(orders, complaints),
    awtPct: complaintRate(orders, awt),
    refutedPctOfComplaints: ratioPct(refuted, complaints),
    acceptedPctOfComplaints: ratioPct(accepted, complaints),
  };
}

function delta(current, previous) {
  if (current == null || previous == null) return null;
  return Number(current) - Number(previous);
}

function toCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

function toOptionalCount(value) {
  if (value == null || value === '') return null;
  return toCount(value);
}
