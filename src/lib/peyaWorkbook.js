import { complaintHistoryId, upsertHistoryItems, isPendingComplaintDetails } from './complaintHistory.js';
import { compactCode } from './complaintMatch.js';
import { parseMoneyAmount } from './complaintSheet.js';
import { upsertDayStats } from './metrics.js';

export const PEYA_SHEETS = ['Reclamos - Órdenes', 'Resumen por tienda', 'AWT5', 'AWT 5'];
const DAY = 86400000;
export function normalizeStoreName(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().trim()
    .replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-');
}
const isLaPlata = (value) => normalizeStoreName(value) === 'KFC-LA PLATA';
function cell(sheet, address) {
  const c = sheet[address];
  if (c?.t === 'e') throw new Error(sheet.name + '!' + address + ': la celda contiene un error de Excel.');
  if (c?.f && c.v == null) throw new Error(sheet.name + '!' + address + ': falta el resultado de la fórmula. Guardá el archivo recalculado en Excel.');
  return c?.v ?? '';
}
const text = (value) => String(value ?? '').trim();
function date(value, date1904 = false) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date((Math.floor(value) - (date1904 ? 24107 : 25569)) * DAY).toISOString().slice(0, 10);
  }
  const s = text(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) throw new Error('Fecha inválida: ' + s);
  const result = parts.map((p, i) => p.padStart(i === 0 ? 4 : 2, '0')).join('-');
  const parsed = new Date(result + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new Error('Fecha inválida: ' + s);
  return result;
}
function time(value) {
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const seconds = Math.round(value * 86400) % 86400;
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
  }
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text(value));
  if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] || 0) > 59) throw new Error('Hora inválida: ' + text(value));
  return [match[1], match[2], match[3] || '00'].map(n => n.padStart(2, '0')).join(':');
}
function lastRow(sheet) {
  return Number(sheet['!ref']?.match(/(\d+)$/)?.[1] || 0);
}
function getSheet(book, names) {
  const found = names.filter(name => book.Sheets[name]);
  if (found.length !== 1) throw new Error('No se pudo identificar una única hoja ' + names.join(' / ') + '.');
  return { ...book.Sheets[found[0]], name: found[0] };
}
function counts(sheet, nameColumn, columns, headerRow, date1904) {
  if (!/partner.?name|nombre|tienda|local/i.test(text(cell(sheet, nameColumn + headerRow)))) throw new Error(sheet.name + ': no se encontró el encabezado del local.');
  const days = columns.map(c => date(cell(sheet, c + headerRow), date1904));
  if (new Set(days).size !== days.length) throw new Error(sheet.name + ': hay fechas repetidas.');
  const matches = [];
  // Stop at the end of this table, before other reports further down the sheet.
  for (let r = headerRow + 1; r <= lastRow(sheet); r++) {
    const name = cell(sheet, nameColumn + r);
    if (!text(name) || /^(suma total|total general|grand total)$/i.test(text(name))) break;
    if (isLaPlata(name)) matches.push(r);
  }
  if (matches.length !== 1) throw new Error(sheet.name + ': se esperaba una sola fila de KFC - LA PLATA en la tabla.');
  return Object.fromEntries(columns.map((c, i) => {
    const value = cell(sheet, c + matches[0]);
    const n = value === '' ? 0 : Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || typeof value === 'boolean') throw new Error(sheet.name + '!' + c + matches[0] + ': cantidad inválida.');
    return [days[i], n];
  }));
}
export function parsePeyaWorkbook(book) {
  const date1904 = Boolean(book.Workbook?.WBProps?.date1904);
  const complaintsSheet = getSheet(book, [PEYA_SHEETS[0]]);
  const orders = counts(getSheet(book, [PEYA_SHEETS[1]]), 'U', ['V','W','X','Y','Z','AA','AB'], 61, date1904);
  const awt = counts(getSheet(book, ['AWT5','AWT 5']), 'I', ['J','K','L','M','N','O','P'], 2, date1904);
  const days = Object.keys(orders).sort();
  if (days.join() !== Object.keys(awt).sort().join()) throw new Error('Las fechas de pedidos y AWT no coinciden.');
  if (!/partner.?name|local/i.test(text(cell(complaintsSheet, 'C1'))) || !/motivo/i.test(text(cell(complaintsSheet, 'F1'))) || !/monto/i.test(text(cell(complaintsSheet, 'L1')))) throw new Error('Reclamos - Órdenes: encabezados no reconocidos.');
  const complaints = [];
  const seen = new Map();
  let excluded = 0;
  let duplicates = 0;
  for (let r = 2; r <= lastRow(complaintsSheet); r++) {
    const local = cell(complaintsSheet, 'C' + r);
    if (!isLaPlata(local)) { if (text(local)) excluded++; continue; }
    try {
      const rawCode = cell(complaintsSheet, 'B' + r);
      const code = text(rawCode).replace(/^PEYA[-\s]*/i, '');
      if (!/^\d{4,12}$/.test(code)) throw new Error('código de pedido inválido.');
      const day = date(cell(complaintsSheet, 'D' + r), date1904);
      if (!days.includes(day)) throw new Error('fecha fuera del período de las tablas.');
      const clock = time(cell(complaintsSheet, 'E' + r));
      const amountValue = cell(complaintsSheet, 'L' + r);
      const amount = parseMoneyAmount(amountValue);
      if (amountValue !== '' && amount == null) throw new Error('monto inválido.');
      const optional = text(cell(complaintsSheet, 'I' + r));
      const complaint = {
        orderCode: code, aggregator: 'pedidosya',
        orderAtIso: new Date(day + 'T' + clock + '-03:00').toISOString(),
        timeOfDay: clock.slice(0, 5), dateAssumed: false,
        reason: text(cell(complaintsSheet, 'F' + r)), comment: text(cell(complaintsSheet, 'G' + r)),
        combo: text(cell(complaintsSheet, 'H' + r)), amount,
        fields: optional ? { 'Nombre opcional': optional } : {},
      };
      complaint.id = complaintHistoryId(complaint);
      const signature = JSON.stringify(complaint);
      const prior = seen.get(complaint.id);
      if (prior) {
        if (prior.signature !== signature) throw new Error('pedido repetido con detalles distintos en filas ' + prior.row + ' y ' + r + '.');
        duplicates++;
      } else {
        seen.set(complaint.id, { signature, row: r });
        complaints.push(complaint);
      }
    } catch (error) { throw new Error('Reclamos - Órdenes, fila ' + r + ': ' + error.message, { cause: error }); }
  }
  const daily = days.map(day => ({ day, orders: orders[day], awt: awt[day], complaints: complaints.filter(c => c.id.endsWith('|' + day)).length }));
  return { complaints, daily, excluded, duplicates };
}
export function mergePeyaMetrics(store, report) {
  return report.daily.reduce((next, row) => upsertDayStats(next, row.day, 'pedidosya', row), store);
}
const core = code => compactCode(code).replace(/^PEYA/, '');
export function mergePeyaHistory(store, report, rows = []) {
  const complaints = report.complaints.map(c => {
    const day = c.id.split('|')[1];
    const matches = Object.values(store.items || {}).filter(item => {
      const keys = [item.id, item.sourceId].filter(Boolean);
      return keys.some(key => { const [code, d] = key.split('|'); return core(code) === core(c.orderCode) && d === day; }) && (!item.aggregator || item.aggregator === 'pedidosya' || (item.manualEdit && item.sourceId === c.id));
    });
    if (matches.length > 1) throw new Error('Hay más de un reclamo existente para el pedido ' + c.orderCode + '. Revisá el historial.');
    const existing = matches[0];
    if (existing?.manualEdit) return { ...existing, id: existing.id };
    if (existing) return {
      ...c, id: existing.id, orderCode: existing.orderCode,
      // Older bulk edits have no manualEdit marker. Preserve populated details too.
      amount: existing.amount ?? c.amount, combo: existing.combo || c.combo,
      reason: isPendingComplaintDetails(existing.reason) ? c.reason : existing.reason || c.reason,
      comment: existing.comment || c.comment, fields: { ...c.fields, ...existing.fields },
    };
    const collision = store.items?.[c.id];
    if (collision && collision.aggregator !== 'pedidosya') throw new Error('El pedido ' + c.orderCode + ' coincide con otro agregador. Revisá el historial.');
    return c;
  });
  const result = upsertHistoryItems(store, complaints);
  // Existing evidence wins; add only unambiguous PedidosYa matches.
  for (let i = 0; i < complaints.length; i++) {
    const c = complaints[i];
    const id = complaintHistoryId(c);
    const item = result.store.items[id];
    const photo = rows.find(row => row.complaint.id === report.complaints[i].id)?.photo;
    if (item && !item.photoId && photo) Object.assign(item, { photoId: photo.id, photoName: photo.name, photoUrl: photo.public_url });
  }
  return { ...result, complaints };
}
