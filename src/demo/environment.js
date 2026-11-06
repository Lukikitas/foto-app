export function createScopedStorage(storage, prefix = 'foto-demo:') {
  const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key?.startsWith(prefix));
  return {
    getItem: key => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: key => storage.removeItem(prefix + key),
    clear: () => keys().forEach(key => storage.removeItem(key)),
    key: index => keys()[index]?.slice(prefix.length) ?? null,
    get length() { return keys().length; },
  };
}

// Runs before App imports, so pre-existing real history, authors and drafts do
// not appear in the presentation or get overwritten on the existing domain.
if (import.meta.env?.MODE === 'demo' && typeof window !== 'undefined') {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const scoped = createScopedStorage(window[name]);
      for (const target of new Set([window, globalThis])) {
        Object.defineProperty(target, name, { configurable: true, value: scoped });
      }
    } catch { /* Storage may be disabled; the views already handle that case. */ }
  }
}
