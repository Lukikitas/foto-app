import { normalizeStoreName, parseWorkbookDate } from './peyaWorkbook.js';
import { parseMoneyAmount } from './complaintSheet.js';
import { complaintDay, complaintHistoryId, isPendingComplaintDetails, normalizeHistoryItem, parseHistory } from './complaintHistory.js';
import { compactCode } from './complaintMatch.js';
import { enumerateDays, upsertDayStats } from './metrics.js';

export const RAPPI_SHEET = 'Reclamos - Órdenes';
export function assertRappiAccount(aggregator) {
  if (!['rappi', 'rappi_turbo'].includes(aggregator)) throw new Error('Elegí Rappi o Rappi Turbo antes de seleccionar el Excel.');
}
function value(sheet, address) {
  const cell = sheet[address];
  if (cell?.t === 'e' || (cell?.f && cell.v == null)) throw new Error(RAPPI_SHEET + '!' + address + ': valor de Excel inválido o sin recalcular.');
  return cell?.v ?? '';
}
const text = v => String(v ?? '').trim();
const header = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
export function parseRappiWorkbook(book, aggregator) {
  assertRappiAccount(aggregator);
  const sheet = book.Sheets[RAPPI_SHEET];
  if (!sheet) throw new Error('Falta la hoja ' + RAPPI_SHEET + '.');
  const required = { B: 'ORDEN ID', D: 'TIENDA', E: 'FECHA', F: 'MOTIVO', J: 'DETALLE DEL MOTIVO', M: 'COMPENSACION AL CLIENTE PAGADA POR EL RESTAURANTE', N: 'COMENTARIOS' };
  for (const [col, expected] of Object.entries(required)) if (header(value(sheet, col + '8')) !== expected) throw new Error('Encabezado no reconocido en ' + col + '8. Se esperaba ' + expected + '.');
  const date1904 = Boolean(book.Workbook?.WBProps?.date1904);
  if (header(value(sheet,'B5')) !== 'FECHA INICIO' || header(value(sheet,'E5')) !== 'FECHA FIN') throw new Error('No se encontró el período del reporte.');
  const from = parseWorkbookDate(value(sheet,'C5'), date1904);
  const to = parseWorkbookDate(value(sheet,'F5'), date1904);
  if (from > to) throw new Error('El período del reporte es inválido.');
  const complaints = [];
  const seen = new Map();
  let excluded = 0;
  let duplicates = 0;
  let matchedLocal = false;
  const lastRow = Number(sheet['!ref']?.match(/(\d+)$/)?.[1] || 0);
  for (let row = 9; row <= lastRow; row++) {
    const local = text(value(sheet, 'D' + row));
    if (normalizeStoreName(local) !== 'KFC-LA PLATA') {
      if (local) excluded++;
      continue;
    }
    matchedLocal = true;
    try {
      const code = text(value(sheet, 'B' + row));
      if (!/^\d{4,12}$/.test(code)) throw new Error('Código de pedido inválido.');
      const day = parseWorkbookDate(value(sheet, 'E' + row), date1904);
      if (day < from || day > to) throw new Error('Fecha fuera del período del reporte.');
      const amountRaw = value(sheet, 'M' + row);
      // In this export, a bare currency symbol means no restaurant charge.
      const missingAmount = text(amountRaw) === '';
      const amount = text(amountRaw) === '$' ? 0 : missingAmount ? null : parseMoneyAmount(amountRaw);
      if (!missingAmount && amount == null) throw new Error('Compensación del restaurante inválida.');
      const complaint = {
        orderCode: (aggregator === 'rappi_turbo' ? 'RAPPITURBO' : 'RAPPI') + code,
        aggregator, day, orderAtIso: null, timeOfDay: null, dateAssumed: false,
        reason: text(value(sheet,'F' + row)), comment: text(value(sheet,'N' + row)), combo: '', amount,
        fields: { Tienda: local, 'Detalle del motivo': text(value(sheet,'J' + row)) },
      };
      complaint.id = complaintHistoryId(complaint);
      const signature = JSON.stringify(complaint);
      const prior = seen.get(complaint.id);
      if (prior) {
        if (prior.signature !== signature) throw new Error('Pedido con detalles distintos en filas ' + prior.row + ' y ' + row + '.');
        duplicates++;
      } else { seen.set(complaint.id, { signature, row }); complaints.push(complaint); }
    } catch (cause) { throw new Error(RAPPI_SHEET + ', fila ' + row + ': ' + cause.message, { cause }); }
  }
  if (!matchedLocal) throw new Error('No se encontraron reclamos de KFC - LA PLATA. No se modificó ningún dato.');
  const daily = enumerateDays(from, to).map(day => ({ day, complaints: complaints.filter(c => c.day === day).length }));
  return { aggregator, complaints, daily, from, to, excluded, duplicates, missingAmounts: complaints.filter(c => c.amount == null).length };
}
export function mergeRappiMetrics(store, report) {
  assertRappiAccount(report.aggregator);
  return report.daily.reduce((next, row) => upsertDayStats(next, row.day, report.aggregator, {
    ...next.days?.[row.day]?.[report.aggregator], complaints: row.complaints,
  }), store);
}
const core = code => compactCode(code).replace(/^(RAPPITURBO|RAPPI)/, '');
export function mergeRappiHistory(store, report, rows = []) {
  assertRappiAccount(report.aggregator);
  const next = parseHistory(store);
  const imported = [];
  const stamp = new Date().toISOString();
  let added = 0;
  let updated = 0;
  for (const complaint of report.complaints) {
    const candidates = Object.values(next.items).filter(item => {
      const [sourceCode, sourceDay] = (item.sourceId || '').split('|');
      if (item.manualEdit && sourceDay === complaint.day && core(sourceCode) === core(complaint.orderCode) && (item.aggregator === report.aggregator || sourceCode === compactCode(complaint.orderCode))) return true;
      return item.aggregator === report.aggregator && core(item.orderCode) === core(complaint.orderCode) && complaintDay(item) === complaint.day;
    });
    if (candidates.length > 1) throw new Error('Más de un reclamo existente para ' + complaint.orderCode + '. Revisá el historial.');
    const existing = candidates[0];
    if (!existing && next.items[complaint.id]) throw new Error('El código ' + complaint.orderCode + ' coincide con otro registro. Revisá el historial.');
    const item = existing ? normalizeHistoryItem({
      ...existing,
      reason: isPendingComplaintDetails(existing.reason) ? complaint.reason : existing.reason || complaint.reason,
      comment: existing.comment || complaint.comment,
      amount: existing.amount ?? complaint.amount,
      fields: { ...complaint.fields, ...existing.fields },
      updatedAt: stamp,
    }) : normalizeHistoryItem({ ...complaint, importedAt: stamp, updatedAt: stamp });
    // Never borrow an order time from the photo. The report only contains a date.
    const photo = rows.find(row => row.complaint.id === complaint.id)?.photo;
    if (!item.photoId && photo) Object.assign(item, { photoId: photo.id, photoName: photo.name, photoUrl: photo.public_url });
    next.items[item.id] = item;
    imported.push(item);
    if (existing) updated++; else added++;
  }
  next.updatedAt = stamp;
  return { store: next, complaints: imported, added, updated };
}
