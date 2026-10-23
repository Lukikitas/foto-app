import { complaintRate, ratioPct } from './metrics.js';
import { COMPLAINT_STATUSES, moneyForStatus } from './complaintHistory.js';
import { getPhotoAggregator } from './aggregators.js';
import { toArgentinaDate } from './metrics.js';
import { compactCode } from './complaintMatch.js';
import { argentinaDateTimeParts } from './complaintSync.js';
import { representativeOrders } from './orderIdentity.js';

export const NO_PERSON = 'Sin asignar';

function normalizePerson(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function personKey(value) {
  return normalizePerson(value).toLowerCase();
}

// Same classification the gallery uses: files/ are documents, orders/ are
// order evidence; anything else falls back to having a name.
function isOrderPhotoRow(photo) {
  const path = String(photo?.file_path || '');
  if (path.startsWith('files/')) return false;
  if (path) return true;
  return Boolean(photo?.name);
}

export function argentinaHour(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const { hour } = argentinaDateTimeParts(date);
  return Number.isFinite(hour) ? hour : null;
}

function complaintHour(item) {
  const timeOfDay = String(item?.timeOfDay || '');
  if (/^\d{1,2}:\d{2}$/.test(timeOfDay)) {
    const hour = Number.parseInt(timeOfDay.slice(0, 2), 10);
    return hour >= 0 && hour <= 23 ? hour : null;
  }
  return argentinaHour(item?.orderAtIso);
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvPct(value) {
  return value == null ? '' : Number(value).toFixed(2);
}

const AGGREGATOR_PREFIX = /^(RAPPITURBO|RAPPI|PEYA|MPD)/;

function codePrefix(value) {
  return AGGREGATOR_PREFIX.exec(String(value || ''))?.[1] || '';
}

/**
 * Builds the staff performance report: per-person photo/complaint stats and
 * an hourly distribution of orders (order photos) and complaints (history).
 * `photos` are the period photos; `extraPhotos` are photos referenced by
 * complaints from outside the period, used only for attribution.
 */
export function buildStaffReport({ photos = [], historyItems = [], extraPhotos = [], aliases = {} } = {}) {
  const periodIds = new Set(photos.map(photo => photo.id));
  const { representatives, representativeById } = representativeOrders([...photos, ...extraPhotos]);
  const periodOrders = representatives.filter(photo => periodIds.has(photo.id));
  const photoById = new Map();
  for (const photo of [...photos, ...extraPhotos]) if (photo?.id) photoById.set(photo.id, photo);
  const byCode = new Map();
  const byDigits = new Map();
  const photoDays = new Map();
  for (const photo of photoById.values()) {
    const code = compactCode(photo.name);
    const digits = code.replace(/\D/g, '');
    const entry = { photo, code, prefix: codePrefix(code) };
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(entry);
    if (digits) {
      if (!byDigits.has(digits)) byDigits.set(digits, []);
      byDigits.get(digits).push(entry);
    }
  }
  const attributionWarnings = [];
  const findPhotoByCode = (code, item) => {
    if (!code) return null;
    const compact = compactCode(code);
    const digits = compact.replace(/\D/g, '');
    const prefix = codePrefix(compact);
    const matches = new Set([...(byCode.get(compact) || []), ...(byDigits.get(digits) || [])]);
    const candidates = [...matches].filter(({ photo, code: photoCode, prefix: photoPrefix }) => {
      if (item.day) {
        if (!photoDays.has(photo.id)) photoDays.set(photo.id, toArgentinaDate(photo.created_at));
        if (photoDays.get(photo.id) !== item.day) return false;
      }
      const agg = getPhotoAggregator(photo) || ({PEYA:"pedidosya",RAPPI:"rappi",RAPPITURBO:"rappi_turbo",MPD:"mercadopago"})[codePrefix(compactCode(photo.name))];
      if (item.aggregator && agg !== item.aggregator) return false;
      if (photoCode === compact) return true;
      return digits && photoCode.replace(/\D/g, '') === digits && !(photoPrefix && prefix && photoPrefix !== prefix);
    }).map(entry => entry.photo);
    const unique = new Map(candidates.map(photo => [representativeById.get(photo.id)?.id || photo.id, photo]));
    if (unique.size > 1) { attributionWarnings.push('Código ambiguo: '+code); return null; }
    return unique.values().next().value || null;
  };

  const people = new Map();
  function touchPerson(name) {
    const display = aliases[personKey(name)] || normalizePerson(name) || NO_PERSON;
    const key = personKey(display);
    let row = people.get(key);
    if (!row) {
      row = {
        key,
        name: display,
        photos: 0,
        orders: 0,
        complaints: 0,
        refutadoAceptado: 0,
        noRefutable: 0,
        rejected: 0,
        pending: 0,
        inProgress: 0,
        items: [],
        complaintAmount: 0,
        recoveredAmount: 0,
        missingAmountCount: 0, missingRecoveredCount: 0,
      };
      people.set(key, row);
    }
    return row;
  }

  for (const photo of photos) {
    const row = touchPerson(photo?.taken_by);
    row.photos += 1;
  }
  for (const photo of periodOrders) {
    if (isOrderPhotoRow(photo)) touchPerson(photo?.taken_by).orders += 1;
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, complaints: 0 }));
  for (const photo of periodOrders) {
    if (!isOrderPhotoRow(photo)) continue;
    const hour = argentinaHour(photo?.created_at);
    if (hour != null) hourly[hour].orders += 1;
  }

  let complaintsWithoutHour = 0;
  for (const item of historyItems) {
    let photo = null;
    if (item?.photoId && photoById.has(item.photoId)) photo = photoById.get(item.photoId);
    if (!photo && item?.photoName) photo = findPhotoByCode(item.photoName, item);
    if (!photo && item?.compact) photo = findPhotoByCode(item.compact, item);
    if (!photo && item?.orderCode) photo = findPhotoByCode(item.orderCode, item);
    if (photo) photo = representativeById.get(photo.id) || photo;

    const row = touchPerson(photo?.taken_by);
    row.complaints += 1;
    row.items.push(item);
    row.complaintAmount += moneyForStatus(item);
    if (item.amount == null) row.missingAmountCount++;
    if (item?.status === COMPLAINT_STATUSES.refutado_aceptado) {
      // Queja falsa: no juega en contra de quien sacó la foto.
      row.refutadoAceptado += 1;
      row.recoveredAmount += moneyForStatus(item);
      if(item.amount == null) row.missingRecoveredCount++;
    } else if (item?.status === COMPLAINT_STATUSES.no_refutable) {
      // Pérdida sin refutar: es la que sirve para medidas disciplinarias.
      row.noRefutable += 1;
    }
    if (item.status === COMPLAINT_STATUSES.refutado_rechazado) row.rejected++;
    if (item.status === COMPLAINT_STATUSES.refutado) row.inProgress++;
    if (item.status === COMPLAINT_STATUSES.queja) row.pending++;

    const hour = complaintHour(item);
    if (hour == null) complaintsWithoutHour += 1;
    else hourly[hour].complaints += 1;
  }

  const totals = {
    photos: 0,
    orders: 0,
    complaints: 0,
    refutadoAceptado: 0,
    noRefutable: 0,
    complaintAmount: 0,
    recoveredAmount: 0,
    missingAmountCount: 0, missingRecoveredCount: 0,
    people: 0,
    unassignedComplaints: people.get(personKey(NO_PERSON))?.complaints || 0,
  };
  const rows = [...people.values()].map((row) => {
    totals.photos += row.photos;
    totals.orders += row.orders;
    totals.complaints += row.complaints;
    totals.refutadoAceptado += row.refutadoAceptado;
    totals.noRefutable += row.noRefutable;
    totals.complaintAmount += row.complaintAmount;
    totals.recoveredAmount += row.recoveredAmount;
    totals.missingAmountCount += row.missingAmountCount;
    totals.missingRecoveredCount += row.missingRecoveredCount;
    if (row.key !== personKey(NO_PERSON)) totals.people += 1;
    return {
      ...row,
      photoSharePct: null,
      complaintPct: complaintRate(row.orders, row.complaints),
      adjustedComplaintPct: complaintRate(row.orders, row.complaints - row.refutadoAceptado),
      isUnassigned: row.key === personKey(NO_PERSON),
    };
  });
  for (const row of rows) row.photoSharePct = ratioPct(row.photos, totals.photos);
  totals.complaintPct = complaintRate(totals.orders, totals.complaints);
  totals.adjustedComplaintPct = complaintRate(totals.orders, totals.complaints - totals.refutadoAceptado);

  const totalHourOrders = hourly.reduce((sum, entry) => sum + entry.orders, 0);
  const totalHourComplaints = hourly.reduce((sum, entry) => sum + entry.complaints, 0) + complaintsWithoutHour;
  const hourlyRows = hourly
    .map((entry) => ({
      ...entry,
      ordersPct: ratioPct(entry.orders, totalHourOrders),
      complaintsPct: ratioPct(entry.complaints, totalHourComplaints),
      ratePct: complaintRate(entry.orders, entry.complaints),
    }))
    .filter((entry) => entry.orders > 0 || entry.complaints > 0);

  if (complaintsWithoutHour > 0) {
    hourlyRows.push({
      hour: null,
      orders: 0,
      complaints: complaintsWithoutHour,
      ordersPct: 0,
      complaintsPct: ratioPct(complaintsWithoutHour, totalHourComplaints),
      ratePct: null,
    });
  }

  return { people: rows, hourly: hourlyRows, totals, complaintsWithoutHour, attributionWarnings };
}


