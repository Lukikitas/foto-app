import { argentinaToday, emptyStore } from '../lib/metrics.js';
import { complaintHistoryId, parseHistory } from '../lib/complaintHistory.js';

export const DEMO_AUTHORS = ['Lucía Fernández', 'Martín López', 'Camila Torres', 'Diego Ruiz'];
const PLATFORMS = ['pedidosya', 'rappi', 'rappi_turbo', 'mercadopago'];
const PREFIXES = ['PEYA', 'RAPPI', 'RAPPITURBO', 'MP'];
const STATUSES = ['refutado_aceptado', 'refutado', 'queja', 'refutado_aceptado', 'no_refutable', 'refutado_rechazado'];
const REASONS = ['Producto faltante', 'Pedido incorrecto', 'Bebida faltante', 'Producto en mal estado'];
const COMBOS = ['Combo clásico', 'Combo familiar', 'Combo doble', 'Menú individual'];

// One source of truth: every metric order has a gallery row and every complaint
// has a history item. Dates move with the presentation, with no random values.
export function createDemoData(today = argentinaToday()) {
  const metrics = emptyStore();
  const photos = [];
  const items = {};
  let sequence = 0;
  for (let offset = 69; offset >= 0; offset--) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    const weekend = [0, 5, 6].includes(date.getUTCDay());
    metrics.days[day] = {};
    for (let platform = 0; platform < PLATFORMS.length; platform++) {
      const aggregator = PLATFORMS[platform];
      const orders = [86, 33, 15, 11][platform] + (weekend ? 18 : 0) + ((offset * 7 + platform * 3) % 19);
      const complaints = Math.max(1, Math.round(orders * (offset > 30 ? .033 : .021)));
      metrics.days[day][aggregator] = {
        orders, complaints, awt: platform === 0 ? Math.round(orders * (offset > 30 ? .13 : .08)) : 0,
        reported: { orders: true, complaints: true, awt: platform === 0 },
        sources: { orders: 'demo', complaints: 'demo', awt: 'demo' },
      };
      for (let order = 0; order < orders; order++) {
        sequence++;
        const code = `${PREFIXES[platform]}${83000000 + sequence}`;
        const hour = 11 + (order % 12);
        const minute = String((order * 7) % 60).padStart(2, '0');
        const capturedAt = `${day}T${hour}:${minute}:00-03:00`;
        const hasComplaint = order < complaints;
        const status = STATUSES[(offset + platform + order) % STATUSES.length];
        const photo = {
          id: `demo-${sequence}`, name: code, aggregator,
          created_at: new Date(capturedAt).toISOString(),
          file_path: `orders/${aggregator}/demo-${sequence}.jpg`,
          public_url: '/demo/evidencia.svg', thumbnail_path: null,
          taken_by: DEMO_AUTHORS[(order + platform + offset) % DEMO_AUTHORS.length],
          has_complaint: hasComplaint, is_refutado: hasComplaint && status.startsWith('refutado'),
          notes: hasComplaint ? 'Evidencia de ejemplo para revisión del reclamo.' : '',
        };
        photos.push(photo);
        if (hasComplaint) {
          const item = {
            orderCode: code, day, orderAtIso: photo.created_at, timeOfDay: `${hour}:${minute}`,
            aggregator, amount: [5900, 8500, 12400, 15900][(offset + order + platform) % 4],
            reason: REASONS[(offset + order) % REASONS.length],
            combo: COMBOS[(offset + platform) % COMBOS.length],
            comment: 'Caso ficticio para mostrar el seguimiento del reclamo.',
            status, photoId: photo.id, photoName: code, photoUrl: photo.public_url,
            unrefutableReason: status === 'no_refutable' ? 'Queja real' : '',
            rejectionReason: status === 'refutado_rechazado' ? 'Foto incompleta' : '',
            detailOrigin: 'manual', importedAt: photo.created_at, updatedAt: photo.created_at,
          };
          item.id = complaintHistoryId(item);
          items[item.id] = item;
        }
      }
    }
  }
  const updatedAt = `${today}T23:00:00-03:00`;
  metrics.updatedAt = updatedAt;
  const files = ['Remito de insumos', 'Control de despacho', 'Planilla del turno'].map((name, index) => ({
    id: `demo-file-${index}`, name, created_at: `${today}T15:00:00Z`,
    file_path: `files/demo-${index}.jpg`, public_url: '/demo/ticket.svg', thumbnail_path: null,
    taken_by: DEMO_AUTHORS[index], has_complaint: false, is_refutado: false, notes: 'Archivo de ejemplo.', aggregator: null,
  }));
  return { today, metrics, history: parseHistory({ version: 2, updatedAt, items }), photos: [...photos, ...files] };
}
