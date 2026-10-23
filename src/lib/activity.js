// One shared gate for CPU-heavy work. Capture storage is never gated.
export function createActivityCoordinator({ now = Date.now, delay = 3000, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let camera = false;
  let until = 0;
  let timer;
  const listeners = new Set();
  const busy = () => camera && now() < until;
  const emit = () => listeners.forEach(listener => listener(busy()));
  function touch() {
    if (!camera) return;
    until = now() + delay;
    cancel(timer);
    timer = schedule(emit, delay);
    emit();
  }
  return {
    busy,
    touch,
    setCamera(active) {
      camera = active;
      if (active) touch();
      else { cancel(timer); until = 0; emit(); }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    wait(signal, { whenClosed = false } = {}) {
      const blocked = () => whenClosed ? camera : busy();
      if (signal?.aborted) return Promise.reject(new DOMException('Interrumpido', 'AbortError'));
      if (!blocked()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const off = this.subscribe(() => { if (!blocked()) { cleanup(); resolve(); } });
        const abort = () => { cleanup(); reject(new DOMException('Interrumpido', 'AbortError')); };
        const cleanup = () => { off(); signal?.removeEventListener('abort', abort); };
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
  };
}

export const activity = createActivityCoordinator();
