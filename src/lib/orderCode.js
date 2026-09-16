import { detectAggregator, getAggregatorLabel } from './aggregators.js';

const CODIGO_LABEL =
  /C\s*[O0]\s*D(?:\s*[I1L]\s*G\s*[O0](?:\s+PED(?:IDO)?)?|\s+PED(?:IDO)?)\s*[:.;#-]?\s*/;

const OTHER_LABEL = /\b(?:PEDIDO|ORDEN|ORDER)\s*[:.;#-]?\s*/;

const AGGREGATOR_PREFIX = /\b(RAPPITURBO|PEYA|RAPPI|MPD)(?=[A-Z0-9\s-])|\b(MP)(?=[0-9\s-])/;

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

const COMPACT_JUNK = /(?:TOTAL|SUBTOTAL|IMPORTE|PESOS|ARS|EFECTIVO|CANTIDAD|FECHA|HORA|CLIENTE|ARTICULOS).*$/;

const MIN_EXTRA_STRICT = {
  RAPPITURBO: 3,
  PEYA: 4,
  RAPPI: 4,
  MPD: 4,
  MP: 6,
};

const PREFIXES = [
  ['RAPPITURBO', 'rappi_turbo'],
  ['PEYA', 'pedidosya'],
  ['RAPPI', 'rappi'],
  ['MPD', 'mercadopago'],
  ['MP', 'mercadopago'],
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

function textAfterLabel(line, label) {
  const match = line.match(label);
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

function makeNumericResult(displayCode) {
  return {
    displayCode,
    aggregator: null,
    aggregatorLabel: getAggregatorLabel(null),
  };
}

function stripTrailingJunk(value = '') {
  return value.replace(COMPACT_JUNK, '').replace(/[A-Z]{4,}$/g, '');
}

function collectCodeRest(source, startIndex) {
  const after = source.slice(startIndex).trim();
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

  return parts.join('');
}

function parseAggregatorPrefixMatch(source, minExtra, requireDigits) {
  const matcher = new RegExp(AGGREGATOR_PREFIX.source, 'g');
  let match;

  while ((match = matcher.exec(source))) {
    const prefix = match[1] || match[2];
    const rest = collectCodeRest(source, match.index + match[0].length);
    const restBody = compactAlnum(rest);
    const needed = minExtra === 1 ? 1 : MIN_EXTRA_STRICT[prefix] || minExtra;

    if (restBody.length < needed) continue;
    if (requireDigits && rest.replace(/\D/g, '').length < 3) continue;

    const aggregator = detectAggregator(prefix);
    if (!aggregator) continue;

    return makeAggregatorResult(`${prefix}${rest}`, aggregator);
  }

  return null;
}

function parseAggregatorCode(text, { strict = false, repair = false } = {}) {
  const source = repair ? repairKnownPrefixes(normalizeLine(text)) : normalizeLine(text);
  if (!source) return null;
  return parseAggregatorPrefixMatch(source, strict ? 4 : 1, strict);
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
      if ((prefix === 'MP' || prefix === 'MPD') && idx > 0 && /[A-Z0-9]/.test(compact[idx - 1])) {
        continue;
      }

      let rest = stripTrailingJunk(compact.slice(idx + prefix.length)).slice(0, 28);
      const needed = MIN_EXTRA_STRICT[prefix] || 4;
      const digits = rest.replace(/\D/g, '');

      if (rest.length < needed) continue;
      if (prefix === 'MP' && digits.length < 6) continue;
      if (digits.length < 3 && rest.length < needed) continue;
      if (digits.length < 3) continue;

      return makeAggregatorResult(`${prefix}${rest}`, aggregator);
    }
  }

  return null;
}

function parseNumericCode(text) {
  const source = normalizeLine(text);
  if (!source) return null;

  const dashed = source.match(/\b(\d{1,4}-\d{4,})\b/);
  if (dashed) return makeNumericResult(dashed[1]);

  const digits = source.match(/\b(\d{4,12})\b/);
  if (!digits) return null;

  return makeNumericResult(digits[1].length <= 4 ? digits[1].slice(-4) : digits[1]);
}

function getCodeAfterLabel(line, nextLine, label) {
  const afterLabel = repairKnownPrefixes(textAfterLabel(line, label));
  const candidate = !afterLabel || isBarePrefix(afterLabel)
    ? `${afterLabel} ${nextLine}`.trim()
    : afterLabel;

  return (
    parseAggregatorCode(candidate, { repair: true }) ||
    parseNumericCode(candidate)
  );
}

function scanLabeledLines(lines, label) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!label.test(lines[index])) continue;
    const code = getCodeAfterLabel(lines[index], lines[index + 1] || '', label);
    if (code) return code;
  }
  return null;
}

/** Extracts an order code from noisy OCR text. */
export function detectOrderCode(ocrText) {
  const raw = String(ocrText || '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => repairKnownPrefixes(normalizeLine(line)))
    .filter(Boolean);

  const fromCodigo = scanLabeledLines(lines, CODIGO_LABEL);
  if (fromCodigo) return fromCodigo;

  const full = repairKnownPrefixes(normalizeLine(raw.replace(/\r?\n/g, ' ')));
  if (CODIGO_LABEL.test(full)) {
    const labeled = getCodeAfterLabel(full, '', CODIGO_LABEL);
    if (labeled) return labeled;
  }

  const compact = parseCompactAggregator(raw);
  if (compact) return compact;

  const fromOther = scanLabeledLines(lines, OTHER_LABEL);
  if (fromOther) return fromOther;

  if (OTHER_LABEL.test(full)) {
    const labeled = getCodeAfterLabel(full, '', OTHER_LABEL);
    if (labeled) return labeled;
  }

  return parseAggregatorCode(full, { strict: true, repair: true });
}
