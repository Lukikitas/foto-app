import { detectAggregator, getAggregatorLabel } from './aggregators.js';

const CODE_LABEL =
  /C\s*[O0]\s*D(?:\s*[I1L]\s*G\s*[O0](?:\s+PED(?:IDO)?)?|\s+PED(?:IDO)?)\s*[:.;-]?\s*/;

const AGGREGATOR_PREFIX = /\b(RAPPITURBO|PEYA|RAPPI|MPD|MP)(?=[0-9\s-]|$)/;

const BARE_PREFIXES = new Set(['PEYA', 'RAPPI', 'RAPPITURBO', 'MPD', 'MP']);

const STOP_WORDS = new Set([
  'TOTAL',
  'SUBTOTAL',
  'IMPORTE',
  'PESOS',
  'ARS',
  'PAGO',
  'EFECTIVO',
  'QR',
  'IVA',
  'CANTIDAD',
  'FECHA',
  'HORA',
  'DIRECCION',
  'CLIENTE',
  'ARTICULOS',
  'ITEMS',
]);

const MIN_EXTRA_STRICT = {
  RAPPITURBO: 3,
  PEYA: 4,
  RAPPI: 4,
  MPD: 4,
  MP: 6,
};

function normalizeLine(value = '') {
  return value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^A-Z0-9\s:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactCode(value = '') {
  return value.replace(/[^A-Z0-9-]/g, '');
}

function repairKnownPrefixes(value = '') {
  return value
    .replace(/P[E3][\s-]*[VY][\s-]*[A4](?=[A-Z0-9\s-]|$)/g, 'PEYA')
    .replace(/R[A4][\s-]*P[\s-]*P[\s-]*[I1L](?=[A-Z0-9\s-]|$)/g, 'RAPPI');
}

function textAfterLabel(line) {
  const match = line.match(CODE_LABEL);
  if (!match) return '';
  return line.slice(match.index + match[0].length).trim();
}

function isBarePrefix(text) {
  return BARE_PREFIXES.has(compactCode(text).replace(/-/g, ''));
}

function makeAggregatorResult(displayCode, aggregator) {
  return {
    displayCode: displayCode.slice(0, 32),
    aggregator,
    aggregatorLabel: getAggregatorLabel(aggregator),
  };
}

function makeNumericResult(displayCode) {
  return {
    displayCode,
    aggregator: null,
    aggregatorLabel: getAggregatorLabel(null),
  };
}

function collectCodeRest(source, startIndex) {
  const after = source.slice(startIndex).trim();
  if (!after) return '';

  const tokens = after.split(/\s+/).filter(Boolean);
  const parts = [];

  for (const token of tokens) {
    if (/^\d+[.,]\d{2}$/.test(token)) break;

    const compact = compactCode(token).replace(/^-+/, '');
    if (!compact) continue;
    if (STOP_WORDS.has(compact) || STOP_WORDS.has(compact.replace(/-/g, ''))) break;

    const lettersOnly = /^[A-Z]+$/.test(compact.replace(/-/g, ''));
    if (parts.length > 0 && lettersOnly && compact.replace(/-/g, '').length >= 4) break;

    parts.push(compact);
  }

  return parts.join('');
}

function parseAggregatorCode(text, { strict = false, repair = false } = {}) {
  const source = repair ? repairKnownPrefixes(normalizeLine(text)) : normalizeLine(text);
  if (!source) return null;

  const matcher = new RegExp(AGGREGATOR_PREFIX.source, 'g');
  let match;

  while ((match = matcher.exec(source))) {
    const prefix = match[1];
    const rest = collectCodeRest(source, match.index + match[0].length);
    const needed = strict ? MIN_EXTRA_STRICT[prefix] || 4 : 1;

    const restBody = rest.replace(/-/g, '');
    if (restBody.length < needed) continue;
    if (strict && rest.replace(/\D/g, '').length < 4) continue;

    const aggregator = detectAggregator(prefix);
    if (!aggregator) continue;

    return makeAggregatorResult(`${prefix}${rest}`, aggregator);
  }

  return null;
}

function parseNumericCode(text) {
  const source = normalizeLine(text);
  if (!source) return null;

  const dashed = source.match(/\b(\d{1,4}-\d{4,})\b/);
  if (dashed) return makeNumericResult(dashed[1]);

  const digits = source.match(/\b(\d{4,})\b/);
  if (!digits) return null;

  return makeNumericResult(digits[1].slice(-4));
}

function getCodeAfterLabel(line, nextLine = '') {
  const afterLabel = repairKnownPrefixes(textAfterLabel(line));
  const candidate = !afterLabel || isBarePrefix(afterLabel)
    ? `${afterLabel} ${nextLine}`.trim()
    : afterLabel;

  return (
    parseAggregatorCode(candidate, { repair: true }) ||
    parseNumericCode(candidate)
  );
}

/** Extracts an order code from noisy OCR text. */
export function detectOrderCode(ocrText) {
  const raw = String(ocrText || '');
  const lines = raw
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    if (!CODE_LABEL.test(lines[index])) continue;

    const code = getCodeAfterLabel(lines[index], lines[index + 1] || '');
    if (code) return code;
  }

  const full = normalizeLine(raw.replace(/\r?\n/g, ' '));
  if (CODE_LABEL.test(full)) {
    const labeled = getCodeAfterLabel(full, '');
    if (labeled) return labeled;
  }

  return parseAggregatorCode(full, { strict: true });
}
