const LOCALE = 'es-AR';

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function startOfDay(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toISOString();
}

export function endOfDay(dateStr) {
  const date = new Date(`${dateStr}T23:59:59.999`);
  return date.toISOString();
}

export function todayDateInput() {
  return toDateInputValue(new Date());
}

export function yesterdayDateInput() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return toDateInputValue(date);
}
