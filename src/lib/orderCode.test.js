import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectOrderCode } from './orderCode.js';

function code(ocrText) {
  const result = detectOrderCode(ocrText);
  return result && {
    displayCode: result.displayCode,
    aggregator: result.aggregator,
  };
}

test('reads a clean aggregator code after CODIGO', () => {
  assert.deepEqual(code('CODIGO: PEYA12345'), {
    displayCode: 'PEYA12345',
    aggregator: 'pedidosya',
  });
});

test('reads the code when CODIGO sits in the middle of a single OCR block', () => {
  assert.deepEqual(
    code('PEDIDOS YA CODIGO: PEYA12345 TOTAL 1500'),
    { displayCode: 'PEYA12345', aggregator: 'pedidosya' },
  );
});

test('accepts OCR substitutions in the CODIGO label', () => {
  assert.deepEqual(code('C0D1GO PEYA98765'), {
    displayCode: 'PEYA98765',
    aggregator: 'pedidosya',
  });
});

test('joins a bare prefix with the next line', () => {
  assert.deepEqual(
    code('CODIGO:\nPEYA12345'),
    { displayCode: 'PEYA12345', aggregator: 'pedidosya' },
  );
});

test('reads Rappi, Rappi Turbo and Mercado Pago prefixes', () => {
  assert.deepEqual(code('CODIGO: RAPPI998877'), {
    displayCode: 'RAPPI998877',
    aggregator: 'rappi',
  });
  assert.deepEqual(code('CODIGO: RAPPITURBO1122'), {
    displayCode: 'RAPPITURBO1122',
    aggregator: 'rappi_turbo',
  });
  assert.deepEqual(code('CODIGO: MPD445566'), {
    displayCode: 'MPD445566',
    aggregator: 'mercadopago',
  });
  assert.deepEqual(code('CODIGO: MP99887766'), {
    displayCode: 'MP99887766',
    aggregator: 'mercadopago',
  });
});

test('repairs PEYA misreads only after the label', () => {
  assert.deepEqual(code('CODIGO: PEVA12345'), {
    displayCode: 'PEYA12345',
    aggregator: 'pedidosya',
  });
  assert.deepEqual(code('CODIGO: P3YA 99881'), {
    displayCode: 'PEYA99881',
    aggregator: 'pedidosya',
  });
});

test('finds PEYA without a CODIGO label when the code is long enough', () => {
  assert.deepEqual(code('ticket PEYA12345 bolsa'), {
    displayCode: 'PEYA12345',
    aggregator: 'pedidosya',
  });
});

test('reads the legacy numeric Código Ped. format as the last four digits', () => {
  assert.deepEqual(code('Código Ped. 12345678'), {
    displayCode: '5678',
    aggregator: null,
  });
});

test('keeps dashed numeric codes after the label', () => {
  assert.deepEqual(code('CODIGO PED 12-345678'), {
    displayCode: '12-345678',
    aggregator: null,
  });
});

test('does not treat CAMPAMENTO as a Mercado Pago code', () => {
  assert.equal(code('CAMPAMENTO TOTAL 1500'), null);
});

test('does not match a short MP token without the label', () => {
  assert.equal(code('MP 12 items'), null);
});

test('stops the code before TOTAL and prices', () => {
  assert.deepEqual(
    code('CODIGO: RAPPI445566 TOTAL 2.500'),
    { displayCode: 'RAPPI445566', aggregator: 'rappi' },
  );
});

test('accepts spaced letters inside CODIGO', () => {
  assert.deepEqual(code('C O D I G O: PEYA22233'), {
    displayCode: 'PEYA22233',
    aggregator: 'pedidosya',
  });
});
