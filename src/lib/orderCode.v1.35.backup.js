import { detectAggregator, getAggregatorLabel } from './aggregators.js';

const CODIGO_LABEL =
  /C\s*[O0]\s*D(?:\s*[I1L]\s*G\s*[O0](?:\s+PED(?:IDO)?)?|\s+PED(?:IDO)?)\s*[:.;#-]?\s*/;

const AGGREGATOR_PREFIX = /\b(RAPPITURBO|PEYA|RAPPI|MPD)(?=[\s-]?[A-Z0-9])/;

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

function repairRepeatedMpd(value = '') {
  return value.replace(/\b(?:[UW]PD|PD)\s*-\s*((?:\d[\s-]*){12,18})/g, (raw, printedDigits) => {
    const digits = printedDigits.replace(/\D/g, '');
    const main = digits.slice(0, -4);
    const repeated = digits.slice(-4);
    if (main.length < 8 || main.length > 12 || repeated.length !== 4) return raw;
    const differences = [...repeated].filter((digit, index) => digit !== main.slice(-4)[index]).length;
    return differences <= 1 ? `MPD-${main}` : raw;
  });
}

function repairKnownPrefixes(value = '') {
  return repairRepeatedMpd(value)
    .replace(/R[A4]PPI[\s-]*T[\s-]*URB[O0](?=[A-Z0-9\s-]|$)/g, 'RAPPITURBO')
    .replace(/P[E3][\s-]*[VY][\s-]*[A4](?=[A-Z0-9\s-]|$)/g, 'PEYA')
    .replace(/P[E3][\s-]*Y[\s-]*[A8O](?=[A-Z0-9\s-]|$)/g, 'PEYA')
    .replace(/[RF][E3][\s-]*Y[\s-]*[A4](?=[A-Z0-9\s-]|$)/g, 'PEYA')
    .replace(/R[A4][\s-]*P[\s-]*P[\s-]*[I1L](?=[A-Z0-9\s-]|$)/g, 'RAPPI');
}

function textAfterLabel(line) {
  const match = line.match(CODIGO_LABEL);
  if (!match) return '';
  return line.slice(match.index + match[0].length).trim();
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

function mapDigitLookalikes(value = '') {
  return value.replace(/O/g, '0').replace(/[IL]/g, '1');
}

function digitsFromToken(token) {
  return mapDigitLookalikes(token).replace(/\D/g, '');
}

export function stripRepeatedLastFour(digits = '') {
  let next = String(digits || '');
  while (next.length >= 8 && next.slice(-4) === next.slice(-8, -4)) {
    next = next.slice(0, -4);
  }
  return next;
}

function finalizeNumericRest(prefix, digits) {
  if (!digits) return '';
  return prefix === 'MPD' ? stripRepeatedLastFour(digits) : digits;
}

function collectCodeRest(source, startIndex) {
  const after = source.slice(startIndex).trim().replace(/^-+/, '').trim();
  if (!after) return '';

  const tokens = after.split(/\s+/).filter(Boolean);
  let digits = '';

  for (const token of tokens) {
    if (/^\d+[.,]\d{2}$/.test(token)) break;

    const compact = stripTrailingJunk(compactCode(token).replace(/^-+/, ''));
    if (!compact) break;
    if (STOP_WORDS.has(compact) || STOP_WORDS.has(compactAlnum(compact))) break;

    const lettersOnly = /^[A-Z]+$/.test(compactAlnum(compact));
    if (lettersOnly) break;

    const tokenDigits = digitsFromToken(compact);
    if (!tokenDigits) break;
    digits += tokenDigits;
  }

  return digits;
}

function isReliableCode(prefix, rest) {
  const digits = String(rest || '').replace(/\D/g, '');
  const needed = MIN_EXTRA[prefix] || 4;
  return digits.length >= needed && digits.length >= 3;
}

function parseAggregatorPrefixMatch(source) {
  const matcher = new RegExp(AGGREGATOR_PREFIX.source, 'g');
  let match;

  while ((match = matcher.exec(source))) {
    const prefix = match[1];
    const rest = finalizeNumericRest(prefix, collectCodeRest(source, match.index + match[0].length));
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

      const rawRest = stripTrailingJunk(compact.slice(idx + prefix.length)).slice(0, 28);
      const leading = mapDigitLookalikes(rawRest).match(/^\d+/);
      let rest = finalizeNumericRest(prefix, leading ? leading[0] : '');
      if (!isReliableCode(prefix, rest)) continue;

      return makeAggregatorResult(`${prefix}${rest}`, aggregator);
    }
  }

  return null;
}

function getCodeAfterLabel(line, nextLine = '', thirdLine = '') {
  const repairLabeledMpd = (value) => value.replace(/(^|\s)PD(?=[\s-]*\d{7,12}(?:\s*-\s*\d{4})?\b)/, '$1MPD');
  const afterLabel = repairLabeledMpd(repairKnownPrefixes(textAfterLabel(line)));
  const extra = [nextLine, thirdLine].filter(Boolean).join(' ');
  const combined = repairLabeledMpd(`${afterLabel} ${extra}`.trim());
  return parseAggregatorCode(afterLabel) || parseAggregatorCode(combined);
}

function scanLabeledLines(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (!CODIGO_LABEL.test(lines[index])) continue;
    const code = getCodeAfterLabel(
      lines[index],
      lines[index + 1] || '',
      lines[index + 2] || '',
    );
    if (code) return code;
  }
  return null;
}

export function hasCodigoLabel(text) {
  return CODIGO_LABEL.test(repairKnownPrefixes(normalizeLine(String(text || '').replace(/\r?\n/g, ' '))));
}

export function inspectOrderFromOcrTexts(texts) {
  const votes = new Map();

  for (const text of texts || []) {
    const order = detectOrderCode(text);
    if (!order) continue;

    const key = compactAlnum(order.displayCode);
    const entry = votes.get(key) || { order, count: 0, labeled: 0 };
    entry.count += 1;
    if (hasCodigoLabel(text)) entry.labeled += 1;
    if (order.displayCode.length > entry.order.displayCode.length) {
      entry.order = order;
    }
    votes.set(key, entry);
  }

  const ranked = [...votes.values()].sort((left, right) => {
    if (right.labeled !== left.labeled) return right.labeled - left.labeled;
    if (right.count !== left.count) return right.count - left.count;
    const rightDigits = (right.order.displayCode.match(/\d/g) || []).length;
    const leftDigits = (left.order.displayCode.match(/\d/g) || []).length;
    if (rightDigits !== leftDigits) return rightDigits - leftDigits;
    return right.order.displayCode.length - left.order.displayCode.length;
  });

  return ranked[0] || null;
}

export function chooseOrderFromOcrTexts(texts) {
  return inspectOrderFromOcrTexts(texts)?.order || null;
}

export function isConfidentOrderMatch(inspection) {
  return Boolean(inspection && (inspection.labeled > 0 || inspection.count >= 2));
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

  // Reading only the code's line avoids appending the first digit of TOTAL or CLIENTE.
  for (const line of lines) {
    const fromLine = parseAggregatorCode(line);
    if (fromLine) return fromLine;
  }

  const full = repairKnownPrefixes(normalizeLine(raw.replace(/\r?\n/g, ' ')));
  if (CODIGO_LABEL.test(full)) {
    const labeled = getCodeAfterLabel(full, '');
    if (labeled) return labeled;
  }

  return parseCompactAggregator(raw);
}