export function buildStaffCsv(report) {
  const lines = [];
  lines.push('persona,capturas,pedidos_unicos,porcentaje_fotos,quejas,porcentaje_quejas,refutadas_aceptadas,no_refutables,monto_quejas,monto_recuperado,porcentaje_sin_aceptadas,rechazadas,pendientes,en_disputa,montos_faltantes,recuperados_sin_monto');
  for (const row of report?.people || []) {
    lines.push([
      csvEscape(row.name),
      row.photos,
      row.orders,
      csvPct(row.photoSharePct),
      row.complaints,
      csvPct(row.complaintPct),
      row.refutadoAceptado,
      row.noRefutable,
      row.complaintAmount,
      row.recoveredAmount,
      csvPct(row.adjustedComplaintPct), row.rejected, row.pending, row.inProgress, row.missingAmountCount, row.missingRecoveredCount,
    ].join(','));
  }
  lines.push('');
  lines.push('hora,pedidos,porcentaje_pedidos,quejas,porcentaje_quejas,porcentaje_quejas_sobre_pedidos');
  for (const row of report?.hourly || []) {
    const label = row.hour == null ? 'Sin hora' : `${String(row.hour).padStart(2, '0')}:00`;
    lines.push([
      label,
      row.orders,
      csvPct(row.ordersPct),
      row.complaints,
      csvPct(row.complaintsPct),
      csvPct(row.ratePct),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

