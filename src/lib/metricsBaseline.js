// Shared symbol survives editor object spreads, but is omitted by JSON and RPCs.
export const METRICS_BASELINE = Symbol('metricsBaseline');
export function cloneMetricsForEdit(store) {
  const copy=structuredClone(store);
  if(store[METRICS_BASELINE])copy[METRICS_BASELINE]=store[METRICS_BASELINE];
  return copy;
}
