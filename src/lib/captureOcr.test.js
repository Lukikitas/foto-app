import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureOrderFromOcr } from './captureOcr.js';

test('capture accepts the legacy labelled ticket text without changing code rules', () => {
  assert.equal(captureOrderFromOcr({ ocrText: 'CODIGO: PEYA1234567890' })?.displayCode, 'PEYA1234567890');
});
test('independent ticket and bag readings can agree on a complete unlabelled code', () => {
  const order = captureOrderFromOcr({ ocrTexts: ['PEYA1234567890', 'PEYA1234567890'] });
  assert.equal(order?.displayCode, 'PEYA1234567890');
  assert.equal(order.aggregator, 'pedidosya');
});
test('one unlabelled reading or conflicting independent readings require review', () => {
  assert.equal(captureOrderFromOcr({ ocrTexts: ['PEYA1234567890'] }), null);
  assert.equal(captureOrderFromOcr({ ocrTexts: ['PEYA1234567890', 'PEYA9876543210'] }), null);
});
test('labelled partial codes and readings beyond the bounded pair are not confirmed', () => {
  assert.equal(captureOrderFromOcr({ ocrText: 'CODIGO PEYA1234' }), null);
  assert.equal(captureOrderFromOcr({ ocrTexts: ['', '', 'CODIGO PEYA1234567890'] }), null);
});
