import { complaintDay, isPendingComplaintDetails } from './complaintHistory.js';
import { isIsoDate } from './metrics.js';

export const ORIGIN_LABELS = {
  manual: 'Carga manual', lista: 'Lista pegada', sheet: 'CSV / Sheets', codes: 'Lista de códigos', photo: 'Marcada desde la foto',
  excel_pedidosya: 'Excel PedidosYa', excel_rappi: 'Excel Rappi',
};

export function dailyDataOrigin(stats, aggregator) {
  const fields = ['orders', 'complaints', ...(aggregator === 'pedidosya' ? ['awt'] : [])];
  const labels = { orders: 'Pedidos', complaints: 'Quejas', awt: 'AWT' };
  const entries = fields.map(key => ({ key, label: labels[key], source: stats?.sources?.[key] || '',
    origin: ORIGIN_LABELS[stats?.sources?.[key]] || 'Origen no registrado' }));
  const known = [...new Set(entries.map(entry => entry.source).filter(source => ORIGIN_LABELS[source]))];
  const excel = known.some(source => source.startsWith('excel_'));
  const manual = known.some(source => ['manual', 'lista'].includes(source));
  const unknown = entries.some(entry => !ORIGIN_LABELS[entry.source]);
  const kind = !known.length ? 'unknown' : known.length > 1 || unknown ? 'mixed' : excel ? 'excel' : 'manual';
  const label = !known.length ? 'Origen no registrado' : excel && manual ? 'Manual + Excel' :
    known.length > 1 ? 'Carga combinada' : unknown ? `${ORIGIN_LABELS[known[0]]} · otros campos sin origen` : ORIGIN_LABELS[known[0]];
  const shortLabel = kind === 'unknown' ? 'Origen sin registrar' : excel && manual ? 'Manual + Excel' :
    kind === 'mixed' ? 'Carga combinada' : excel ? 'Excel importado' : known[0] === 'lista' ? 'Lista pegada' : 'Carga manual';
  return { kind, label, shortLabel, entries };
}

export function complaintDetails(item) {
  const reason = String(item.reason || '').trim();
  const marked = !reason || isPendingComplaintDetails(reason);
  const missing = [];
  if (marked) missing.push('motivo');
  if (!isIsoDate(complaintDay(item))) missing.push('fecha');
  if (item.amount == null || String(item.amount).trim() === '' || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0) missing.push('monto');
  const clock = typeof item.timeOfDay === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(item.timeOfDay);
  const timestamp = item.orderAtIso && Number.isFinite(Date.parse(item.orderAtIso));
  if (item.aggregator === 'pedidosya' && !clock && !timestamp) missing.push('hora');
  const state = marked ? 'marked' : missing.length ? 'partial' : 'complete';
  return { state, label: state === 'marked' ? 'Solo marcada' : state === 'partial' ? 'Detalles por completar' : 'Detalles cargados',
    missing, origin: ORIGIN_LABELS[item.detailOrigin] || 'Origen no registrado',
    excel: ['excel_pedidosya', 'excel_rappi'].includes(item.detailOrigin),
    edited: Boolean(item.detailEdited),
    time: clock ? item.timeOfDay.slice(0, 5) : timestamp ? new Date(item.orderAtIso).toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false,
    }) : item.detailOrigin === 'excel_rappi' ? 'El Excel no trae hora' : 'Hora no informada',
    comment: String(item.comment || '').trim(),
  };
}
