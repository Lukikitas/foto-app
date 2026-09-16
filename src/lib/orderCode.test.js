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

test('reads a long numeric Código Ped. as the full order id', () => {
  assert.deepEqual(code('Código Ped. 12345678'), {
    displayCode: '12345678',
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

test('reads PEYA codes that continue with letters', () => {
  assert.deepEqual(code('CODIGO: PEYAX7K29'), {
    displayCode: 'PEYAX7K29',
    aggregator: 'pedidosya',
  });
});

test('finds a code inside a compact OCR blob', () => {
  assert.deepEqual(code('PEDIDOSYACODIGOPEYA12345TOTAL1500'), {
    displayCode: 'PEYA12345',
    aggregator: 'pedidosya',
  });
});

test('repairs spaced PEYA without a CODIGO label', () => {
  assert.deepEqual(code('ticket P E Y A 778899 bolsa'), {
    displayCode: 'PEYA778899',
    aggregator: 'pedidosya',
  });
});

test('reads numeric order ids after ORDEN', () => {
  assert.deepEqual(code('ORDEN: 44556677'), {
    displayCode: '44556677',
    aggregator: null,
  });
});
