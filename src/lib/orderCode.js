import { detectAggregator, getAggregatorLabel } from './aggregators';

function normalizeLine(value = '') {
  return value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^A-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCodeAfterLabel(line, nextLine = '') {
  const label = /C[O0]D[I1L]G[O0]\s*:\s*/;
  const afterLabel = line.replace(label, '').trim();
  const compactAfterLabel = afterLabel.replace(/[^A-Z0-9-]/g, '');
  const afterLabelAggregator = detectAggregator(compactAfterLabel);
  const prefixes = {
    pedidosya: ['PEYA'],
    rappi: ['RAPPI'],
    rappi_turbo: ['RAPPITURBO'],
    mercadopago: ['MPD', 'MP'],
  }[afterLabelAggregator] || [];
  const candidate = prefixes.includes(compactAfterLabel)
    ? `${afterLabel} ${nextLine}`
    : afterLabel || nextLine;
  const compact = candidate.replace(/[^A-Z0-9-]/g, '');
  const aggregator = detectAggregator(compact);

  if (!aggregator) return null;

  const matchedPrefix = ({
    pedidosya: ['PEYA'],
    rappi: ['RAPPI'],
    rappi_turbo: ['RAPPITURBO'],
    mercadopago: ['MPD', 'MP'],
  }[aggregator]).find((prefix) => compact.startsWith(prefix));

  if (compact.length <= matchedPrefix.length) return null;

  return {
    displayCode: compact.slice(0, 32),
    aggregator,
    aggregatorLabel: getAggregatorLabel(aggregator),
  };
}

/** Extracts the code printed after "CODIGO:" and its delivery aggregator. */
export function detectOrderCode(ocrText) {
  const lines = String(ocrText)
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    if (!/C[O0]D[I1L]G[O0]\s*:/.test(lines[index])) continue;

    const code = getCodeAfterLabel(lines[index], lines[index + 1]);
    if (code) return code;
  }

  return null;
}
