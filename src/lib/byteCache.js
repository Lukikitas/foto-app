export function createByteCache(maxBytes = 16 * 1024 * 1024) {
  const entries = new Map();
  let bytes = 0;
  return {
    get(key) {
      const value = entries.get(key);
      if (value) { entries.delete(key); entries.set(key, value); }
      return value;
    },
    has(key) { return entries.has(key); },
    set(key, value) {
      bytes -= entries.get(key)?.size || 0;
      entries.delete(key);
      if (value.size > maxBytes) return value;
      entries.set(key, value); bytes += value.size;
      while (bytes > maxBytes) {
        const oldest = entries.keys().next().value;
        bytes -= entries.get(oldest).size; entries.delete(oldest);
      }
      return value;
    },
    get bytes() { return bytes; },
  };
}
