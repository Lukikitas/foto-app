import { AGGREGATORS, getAggregatorLabel, getPhotoAggregator } from './aggregators.js';
import { emptyRefutadoDays, normalizeRefutadoDays } from './refutadoDeadline.js';
import { METRICS_BASELINE } from './metricsBaseline.js';

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
  { id: 'complaints', label: 'Quejas' },
  { id: 'staff', label: 'Desempeño' },
  { id: 'report', label: 'Informe' },
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
  return { orders: 0, complaints: 0, awt: 0 };
}

export function emptyStore() {
  return {
    version: 1,
    targetComplaintPct: DEFAULT_COMPLAINT_TARGET_PCT,
    targetAwtPct: DEFAULT_AWT_TARGET_PCT,
    // Días por agregador para refutar antes de marcar «Queja vencida».
    refutadoDays: emptyRefutadoDays(),
    updatedAt: null,
    days: {},
    photographerAliases: {},
  };
}

export function parseStore(raw) {
  const store = emptyStore();
  if (!raw || typeof raw !== 'object') return store;
  if (raw[METRICS_BASELINE]) store[METRICS_BASELINE] = raw[METRICS_BASELINE];

  const target = Number(raw.targetComplaintPct);
  if (Number.isFinite(target) && target >= 0 && target <= 100) {
    store.targetComplaintPct = target;
  }

  const awtTarget = Number(raw.targetAwtPct);
  if (Number.isFinite(awtTarget) && awtTarget >= 0 && awtTarget <= 100) {
    store.targetAwtPct = awtTarget;
  }

  store.refutadoDays = normalizeRefutadoDays(raw.refutadoDays);
  store.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  store.version = 1;
  store.photographerAliases = normalizePhotographerAliases(raw.photographerAliases);
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
  const stats = {
    orders: toCount(row.orders),
    complaints: toCount(row.complaints),
    awt: toCount(row.awt),
  };
  if (row.reported && typeof row.reported === 'object') {
    stats.reported = Object.fromEntries(['orders', 'complaints', 'awt'].map(key => [key, row.reported[key] === true ? true : row.reported[key] === false ? false : null]));
    stats.sources = Object.fromEntries(['orders', 'complaints', 'awt'].map(key => [key, String(row.sources?.[key] || '')]));
  }
  return stats;
}

export function normalizePhotographerAliases(raw = {}) {
  const aliases = {};
  for (const [from, to] of Object.entries(raw || {})) {
    const key = from.trim().replace(/\s+/g, ' ').toLowerCase();
    const label = String(to || '').trim().replace(/\s+/g, ' ');
    if (key && label && key !== label.toLowerCase()) aliases[key] = label;
  }
  // Flatten aliases and drop cycles; stored authors are never rewritten.
  const resolved = {};
  for (const key of Object.keys(aliases)) {
    const seen = new Set([key]); let target = aliases[key];
    while (aliases[target.toLowerCase()]) {
      if (seen.has(target.toLowerCase())) { target = ''; break; }
      seen.add(target.toLowerCase()); target = aliases[target.toLowerCase()];
    }
    if (target) resolved[key] = target;
  }
  return resolved;
}

export function reportedDayStats(stats, source = 'manual', fields = ['orders', 'complaints', 'awt']) {
  return { ...stats,
    reported: { ...stats.reported, ...Object.fromEntries(fields.map(key => [key, true])) },
    sources: { ...stats.sources, ...Object.fromEntries(fields.map(key => [key, source])) },
  };
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    year: 'numeric',
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
    return { from: startOfWeek(today), to: today };
  }
  if (preset === 'month') {
    return { from: startOfMonth(today), to: today };
  }
  if (preset === 'custom') {
    const from = isIsoDate(customFrom) ? customFrom : today;
    const to = isIsoDate(customTo) ? customTo : from;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return { from: today, to: today };
}

export function lastLoadedMetricsDay(store, today = argentinaToday()) {
  return (store?.availableLastDay && store.availableLastDay <= today ? store.availableLastDay : null) || Object.keys(store?.days || {})
    .filter(day => isIsoDate(day) && day <= today && METRIC_AGGREGATORS.some(id => {
      const stats = store.days[day]?.[id];
      return stats && ['orders', 'complaints', ...(id === AWT_AGGREGATOR ? ['awt'] : [])]
        .some(key => stats[key] != null && stats.reported?.[key] !== false);
    }))
    .sort().at(-1);
}
export function resolveAvailablePeriod(preset, store, today = argentinaToday(), customFrom = '', customTo = '') {
  if (!['week', 'month', 'days7'].includes(preset)) {
    return resolvePeriod(preset, today, customFrom, customTo);
  }
  const lastLoadedDay = lastLoadedMetricsDay(store,today);
  // Anchor automatic periods to the latest saved day. This also keeps a
  // Monday with no loads from producing an empty or reversed weekly range.
  return resolvePeriod(preset, lastLoadedDay || today, customFrom, customTo);
}

