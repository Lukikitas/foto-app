import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chooseOrderFromOcrTexts,
  detectOrderCode,
  inspectOrderFromOcrTexts,
  isConfidentOrderMatch,
} from './orderCode.js';

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

test('reads hyphenated aggregator codes as prefix plus digits', () => {
  assert.deepEqual(code('CODIGO: PEYA-998877'), {
    displayCode: 'PEYA998877',
    aggregator: 'pedidosya',
  });
  assert.deepEqual(code('CODIGO: RAPPI-998877'), {
    displayCode: 'RAPPI998877',
    aggregator: 'rappi',
  });
  assert.deepEqual(code('CODIGO: RAPPITURBO-112233'), {
    displayCode: 'RAPPITURBO112233',
    aggregator: 'rappi_turbo',
  });
  assert.deepEqual(code('CODIGO: MPD-445566'), {
    displayCode: 'MPD445566',
    aggregator: 'mercadopago',
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

test('does not treat a numeric Código Ped. as an aggregator code', () => {
  assert.equal(code('Código Ped. 12345678'), null);
});

test('does not treat CAMPAMENTO as a Mercado Pago code', () => {
  assert.equal(code('CAMPAMENTO TOTAL 1500'), null);
});

test('does not match a short MP token', () => {
  assert.equal(code('CODIGO: MP99887766'), null);
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

test('does not keep letters in the numeric order code', () => {
  assert.equal(code('CODIGO: PEYAX7K29'), null);
  assert.deepEqual(code('CODIGO: PEYA9K2X18'), {
    displayCode: 'PEYA9218',
    aggregator: 'pedidosya',
  });
});

test('strips the repeated last four digits from Mercado Pago codes', () => {
  assert.deepEqual(code('CODIGO: MPD123456785678'), {
    displayCode: 'MPD12345678',
    aggregator: 'mercadopago',
  });
  assert.deepEqual(code('CODIGO: MPD998877667766'), {
    displayCode: 'MPD99887766',
    aggregator: 'mercadopago',
  });
  assert.deepEqual(code('ticket MPD4455665566 bolsa'), {
    displayCode: 'MPD445566',
    aggregator: 'mercadopago',
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

test('does not invent a code from ORDEN numbers', () => {
  assert.equal(code('ORDEN: 44556677'), null);
});

test('joins a code split across the next ticket lines', () => {
  assert.deepEqual(code('CODIGO: PEYA12\n34567'), {
    displayCode: 'PEYA1234567',
    aggregator: 'pedidosya',
  });
});

test('repairs FEYA and PEY8 as PedidosYa prefixes', () => {
  assert.deepEqual(code('CODIGO: FEYA445566'), {
    displayCode: 'PEYA445566',
    aggregator: 'pedidosya',
  });
  assert.deepEqual(code('CODIGO: PEY8445566'), {
    displayCode: 'PEYA445566',
    aggregator: 'pedidosya',
  });
});

test('chooseOrderFromOcrTexts prefers a labeled ticket over a stray code', () => {
  const chosen = chooseOrderFromOcrTexts([
    'bolsa RAPPI998877',
    'CODIGO: PEYA12345 TOTAL 1500',
    'TOTAL 1500',
  ]);
  assert.deepEqual(chosen && {
    displayCode: chosen.displayCode,
    aggregator: chosen.aggregator,
  }, {
    displayCode: 'PEYA12345',
    aggregator: 'pedidosya',
  });
});

test('chooseOrderFromOcrTexts keeps the code that appears more often', () => {
  const chosen = chooseOrderFromOcrTexts([
    'PEYA12345',
    'ticket PEYA12345',
    'RAPPI445566',
  ]);
  assert.equal(chosen.displayCode, 'PEYA12345');
});

test('a labeled or repeated reading is confident enough to stop early', () => {
  const labeled = inspectOrderFromOcrTexts(['CODIGO: PEYA12345']);
  assert.equal(isConfidentOrderMatch(labeled), true);
  const repeated = inspectOrderFromOcrTexts(['PEYA12345', 'pedido PEYA12345']);
  assert.equal(isConfidentOrderMatch(repeated), true);
  const weak = inspectOrderFromOcrTexts(['ticket PEYA12345']);
  assert.equal(isConfidentOrderMatch(weak), false);
});
