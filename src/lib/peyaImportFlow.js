import { mergePeyaMetrics } from './peyaWorkbook.js';

// Each write is idempotent. Do not pretend two independent Storage objects are atomic.
export async function executePeyaImport(report, deps) {
  const result = { historySaved: false, metricsSaved: false, warning: '' };
  try {
    await deps.loadMetrics();
    await deps.validateHistory(report);
    let rows = [];
    try { rows = await deps.matchPhotos(report.complaints); }
    catch { result.warning = 'No se pudieron cruzar las fotos. Podés volver a importar para reintentar el cruce.'; }
    result.history = await deps.saveHistory(report, rows);
    result.historySaved = true;
    const metrics = await deps.loadMetrics();
    result.metrics = await deps.saveMetrics(mergePeyaMetrics(metrics, report));
    result.metricsSaved = true;
    return result;
  } catch (cause) {
    const error = new Error((result.historySaved
      ? 'Los reclamos se guardaron; los pedidos y AWT no se pudieron guardar. Reintentá la importación: no se duplicarán los reclamos. '
      : 'No se guardó la importación. ') + cause.message);
    error.result = result;
    throw error;
  }
}
