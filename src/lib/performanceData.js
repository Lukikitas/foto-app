import { supabase } from './supabase.js';
import { measurePerformance } from './performanceMetrics.js';
import { withRequestTimeout } from './requestTimeout.js';
export async function loadPerformanceData(options, { signal } = {}) {
  return measurePerformance(`view.${options.view}`, () => withRequestTimeout(async requestSignal => {
    const { data, error } = await supabase.functions.invoke('performance-data', { body: options, signal: requestSignal });
    if (signal?.aborted) throw new DOMException('Interrumpido','AbortError');
    if (error || data?.error) throw new Error(data?.error || 'No se pudieron consultar los datos actuales. Verificá la función performance-data y volvé a intentar.');
    if (!data?.metrics || (!data.history && !data.report)) throw new Error('No se recibió una respuesta completa del servidor.');
    return data;
  },{ signal, timeoutMs:45000 }));
}
