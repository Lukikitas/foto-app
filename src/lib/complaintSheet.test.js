import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gvizTableToTsv,
  parseComplaintOrderCode,
  parseComplaintSheet,
  parseDelimitedText,
  parseGoogleSheetRef,
  parseSheetDateTime,
  toGoogleCsvUrl,
  toGoogleGvizUrl,
} from './complaintSheet.js';
import { getPartnerPortal } from './aggregators.js';

test('reads Spanish TSV with headers from a Google Sheet paste', () => {
  const text = [
    'Código\tHora del pedido\tMotivo\tComentario',
    'PEYA12345\t16/09/2026 21:30\tFaltan productos\tNo vinieron las papas',
    'RAPPI998877\t16/09/2026 22:05\tLlegó frío\t',
  ].join('\n');

  const { complaints, skipped, usedHeaders } = parseComplaintSheet(text);
  assert.equal(usedHeaders, true);
  assert.equal(skipped, 0);
  assert.equal(complaints.length, 2);
  assert.equal(complaints[0].orderCode, 'PEYA12345');
  assert.equal(complaints[0].reason, 'Faltan productos');
  assert.equal(complaints[0].comment, 'No vinieron las papas');
  assert.equal(complaints[0].timeOfDay, '21:30');
  assert.equal(complaints[1].orderCode, 'RAPPI998877');
});

test('reads semicolon CSV and last-four digit codes', () => {
  const text = 'codigo;hora;motivo\n4696;21:15;Pedido incompleto\n';
  const { complaints } = parseComplaintSheet(text);
  assert.equal(complaints.length, 1);
  assert.equal(complaints[0].orderCode, '4696');
  assert.equal(complaints[0].timeOfDay, '21:15');
  assert.equal(complaints[0].dateAssumed, true);
});

test('combines fecha and hora columns', () => {
  const text = [
    'Pedido,Fecha,Hora,Queja',
    'PEYA778899,16/09/2026,22:40,Nunca llegó',
  ].join('\n');
  const { complaints } = parseComplaintSheet(text);
  assert.equal(complaints[0].orderCode, 'PEYA778899');
  assert.equal(complaints[0].timeOfDay, '22:40');
  assert.ok(complaints[0].orderAtIso);
  assert.equal(new Date(complaints[0].orderAtIso).getHours(), 22);
  assert.equal(new Date(complaints[0].orderAtIso).getMinutes(), 40);
});

test('infers columns when the sheet has no headers', () => {
  const text = 'PEYA12345\t16/09/2026 21:30\tFaltan productos\tPapas';
  const { complaints, usedHeaders } = parseComplaintSheet(text);
  assert.equal(usedHeaders, false);
  assert.equal(complaints[0].orderCode, 'PEYA12345');
  assert.equal(complaints[0].reason, 'Faltan productos');
  assert.equal(complaints[0].comment, 'Papas');
});

test('parses quoted CSV reasons that include commas', () => {
  const rows = parseDelimitedText('codigo,motivo\nPEYA1,"Falta pan, queso y papas"\n', ',');
  assert.deepEqual(rows[1], ['PEYA1', 'Falta pan, queso y papas']);
});

test('does not treat a date cell as an order code', () => {
  assert.equal(parseComplaintOrderCode('16/09/2026 21:30'), '');
  assert.equal(parseComplaintOrderCode('21:30'), '');
  assert.equal(parseComplaintOrderCode('PEYA12345'), 'PEYA12345');
  assert.equal(parseComplaintOrderCode('Pedido PEYA-2284672300'), 'PEYA2284672300');
  assert.equal(parseComplaintOrderCode('2284672300.0'), '2284672300');
});

test('parses DMY datetimes used in Argentina', () => {
  const parsed = parseSheetDateTime('16/09/2026 21:30');
  assert.equal(parsed.timeOfDay, '21:30');
  assert.equal(parsed.dateAssumed, false);
  const date = new Date(parsed.orderAtIso);
  assert.equal(date.getDate(), 16);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getFullYear(), 2026);
});

test('converts a Google Sheet edit URL into a CSV export URL', () => {
  assert.equal(
    toGoogleCsvUrl('https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=7'),
    'https://docs.google.com/spreadsheets/d/abc123XYZ/export?format=csv&gid=7',
  );
});

test('parses a Google Sheet id and gid from an edit link', () => {
  assert.deepEqual(
    parseGoogleSheetRef('https://docs.google.com/spreadsheets/d/abc123XYZ/edit?gid=7#gid=7'),
    { id: 'abc123XYZ', publishedId: '', gid: '7' },
  );
});

test('builds a Google Visualization URL the browser can load', () => {
  assert.equal(
    toGoogleGvizUrl('https://docs.google.com/spreadsheets/d/abc123XYZ/edit#gid=7', 'fotoAppSheet_cb'),
    'https://docs.google.com/spreadsheets/d/abc123XYZ/gviz/tq?gid=7&tqx=out%3Ajson%3BresponseHandler%3AfotoAppSheet_cb',
  );
});

test('turns a Google Visualization table into TSV for the sheet parser', () => {
  const tsv = gvizTableToTsv({
    cols: [
      { id: 'A', label: 'Código' },
      { id: 'B', label: 'Hora' },
      { id: 'C', label: 'Motivo' },
    ],
    rows: [
      { c: [{ v: 'PEYA12345' }, { f: '16/09/2026 21:30', v: 'Date(2026,8,16,21,30,0)' }, { v: 'Faltan productos' }] },
    ],
  });
  const { complaints } = parseComplaintSheet(tsv);
  assert.equal(complaints[0].orderCode, 'PEYA12345');
  assert.equal(complaints[0].reason, 'Faltan productos');
  assert.equal(complaints[0].timeOfDay, '21:30');
});

test('opens PedidosYa and Rappi partner portals', () => {
  assert.equal(getPartnerPortal('pedidosya').url, 'https://portal-app.pedidosya.com/orders');
  assert.equal(getPartnerPortal('rappi').url, 'https://partners.rappi.com');
  assert.equal(getPartnerPortal('mercadopago'), null);
});
