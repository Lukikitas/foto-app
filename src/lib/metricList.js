import { AWT_AGGREGATOR, argentinaToday, emptyDayStats, isIsoDate, METRIC_AGGREGATORS, parseStore, upsertDayStats } from './metrics.js';

const WEEKDAYS = new Set([
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
  'lun',
  'mar',
  'mie',
  'jue',
  'vie',
  'sab',
  'dom',
]);

const MONTHS = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  set: 9,
  setiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};

export function parseMetricList(text, { year, today = argentinaToday() } = {}) {
  const defaultYear = Number.isFinite(Number(year)) ? Number(year) : Number(String(today).slice(0, 4));
  const rows = [];
  const errors = [];
  const seen = new Set();

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isHeaderLine(line)) continue;

    const parsed = parseMetricLine(line, defaultYear, today);
    if (!parsed) {
      errors.push({ line, message: 'No se pudo leer la fecha o los números.' });
      continue;
    }
    if (seen.has(parsed.day)) {
      errors.push({ line, message: `El día ${parsed.day} está repetido.` });
      continue;
    }
    seen.add(parsed.day);
    rows.push(parsed);
  }

  return { rows, errors };
}

export function applyMetricList(store, aggregator, rows) {
  let next = parseStore(store);
  if (!METRIC_AGGREGATORS.includes(aggregator)) return next;

  for (const row of rows || []) {
    if (!isIsoDate(row.day)) continue;
    const existing = next.days?.[row.day]?.[aggregator] || emptyDayStats();
    next = upsertDayStats(next, row.day, aggregator, {
      orders: row.orders,
      complaints: row.complaints,
      awt: aggregator === AWT_AGGREGATOR ? row.awt : existing.awt,
    });
  }

  return next;
}

function parseMetricLine(line, year, today) {
  const tokens = tokenize(line);
  if (tokens.length < 3) return null;

  const extracted = extractDate(tokens, year, today);
  if (!extracted) return null;

  const numbers = extracted.rest.map(parseCount).filter((value) => value != null);
  if (numbers.length < 2) return null;

  return {
    day: extracted.day,
    orders: numbers[0],
    complaints: numbers[1],
    awt: numbers[2] || 0,
    raw: line,
  };
}

function extractDate(tokens, year, today) {
  for (let index = 0; index < tokens.length; index += 1) {
    const direct = parseDateToken(tokens[index], year, today);
    if (direct) {
      return { day: direct, rest: tokens.filter((_, current) => current !== index) };
    }

    if (index + 1 < tokens.length) {
      const joined = parseDateToken(`${tokens[index]}-${tokens[index + 1]}`, year, today);
      if (joined) {
        return {
          day: joined,
          rest: tokens.filter((_, current) => current !== index && current !== index + 1),
        };
      }
    }
  }
  return null;
}

function parseDateToken(token, year, today) {
  const value = fold(token);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isIsoDate(value) ? value : null;

  const word = value.match(/^(\d{1,2})[-/.]([a-z]+)$/);
  if (word) {
    const month = MONTHS[word[2]];
    if (!month) return null;
    return makeDate(year, month, Number(word[1]), today);
  }

  const numeric = value.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const explicitYear = numeric[3] ? fullYear(numeric[3]) : year;
    return makeDate(explicitYear, month, day, today);
  }

  return null;
}

function makeDate(year, month, day, today) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
  if (!isIsoDate(candidate)) return null;
  const date = new Date(`${candidate}T00:00:00Z`);
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  if (candidate > today && String(year) === String(today).slice(0, 4)) {
    return makeDate(year - 1, month, day, today);
  }
  return candidate;
}

function tokenize(line) {
  const parts = line.includes('\t') ? line.split('\t') : line.trim().split(/\s+/);
  return parts.map((part) => part.trim()).filter(Boolean).filter((part) => !WEEKDAYS.has(fold(part)));
}

function isHeaderLine(line) {
  const folded = fold(line);
  return folded.includes('pedido') && folded.includes('queja');
}

function parseCount(token) {
  const folded = String(token).trim().replace(/\s/g, '');
  if (!folded) return null;
  const thousands = folded.match(/^\d{1,3}(\.\d{3})+$/);
  const normalized = thousands ? folded.replace(/\./g, '') : folded.replace(',', '.');
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function fold(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function fullYear(token) {
  const year = Number(token);
  if (String(token).length === 2) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}
