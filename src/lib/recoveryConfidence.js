export function evaluateScheduledReadings(readings = []) {
  const found = readings.filter((reading) => reading.code && reading.aggregator);
  const candidate = found.find((reading) => reading.source === 'ticket') || found[0] || null;
  const highConfidence = Boolean(
    candidate && found.length === 2 && found.every((reading) =>
      reading.reliable && reading.code === candidate.code &&
      reading.aggregator === candidate.aggregator
    ),
  );
  return {
    code: candidate?.code || null,
    aggregator: candidate?.aggregator || null,
    source: candidate?.source || null,
    highConfidence,
    conflict: found.length > 1 && !found.every((reading) =>
      reading.code === candidate.code && reading.aggregator === candidate.aggregator),
  };
}
