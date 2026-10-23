// Opt-in, bounded diagnostics. Never records URLs, order codes, names or images.
const samples = [];
const limit = 200;
let enabled = false;
export function enablePerformanceMetrics(value = true) { enabled = value; }
export function performanceSamples() { return samples.map(sample => ({ ...sample })); }
export function recordPerformance(operation, duration, details = {}) {
  if (!enabled) return;
  samples.push({ operation, duration: Math.round(duration), at: Date.now(), ...Object.fromEntries(
    Object.entries(details).filter(([key, value]) => ['bytes', 'rows', 'success'].includes(key) && ['number', 'boolean'].includes(typeof value)),
  ) });
  if (samples.length > limit) samples.splice(0, samples.length - limit);
}
export async function measurePerformance(operation, task) {
  const start = performance.now();
  try { const value = await task(); recordPerformance(operation, performance.now() - start, { success: true }); return value; }
  catch (error) { recordPerformance(operation, performance.now() - start, { success: false }); throw error; }
}
export function observeLongTasks() {
  if (typeof PerformanceObserver !== 'function' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return () => {};
  const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => recordPerformance('ui.longtask', entry.duration)));
  observer.observe({ type: 'longtask', buffered: false });
  return () => observer.disconnect();
}
