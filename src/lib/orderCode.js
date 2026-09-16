import { detectAggregator, getAggregatorLabel } from './aggregators.js';

const CODIGO_LABEL =
  /C\s*[O0]\s*D(?:\s*[I1L]\s*G\s*[O0](?:\s+PED(?:IDO)?)?|\s+PED(?:IDO)?)\s*[:.;#-]?\s*/;

const AGGREGATOR_PREFIX = /\b(RAPPITURBO|PEYA|RAPPI|MPD)(?=[\s-]?[A-Z0-9])/;

const BARE_PREFIXES = new Set(['PEYA', 'RAPPI', 'RAPPITURBO', 'MPD']);

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

const COMPACT_JUNK = /(?:TOTAL|SUBTOTAL|IMPORTE|PESOS|ARS|EFECTIVO|CANTIDAD|FECHA|HORA|CLIENTE|ARTICULOS).*$/;

const MIN_EXTRA = {
  RAPPITURBO: 3,
  PEYA: 4,
  RAPPI: 4,
  MPD: 4,
};

const PREFIXES = [
  ['RAPPITURBO', 'rappi_turbo'],
  ['PEYA', 'pedidosya'],
  ['RAPPI', 'rappi'],
  ['MPD', 'mercadopago'],
];

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

function compactAlnum(value = '') {
  return value.replace(/[^A-Z0-9]/g, '');
}

function repairKnownPrefixes(value = '') {
  return value
    .replace(/P[E3][\s-]*[VY][\s-]*[A4](?=[A-Z0-9\s-]|$)/g, 'PEYA')
    .replace(/R[A4][\s-]*P[\s-]*P[\s-]*[I1L](?=[A-Z0-9\s-]|$)/g, 'RAPPI');
}

function textAfterLabel(line) {
  const match = line.match(CODIGO_LABEL);
  if (!match) return '';
  return line.slice(match.index + match[0].length).trim();
}

function isBarePrefix(text) {
  return BARE_PREFIXES.has(compactAlnum(text));
}

function makeAggregatorResult(displayCode, aggregator) {
  return {
    displayCode: displayCode.slice(0, 32),
    aggregator,
    aggregatorLabel: getAggregatorLabel(aggregator),
  };
}

function stripTrailingJunk(value = '') {
  return value.replace(COMPACT_JUNK, '').replace(/[A-Z]{4,}$/g, '');
}

function collectCodeRest(source, startIndex) {
  const rawAfter = source.slice(startIndex);
  const leadingHyphen = /^\s*-/.test(rawAfter);
  const after = rawAfter.trim().replace(/^-+/, '').trim();
  if (!after) return '';

  const tokens = after.split(/\s+/).filter(Boolean);
  const parts = [];

  for (const token of tokens) {
    if (/^\d+[.,]\d{2}$/.test(token)) break;

    const compact = stripTrailingJunk(compactCode(token).replace(/^-+/, ''));
    if (!compact) break;
    if (STOP_WORDS.has(compact) || STOP_WORDS.has(compactAlnum(compact))) break;

    const lettersOnly = /^[A-Z]+$/.test(compactAlnum(compact));
    if (parts.length > 0 && lettersOnly && compactAlnum(compact).length >= 4) break;

    parts.push(compact);
  }

  const rest = parts.join('');
  if (!rest) return '';
  return leadingHyphen ? `-${rest}` : rest;
}

function isReliableCode(prefix, rest) {
  const restBody = compactAlnum(rest);
  const needed = MIN_EXTRA[prefix] || 4;
  const digits = rest.replace(/\D/g, '');
  return restBody.length >= needed && digits.length >= 3;
}

function parseAggregatorPrefixMatch(source) {
  const matcher = new RegExp(AGGREGATOR_PREFIX.source, 'g');
  let match;

  while ((match = matcher.exec(source))) {
    const prefix = match[1];
    const rest = collectCodeRest(source, match.index + match[0].length);
    if (!isReliableCode(prefix, rest)) continue;

    const aggregator = detectAggregator(prefix);
    if (!aggregator) continue;

    return makeAggregatorResult(`${prefix}${rest}`, aggregator);
  }

  return null;
}

function parseAggregatorCode(text) {
  const source = repairKnownPrefixes(normalizeLine(text));
  if (!source) return null;
  return parseAggregatorPrefixMatch(source);
}

function parseCompactAggregator(text) {
  const compact = compactAlnum(repairKnownPrefixes(normalizeLine(text)));
  if (!compact) return null;

  for (const [prefix, aggregator] of PREFIXES) {
    let from = 0;
    while (from < compact.length) {
      const idx = compact.indexOf(prefix, from);
      if (idx === -1) break;
      from = idx + 1;

      let rest = stripTrailingJunk(compact.slice(idx + prefix.length)).slice(0, 28);
      if (!isReliableCode(prefix, rest)) continue;

      return makeAggregatorResult(`${prefix}${rest}`, aggregator);
    }
  }

  return null;
}

function getCodeAfterLabel(line, nextLine = '') {
  const afterLabel = repairKnownPrefixes(textAfterLabel(line));
  const candidate = !afterLabel || isBarePrefix(afterLabel)
    ? `${afterLabel} ${nextLine}`.trim()
    : afterLabel;

  return parseAggregatorCode(candidate);
}

function scanLabeledLines(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!CODIGO_LABEL.test(lines[index])) continue;
    const code = getCodeAfterLabel(lines[index], lines[index + 1] || '');
    if (code) return code;
  }
  return null;
}

/** Extracts a reliable aggregator order code from OCR text. */
export function detectOrderCode(ocrText) {
  const raw = String(ocrText || '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => repairKnownPrefixes(normalizeLine(line)))
    .filter(Boolean);

  const fromCodigo = scanLabeledLines(lines);
  if (fromCodigo) return fromCodigo;

  const full = repairKnownPrefixes(normalizeLine(raw.replace(/\r?\n/g, ' ')));
  if (CODIGO_LABEL.test(full)) {
    const labeled = getCodeAfterLabel(full, '');
    if (labeled) return labeled;
  }

  return parseCompactAggregator(raw);
}
