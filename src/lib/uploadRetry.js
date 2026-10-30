export function isTransientUploadError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.context?.status);
  if (status >= 400 && status < 500) return [408, 425, 429].includes(status);
  if (status >= 500) return true;
  if (['REQUEST_TIMEOUT', 'NETWORK_ERROR', 'ECONNRESET', 'ETIMEDOUT'].includes(error?.code)) return true;
  return /fetch|network|offline|connection|timed?\s*out|timeout|failed to send/i.test(error?.message || '');
}

export function scheduleUploadRetry(item, error, now = Date.now(), random = Math.random) {
  if (!isTransientUploadError(error)) return false;
  item.retryAttempt = Math.min(30, (item.retryAttempt || 0) + 1);
  const base = Math.min(300_000, 2_000 * 2 ** Math.min(8, item.retryAttempt - 1));
  item.nextAttemptAt = now + Math.round(base * (0.8 + random() * 0.4));
  item.status = 'pending';
  item.error = 'Esperando conexión o reintento automático. La foto sigue guardada.';
  return true;
}

export function queueItemReady(item, now = Date.now()) {
  return item?.status === 'pending' && !(item.nextAttemptAt > now);
}
