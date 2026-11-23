import { normalizeStoreName } from './peyaWorkbook.js';
import { compactCode } from './complaintMatch.js';
import { COMPLAINT_STATUSES } from './complaintHistory.js';

export const REFUNDS_SHEET = 'Reintegros';
const text = value => String(value ?? '').trim();
const header = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
function cell(sheet, address) {
  const c = sheet[address];
  if (c?.t === 'e' || (c?.f && c.v == null)) throw new Error('Reintegros!' + address + ': valor inválido o fórmula sin recalcular.');
  return c?.v ?? '';
}
export function peyaRefundOrderCode(value) {
  const code = compactCode(value).replace(/^PEYA/, '');
  return /^\d{4,12}$/.test(code) ? code : '';
}
export function parsePeyaRefunds(book) {
  const sheet = book.Sheets?.[REFUNDS_SHEET];
  if (!sheet) throw new Error('Falta la hoja Reintegros.');
  const headers = { B: 'NUMERO DE PEDIDO', D: 'ORDEN ENTREGADA AL REPARTIDOR', E: 'SUCURSAL' };
  for (const [col, expected] of Object.entries(headers)) {
    if (header(cell(sheet, col + '1')) !== expected) throw new Error('Reintegros: encabezado no reconocido en ' + col + '1.');
  }
  const orders = [];
  const seen = new Set();
  let excluded = 0;
  let ignored = 0;
  let duplicates = 0;
  let localRows = 0;
  const last = Number(sheet['!ref']?.match(/(\d+)$/)?.[1] || 0);
  for (let row = 2; row <= last; row++) {
    const local = cell(sheet, 'E' + row);
    if (!text(local)) continue;
    if (normalizeStoreName(local) !== 'KFC-LA PLATA') { excluded++; continue; }
    localRows++;
    if (text(cell(sheet, 'D' + row)).toUpperCase() !== 'DS') { ignored++; continue; }
    const raw = cell(sheet, 'B' + row);
    const code = peyaRefundOrderCode(raw);
    if (!code || (typeof raw === 'number' && !Number.isSafeInteger(raw))) throw new Error('Reintegros, fila ' + row + ': número de pedido inválido para DS.');
    if (seen.has(code)) { duplicates++; continue; }
    seen.add(code);
    orders.push({ code, row });
  }
  return { orders, excluded, ignored, duplicates, localRows };
}
function isPeyaHistory(item) {
  if (item.aggregator && item.aggregator !== 'pedidosya') return false;
  return Boolean(peyaRefundOrderCode(item.orderCode));
}
export function previewPeyaRefunds(store, report) {
  const byCode = new Map();
  for (const item of Object.values(store.items || {})) {
    if (!isPeyaHistory(item)) continue;
    const code = peyaRefundOrderCode(item.orderCode);
    const matches = byCode.get(code) || [];
    matches.push(item);
    byCode.set(code, matches);
  }
  const toUpdate = [];
  const alreadyAccepted = [];
  const missing = [];
  const ambiguous = [];
  for (const order of report.orders) {
    const matches = byCode.get(order.code) || [];
    if (!matches.length) { missing.push(order); continue; }
    if (matches.length > 1) { ambiguous.push({ ...order, ids: matches.map(item => item.id) }); continue; }
    const item = matches[0];
    const match = { ...order, id: item.id, previousStatus: item.status };
    if (item.status === COMPLAINT_STATUSES.refutado_aceptado) alreadyAccepted.push(match);
    else toUpdate.push(match);
  }
  return { toUpdate, alreadyAccepted, missing, ambiguous };
}
export function applyPeyaRefunds(store, report, stamp = new Date().toISOString()) {
  const summary = previewPeyaRefunds(store, report);
  if (!summary.toUpdate.length) return { store, summary, updated: 0 };
  const next = { ...store, updatedAt: stamp, items: { ...store.items } };
  for (const match of summary.toUpdate) {
    next.items[match.id] = { ...store.items[match.id], status: COMPLAINT_STATUSES.refutado_aceptado, updatedAt: stamp };
  }
  return { store: next, summary, updated: summary.toUpdate.length };
}

export async function executePeyaRefunds(report, deps) {
  const current = await deps.loadHistory();
  const preview = applyPeyaRefunds(current, report);
  if (!preview.updated) return preview;
  // Re-match inside the serialized history mutation; never write a stale preview.
  return deps.mutateHistory(store => applyPeyaRefunds(store, report));
}
