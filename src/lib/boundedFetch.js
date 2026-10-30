import { withRequestTimeout } from './requestTimeout.js';
import { recordReliability } from './reliabilityDiagnostics.js';

// The deadline includes reading the response body. Fetch alone resolves when
// headers arrive, which otherwise leaves a stalled JSON body blocking the queue.
export function createBoundedFetch(fetcher = globalThis.fetch, timeoutMs = 60_000) {
  return async (input, options = {}) => {
    const start = performance.now();
    try {
      const response = await withRequestTimeout(async signal => {
        const result = await fetcher(input, { ...options, signal });
        if (!result.body) return result;
        const body = await result.arrayBuffer();
        return new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers });
      }, { signal: options.signal || input?.signal, timeoutMs });
      recordReliability('request', { status: response.status, duration: performance.now() - start });
      return response;
    } catch (error) {
      recordReliability('request', { status: 0, duration: performance.now() - start });
      throw error;
    }
  };
}
