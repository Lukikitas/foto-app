const KEY = 'foto-reliability-v1';
const LIMIT = 150;
let events;

function read() {
  if (events) return events;
  try { events = JSON.parse(globalThis.localStorage?.getItem(KEY) || '[]'); } catch { events = []; }
  if (!Array.isArray(events)) events = [];
  return events;
}

// Deliberately accepts only a fixed set of numeric fields. Never persist error
// messages, URLs, names, order codes or image data.
export function recordReliability(event, details = {}) {
  if (!['request', 'queue.retry', 'queue.error', 'capture.saved', 'capture.failed'].includes(event)) return;
  const entry = { event, at: Date.now() };
  for (const key of ['status', 'duration', 'attempt', 'delay']) {
    if (Number.isFinite(details[key])) entry[key] = Math.round(details[key]);
  }
  const list = read();
  list.push(entry);
  if (list.length > LIMIT) list.splice(0, list.length - LIMIT);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(list)); } catch { /* Full storage must not interrupt captures. */ }
}

export function reliabilityReport() {
  return { format: 1, exportedAt: new Date().toISOString(), events: read().map(event => ({ ...event })) };
}

export function downloadReliabilityReport() {
  const blob = new Blob([JSON.stringify(reliabilityReport(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'diagnostico-fotos.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