export function previousPeriod(from, to, preset = '') {
  if (preset === 'week') return { from: addDays(from, -7), to: addDays(to, -7) };
  if (preset === 'month') {
    const prevFrom = startOfMonth(addDays(startOfMonth(from), -1));
    const candidate = `${prevFrom.slice(0, 7)}-${to.slice(8)}`;
    return { from: prevFrom, to: candidate > endOfMonth(prevFrom) ? endOfMonth(prevFrom) : candidate };
  }
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
  const value = Number(part);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(value)) return null;
  return (value / total) * 100;
}

export function isOutOfTarget(rate, target = DEFAULT_COMPLAINT_TARGET_PCT) {
  if (rate == null || !Number.isFinite(rate)) return false;
  return rate > Number(target);
}

export function formatPct(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toLocaleString('es-AR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatNumber(value) {
  return toCount(value).toLocaleString('es-AR');
}

export function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
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

function emptyResolution() {
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

export function resolveDayAggregator(store, photoFlags, day, aggregator, historyFlags = {}) {
  const entered = store?.days?.[day]?.[aggregator] || emptyDayStats();
  const history = historyFlags?.[day]?.[aggregator] || emptyResolution();
  const orders = toCount(entered.orders);
  const complaints = toCount(entered.complaints);
  const awt = toCount(entered.awt);
  const missingRate = entered.reported?.orders === false || entered.reported?.complaints === false;
  const missingAwt = entered.reported?.orders === false || entered.reported?.awt === false;
  const rate = missingRate ? null : complaintRate(orders, complaints);
  const complaintAmount = Number(history.complaintAmount) || 0;
  const recoveredAmount = Number(history.recoveredAmount) || 0;
  const undisputedAmount = Number(history.undisputedAmount) || 0;
  const inProgressAmount = Number(history.inProgressAmount) || 0;
  const confirmedLostAmount = Number(history.confirmedLostAmount) || 0;
  const pendingAmount = Number(history.pendingAmount) || 0;
  const finalLostAmount = Number(history.finalLostAmount) || 0;
  const lostAmount = confirmedLostAmount + undisputedAmount;

  return {
    aggregator,
    day,
    orders,
    complaints,
    awt,
    queja: toCount(history.queja),
    refutado: toCount(history.refutado),
    refutadoAceptado: toCount(history.refutadoAceptado),
    refutadoRechazado: toCount(history.refutadoRechazado),
    noRefutable: toCount(history.noRefutable),
    complaintAmount,
    recoveredAmount,
    lostAmount,
    undisputedAmount,
    inProgressAmount,
    disputedAmount: inProgressAmount,
    confirmedLostAmount,
    pendingAmount,
    finalLostAmount,
    missingMoney: history.missingMoney || {},
    missingAmountCount: toCount(history.missingAmountCount),
    historyCount: toCount(history.queja) + toCount(history.refutado) + toCount(history.refutadoAceptado) + toCount(history.refutadoRechazado) + toCount(history.noRefutable),
    loadState: !store?.days?.[day]?.[aggregator] ? 'missing' : !entered.reported || Object.values(entered.reported).some(value=>value===null) ? 'legacy' :
      entered.reported.orders && entered.reported.complaints && (aggregator !== AWT_AGGREGATOR || entered.reported.awt) ? 'complete' : 'partial',
    missingRate, missingAwt,
    complaintPct: rate,
    awtPct: missingAwt ? null : complaintRate(orders, awt),
    recoveredPctOfAmount: ratioPct(recoveredAmount, complaintAmount),
  };
}

function hasResolution(row) {
  return (
    row.complaintAmount > 0 ||
    row.queja > 0 ||
    row.refutado > 0 ||
    row.refutadoAceptado > 0 ||
    row.refutadoRechazado > 0 ||
    row.noRefutable > 0
  );
}

export function summarizeRange(store, photoFlags, from, to, historyFlags = {}) {
  const days = enumerateDays(from, to);
  const aggregators = METRIC_AGGREGATORS.map((aggregator) => {
    const rows = days.map((day) =>
      resolveDayAggregator(store, photoFlags, day, aggregator, historyFlags),
    );
    return rollupRows(aggregator, rows);
  });

  const extraRows = days
    .map((day) => resolveDayAggregator(store, photoFlags, day, 'sin_agregador', historyFlags))
    .filter(hasResolution);
  const overallRows = aggregators.flatMap((item) => item.rows);
  const overall = rollupRows('all', [...overallRows, ...extraRows]);
  const awtRow = aggregators.find(row => row.id === AWT_AGGREGATOR);
  overall.awtPct = awtRow.awtPct;
  const daily = days.map((day) => {
    const rows = METRIC_AGGREGATORS.map((aggregator) =>
      resolveDayAggregator(store, photoFlags, day, aggregator, historyFlags),
    );
    const extra = resolveDayAggregator(store, photoFlags, day, 'sin_agregador', historyFlags);
    const combined = rollupRows(day, hasResolution(extra) ? [...rows, extra] : rows);
    combined.awtPct = rows.find(row => row.aggregator === AWT_AGGREGATOR).awtPct;
    return {
      day,
      ...combined,
      aggregators: rows,
    };
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
    complaintAmount: delta(current.complaintAmount, previous.complaintAmount),
    recoveredAmount: delta(current.recoveredAmount, previous.recoveredAmount),
    lostAmount: delta(current.lostAmount, previous.lostAmount),
    outOfTarget: isOutOfTarget(current.complaintPct, target),
    outOfAwtTarget: isOutOfTarget(current.awtPct, awtTarget),
    previousOutOfTarget: isOutOfTarget(previous.complaintPct, target),
  };
}

export function upsertDayStats(store, day, aggregator, stats) {
  const next = parseStore(store);
  if (!isIsoDate(day) || !METRIC_AGGREGATORS.includes(aggregator)) return next;

  const normalized = normalizeDayStats(stats);
  const empty = normalized.orders === 0 && normalized.complaints === 0 && normalized.awt === 0;

  if (!next.days[day]) next.days[day] = {};
  if (empty && !Object.values(normalized.reported || {}).some(value => value !== false)) delete next.days[day][aggregator];
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

export function setRefutadoDays(store, days) {
  const next = parseStore(store);
  next.refutadoDays = normalizeRefutadoDays(days);
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
  const queja = rows.reduce((sum, row) => sum + toCount(row.queja), 0);
  const refutado = rows.reduce((sum, row) => sum + toCount(row.refutado), 0);
  const refutadoAceptado = rows.reduce((sum, row) => sum + toCount(row.refutadoAceptado), 0);
  const refutadoRechazado = rows.reduce((sum, row) => sum + toCount(row.refutadoRechazado), 0);
  const noRefutable = rows.reduce((sum, row) => sum + toCount(row.noRefutable), 0);
  const complaintAmount = rows.reduce((sum, row) => sum + (Number(row.complaintAmount) || 0), 0);
  const recoveredAmount = rows.reduce((sum, row) => sum + (Number(row.recoveredAmount) || 0), 0);
  const undisputedAmount = rows.reduce((sum, row) => sum + (Number(row.undisputedAmount) || 0), 0);
  const inProgressAmount = rows.reduce((sum, row) => sum + (Number(row.inProgressAmount) || 0), 0);
  const confirmedLostAmount = rows.reduce((sum, row) => sum + (Number(row.confirmedLostAmount) || 0), 0);
  return {
    id,
    rows,
    orders,
    complaints,
    awt,
    queja,
    refutado,
    refutadoAceptado,
    refutadoRechazado,
    noRefutable,
    complaintAmount,
    recoveredAmount,
    lostAmount: confirmedLostAmount + undisputedAmount,
    undisputedAmount,
    inProgressAmount,
    disputedAmount: inProgressAmount,
    confirmedLostAmount,
    pendingAmount: rows.reduce((sum, row) => sum + (Number(row.pendingAmount) || 0), 0),
    finalLostAmount: rows.reduce((sum, row) => sum + (Number(row.finalLostAmount) || 0), 0),
    missingMoney: Object.fromEntries(['complaintAmount','recoveredAmount','inProgressAmount','pendingAmount','finalLostAmount','lostAmount'].map(key => [key, rows.reduce((sum,row) => sum + (row.missingMoney?.[key] || 0),0)])),
    missingAmountCount: rows.reduce((sum, row) => sum + toCount(row.missingAmountCount), 0),
    historyCount: rows.reduce((sum, row) => sum + toCount(row.historyCount), 0),
    complaintPct: rows.some(row=>row.missingRate) ? null : complaintRate(orders, complaints),
    awtPct: rows.some(row=>row.missingAwt) ? null : complaintRate(orders, awt),
    recoveredPctOfAmount: ratioPct(recoveredAmount, complaintAmount),
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

export function formatKnownMoney(value, missing = 0) { return missing && !Number(value) ? "Sin montos conocidos" : formatMoney(value) + (missing ? " (parcial)" : ""); }
