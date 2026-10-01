import { getComplaintAggregator } from './aggregators.js';
import { complaintRowStatus } from './complaintMatch.js';
import { COMPLAINT_STATUSES, complaintDay } from './complaintHistory.js';

// Plazos de refutación por agregador. La queja «vencida» no se persiste: se
// calcula en cada render a partir del día del pedido, de modo que cambiar los
// días en Ajustes reevalúa todo el historial sin migrar datos.
export const DEFAULT_REFUTADO_DAYS = 7;
// 0 (o negativo) = sin límite: la queja nunca se marca vencida.
export const REFUTADO_DAYS_MIN = 0;
export const REFUTADO_DAYS_MAX = 90;
// Etiqueta de display; el estado guardado en el historial sigue siendo 'queja'
// (las métricas y el dinero no cambian retroactivamente).
export const QUEJA_VENCIDA_STATUS = 'queja_vencida';

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

export function emptyRefutadoDays() {
  return {
    default: DEFAULT_REFUTADO_DAYS,
    pedidosya: DEFAULT_REFUTADO_DAYS,
    rappi: DEFAULT_REFUTADO_DAYS,
    rappi_turbo: DEFAULT_REFUTADO_DAYS,
    mercadopago: DEFAULT_REFUTADO_DAYS,
  };
}

function toDays(value, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(REFUTADO_DAYS_MAX, Math.max(REFUTADO_DAYS_MIN, number));
}

export function normalizeRefutadoDays(raw) {
  const base = emptyRefutadoDays();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const fallback = toDays(raw.default, DEFAULT_REFUTADO_DAYS);
  const next = { default: fallback };
  for (const key of Object.keys(base)) {
    if (key === 'default') continue;
    next[key] = toDays(raw[key], fallback);
  }
  return next;
}

export function refutadoDeadlineDays(config, aggregator) {
  const days = normalizeRefutadoDays(config);
  return aggregator && Object.hasOwn(days, aggregator) ? days[aggregator] : days.default;
}

// Hoy en Argentina (en-CA → 'YYYY-MM-DD'). Está duplicado a propósito respecto
// de metrics.js: ese módulo importa este archivo para el shape del store y
// aquí no podemos crear el ciclo.
function todayIso(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ });
}

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function dayNumber(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function addDaysIso(day, amount) {
  const [year, month, date] = String(day).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + amount);
  return utc.toISOString().slice(0, 10);
}

/** Día límite (inclusive) para refutar: día del pedido + días del agregador.
 * null cuando no hay plazo (0 = sin límite o fecha inválida). */
export function refutadoDeadlineDate(day, config, aggregator) {
  if (!isDay(day)) return null;
  const days = refutadoDeadlineDays(config, aggregator);
  if (!days) return null;
  return addDaysIso(day, days);
}

/** Días que faltan para vencer; negativo si ya venció. null sin fecha válida. */
export function refutadoDaysLeft(day, config, aggregator, today = todayIso()) {
  const deadline = refutadoDeadlineDate(day, config, aggregator);
  if (!deadline || !isDay(today)) return null;
  return dayNumber(deadline) - dayNumber(today);
}

export function isRefutadoExpired(day, config, aggregator, today = todayIso()) {
  const left = refutadoDaysLeft(day, config, aggregator, today);
  return left != null && left < 0;
}

function rowDeadlineSource(row) {
  const status = complaintRowStatus(row);
  const day =
    row?.history?.day ||
    complaintDay({ orderAtIso: row?.complaint?.orderAtIso, day: row?.complaint?.day }) ||
    '';
  const aggregator =
    row?.history?.aggregator || getComplaintAggregator(row?.complaint, row?.photo) || null;
  return { status, day, aggregator };
}

/** Estado a mostrar en UI: 'queja' vencida se etiqueta 'queja_vencida'. */
export function resolveDisplayStatus(row, config, today = todayIso()) {
  const { status, day, aggregator } = rowDeadlineSource(row);
  if (status !== COMPLAINT_STATUSES.queja) return status;
  return isRefutadoExpired(day, config, aggregator, today)
    ? QUEJA_VENCIDA_STATUS
    : status;
}

/**
 * Aviso «Vence hoy / mañana / en X d» para quejas en 'queja' cerca del
 * límite (≤3 días). Vencidas o ya refutadas no llevan aviso.
 */
export function refutadoExpiryHint(row, config, today = todayIso(), { warnDays = 3 } = {}) {
  const { status, day, aggregator } = rowDeadlineSource(row);
  if (status !== COMPLAINT_STATUSES.queja) return null;
  const left = refutadoDaysLeft(day, config, aggregator, today);
  if (left == null || left < 0 || left > warnDays) return null;
  if (left === 0) return 'Vence hoy';
  if (left === 1) return 'Vence mañana';
  return `Vence en ${left} d`;
}
