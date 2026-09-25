import test from 'node:test';
import assert from 'node:assert/strict';
import { read, write, utils } from '../vendor/xlsx.mjs';
import { parsePeyaRefunds, applyPeyaRefunds, executePeyaRefunds } from './peyaRefunds.js';
function book(rows = []) { return { Sheets: { Reintegros: utils.aoa_to_sheet([['', 'Número de pedido', '', 'Orden entregada al repartidor', 'Sucursal'], ...rows]) } }; }
const row = (code, ds = 'DS', local = 'KFC - La Plata') => ['', code, '', ds, local];
const report = codes => ({ orders: codes.map((code, i) => ({ code, row: i + 2 })) });
const item = (id, code, extra = {}) => ({ id, orderCode: code, aggregator: 'pedidosya', status: 'refutado', amount: 1800, comment: 'Manual', photoId: 'photo', manualEdit: true, day: '2026-09-07', fields: { original: 'yes' }, ...extra });

test('filtra nombre completo y DS, ignora otras columnas y deduplica', () => {
 const b = book([row(2266590265), row('2266590265', ' ds ', ' kfc –  LA PLATA '), row(2222222222, 'SI'), row(3333333333, 'NO'), row(4444444444, 'DS', 'KFC - LA PLATA NORTE')]);
 b.Sheets.Reintegros.F2 = { t: 'e', v: 7 };
 assert.deepEqual(parsePeyaRefunds(b), { orders: [{ code: '2266590265', row: 2 }], ignored: 2, excluded: 1, duplicates: 1, localRows: 4 });
});
test('rechaza hojas, encabezados, códigos y celdas DS inválidos', () => {
 assert.throws(() => parsePeyaRefunds({ Sheets: {} }), /Reintegros/);
 const b = book(); b.Sheets.Reintegros.B1.v = 'Otro'; assert.throws(() => parsePeyaRefunds(b), /B1/);
 assert.throws(() => parsePeyaRefunds(book([row('inválido')])), /fila 2/);
 const c = book([row(2266590265)]); c.Sheets.Reintegros.D2 = { t: 'e', v: 7 }; assert.throws(() => parsePeyaRefunds(c), /D2/);
});
for (const bookType of ['xls', 'xlsx']) test('lee contenido ' + bookType + ' desde archivo de reintegros', () => {
 const b = utils.book_new(); utils.book_append_sheet(b, book([row(2266590265)]).Sheets.Reintegros, 'Reintegros');
 const bytes = write(b, { type: 'buffer', bookType });
 const parsed = parsePeyaRefunds(read(bytes, { type: 'buffer', sheets: ['Reintegros'] }));
 assert.equal(parsed.orders[0].code, '2266590265');
});
test('solo modifica estado y timestamp, conserva detalles, fotos y otros agregadores', () => {
 const a = item('a', 'PEYA-2266590265'); const rappi = item('r', '2266590265', { aggregator: 'rappi' });
 const store = { version: 2, items: { a, r: rappi } };
 const result = applyPeyaRefunds(store, report(['2266590265', '9999999999']), 'now');
 assert.equal(result.updated, 1); assert.deepEqual(result.store.items.a, { ...a, status: 'refutado_aceptado', updatedAt: 'now' });
 assert.equal(result.store.items.r, rappi); assert.equal(store.items.a.status, 'refutado');
 assert.equal(result.summary.missing[0].code, '9999999999'); assert.equal(Object.keys(result.store.items).length, 2);
 assert.equal(applyPeyaRefunds(result.store, report(['2266590265'])).store, result.store);
});
test('no cruza sufijos, cuentas Rappi/Turbo ni pedidos ambiguos', () => {
 const items = { a: item('a', '2266590265'), b: item('b', '2266590265', { day: '2026-09-08' }), r: item('r', 'RAPPI1234567890'), t: item('t', '1234567891', { aggregator: 'rappi_turbo' }) };
 const result = applyPeyaRefunds({ items }, report(['2266590265', '590265', '1234567890', '1234567891']));
 assert.equal(result.updated, 0); assert.equal(result.summary.ambiguous.length, 1); assert.equal(result.summary.missing.length, 3);
});
for (const status of ['queja', 'refutado', 'refutado_rechazado']) test('actualiza desde ' + status, () => {
 assert.equal(applyPeyaRefunds({ items: { a: item('a', '2266590265', { status, aggregator: null }) } }, report(['2266590265'])).store.items.a.status, 'refutado_aceptado');
});
test('no escribe sin cambios y permite reintentar un guardado fallido', async () => {
 let current = { items: { a: item('a', '2266590265') } }; let writes = 0; let fail = true;
 const deps = { loadHistory: async () => current, mutateHistory: async fn => { writes++; if (fail) throw Error('falló'); const result = fn(current); current = result.store; return result; } };
 await executePeyaRefunds(report(['9999999999']), deps); assert.equal(writes, 0);
 await executePeyaRefunds(report([]), deps); assert.equal(writes, 0);
 await assert.rejects(executePeyaRefunds(report(['2266590265']), deps), /falló/);
 fail = false; await executePeyaRefunds(report(['2266590265']), deps); await executePeyaRefunds(report(['2266590265']), deps); assert.equal(writes, 2);
});
test('lectura fallida no escribe y la mutación usa el historial más reciente', async () => {
 await assert.rejects(executePeyaRefunds(report(['2266590265']), { loadHistory: async () => { throw Error('lectura'); }, mutateHistory: () => assert.fail('no escribir') }), /lectura/);
 const old = { items: { a: item('a', '2266590265') } }; const fresh = { items: {} };
 const result = await executePeyaRefunds(report(['2266590265']), { loadHistory: async () => old, mutateHistory: async fn => fn(fresh) });
 assert.equal(result.updated, 0); assert.equal(result.summary.missing.length, 1);
});
