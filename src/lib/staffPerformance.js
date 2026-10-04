import { complaintRate, ratioPct } from './metrics.js';
import { COMPLAINT_STATUSES, moneyForStatus } from './complaintHistory.js';
import { compactCode } from './complaintMatch.js';
import { argentinaDateTimeParts } from './complaintSync.js';

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
export function buildStaffReport({ photos = [], historyItems = [], extraPhotos = [] } = {}) {
  const photoById = new Map();
  const photoByCompact = new Map();
  const photoByDigits = new Map();
  const photoByPrefixedDigits = new Map();
  for (const photo of [...photos, ...extraPhotos]) {
    if (photo?.id) photoById.set(photo.id, photo);
    const compact = compactCode(photo?.name);
    if (compact && !photoByCompact.has(compact)) photoByCompact.set(compact, photo);
    const digits = compact.replace(/\D/g, '');
    if (!digits) continue;
    if (!photoByDigits.has(digits)) photoByDigits.set(digits, photo);
    const prefix = codePrefix(compact);
    // PEYA-1234 y RAPPI-1234 comparten dígitos: se indexan por prefijo propio
    // para no cruzarlos en la búsqueda numérica.
    if (prefix && !photoByPrefixedDigits.has(`${prefix}:${digits}`)) {
      photoByPrefixedDigits.set(`${prefix}:${digits}`, photo);
    }
  }
  // Los nombres de foto traen prefijo (PEYA-1234) y el reclamo puede guardarlo
  // sin prefijo (1234): si no coincide exacto, se compara solo lo numérico,
  // respetando el agregador cuando ambos lados tienen prefijo.
  const findPhotoByCode = (code) => {
    if (!code) return null;
    const compact = compactCode(code);
    const exact = photoByCompact.get(compact);
    if (exact) return exact;
    const digits = compact.replace(/\D/g, '');
    if (!digits) return null;
    const prefix = codePrefix(compact);
    if (prefix) {
      const samePrefix = photoByPrefixedDigits.get(`${prefix}:${digits}`);
      if (samePrefix) return samePrefix;
    }
    const found = photoByDigits.get(digits);
    if (!found) return null;
    const photoPrefix = codePrefix(found.name);
    if (photoPrefix && prefix && photoPrefix !== prefix) return null;
    return found;
  };

  const people = new Map();
  function touchPerson(name) {
    const display = normalizePerson(name) || NO_PERSON;
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
        complaintAmount: 0,
        recoveredAmount: 0,
      };
      people.set(key, row);
    }
    return row;
  }

  for (const photo of photos) {
    const row = touchPerson(photo?.taken_by);
    row.photos += 1;
    if (isOrderPhotoRow(photo)) row.orders += 1;
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, complaints: 0 }));
  for (const photo of photos) {
    if (!isOrderPhotoRow(photo)) continue;
    const hour = argentinaHour(photo?.created_at);
    if (hour != null) hourly[hour].orders += 1;
  }

  let complaintsWithoutHour = 0;
  for (const item of historyItems) {
    let photo = null;
    if (item?.photoId && photoById.has(item.photoId)) photo = photoById.get(item.photoId);
    if (!photo && item?.photoName) photo = findPhotoByCode(item.photoName);
    if (!photo && item?.compact) photo = findPhotoByCode(item.compact);
    if (!photo && item?.orderCode) photo = findPhotoByCode(item.orderCode);

    const row = touchPerson(photo?.taken_by);
    row.complaints += 1;
    row.complaintAmount += moneyForStatus(item);
    if (item?.status === COMPLAINT_STATUSES.refutado_aceptado) {
      // Queja falsa: no juega en contra de quien sacó la foto.
      row.refutadoAceptado += 1;
      row.recoveredAmount += moneyForStatus(item);
    } else if (item?.status === COMPLAINT_STATUSES.no_refutable) {
      // Pérdida sin refutar: es la que sirve para medidas disciplinarias.
      row.noRefutable += 1;
    }

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
    if (row.key !== personKey(NO_PERSON)) totals.people += 1;
    return {
      ...row,
      photoSharePct: null,
      complaintPct: complaintRate(row.orders, row.complaints),
      isUnassigned: row.key === personKey(NO_PERSON),
    };
  });
  for (const row of rows) row.photoSharePct = ratioPct(row.photos, totals.photos);
  totals.complaintPct = complaintRate(totals.orders, totals.complaints);

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

  return { people: rows, hourly: hourlyRows, totals, complaintsWithoutHour };
}


export function buildStaffCsv(report) {
  const lines = [];
  lines.push('persona,fotos,pedidos,porcentaje_fotos,quejas,porcentaje_quejas,refutadas_aceptadas,no_refutables,monto_quejas,monto_recuperado');
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

