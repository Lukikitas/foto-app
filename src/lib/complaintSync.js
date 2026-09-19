import { addDays, ARGENTINA_TZ, isIsoDate } from './metrics.js';

export const DAILY_IMPORT_HOUR = 13;
export const DAILY_IMPORT_MINUTE = 30;

export function emptyComplaintSync() {
  return {
    version: 1,
    sheetUrl: '',
    lastImportAt: null,
    lastImportDay: null,
    updatedAt: null,
  };
}

export function parseComplaintSync(raw) {
  const sync = emptyComplaintSync();
  if (!raw || typeof raw !== 'object') return sync;

  sync.sheetUrl = typeof raw.sheetUrl === 'string' ? raw.sheetUrl.trim() : '';
  sync.lastImportAt = typeof raw.lastImportAt === 'string' && raw.lastImportAt ? raw.lastImportAt : null;
  sync.lastImportDay = isIsoDate(raw.lastImportDay) ? raw.lastImportDay : null;
  sync.updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : null;
  sync.version = 1;
  return sync;
}

export function argentinaDateTimeParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second || 0),
    date: `${bag.year}-${bag.month}-${bag.day}`,
  };
}

function dateFromArgentinaParts({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const seen = argentinaDateTimeParts(new Date(utcGuess));
  const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(utcGuess + (wantedAsUtc - seenAsUtc));
}

export function isAfterDailyImportCutoff(
  now = new Date(),
  hour = DAILY_IMPORT_HOUR,
  minute = DAILY_IMPORT_MINUTE,
) {
  const parts = argentinaDateTimeParts(now);
  return parts.hour > hour || (parts.hour === hour && parts.minute >= minute);
}

export function hasDailyImportForToday(sync, now = new Date()) {
  return Boolean(sync?.lastImportDay && sync.lastImportDay === argentinaDateTimeParts(now).date);
}

export function nextDailyImportAt(
  now = new Date(),
  hour = DAILY_IMPORT_HOUR,
  minute = DAILY_IMPORT_MINUTE,
) {
  const parts = argentinaDateTimeParts(now);
  const todayCutoff = dateFromArgentinaParts({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute,
  });
  if (now.getTime() < todayCutoff.getTime()) return todayCutoff;
  const [year, month, day] = addDays(parts.date, 1).split('-').map(Number);
  return dateFromArgentinaParts({ year, month, day, hour, minute });
}

export function msUntilDailyImportCutoff(now = new Date()) {
  return Math.max(0, nextDailyImportAt(now).getTime() - now.getTime());
}

export function dailyImportDecision(sync, now = new Date()) {
  if (!String(sync?.sheetUrl || '').trim()) return 'no_url';
  if (!isAfterDailyImportCutoff(now)) return 'before_cutoff';
  if (hasDailyImportForToday(sync, now)) return 'already_done';
  return 'run';
}

export function applyManualCruzarToSync(sync, url, now = new Date()) {
  const next = parseComplaintSync(sync);
  const trimmed = String(url || '').trim();
  if (trimmed) next.sheetUrl = trimmed;
  next.lastImportAt = now.toISOString();
  if (isAfterDailyImportCutoff(now)) {
    next.lastImportDay = argentinaDateTimeParts(now).date;
  }
  return next;
}

export function formatArgentinaDateTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleString('es-AR', {
    timeZone: ARGENTINA_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dailyImportStatusMessage(sync, now = new Date()) {
  if (!String(sync?.sheetUrl || '').trim()) {
    return 'Guardá el link del Sheet para cruzarlo solo, después de las 13:30, en todos los dispositivos.';
  }
  if (hasDailyImportForToday(sync, now)) {
    const when = formatArgentinaDateTime(sync.lastImportAt);
    return when
      ? `Cruce automático de hoy listo (${when}).`
      : 'Cruce automático de hoy listo.';
  }
  if (isAfterDailyImportCutoff(now)) {
    return 'Hoy todavía no se cruzó. Se hace al abrir la app (después de las 13:30).';
  }
  return 'El cruce automático se hace después de las 13:30 (hora Argentina), la primera vez que alguien abre la app.';
}
