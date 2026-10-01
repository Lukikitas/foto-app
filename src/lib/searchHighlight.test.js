import assert from 'node:assert/strict';
import { test } from 'node:test';
import { highlightParts } from './searchHighlight.js';

function render(parts) {
  return parts.map((part) => (part.match ? `[${part.text}]` : part.text)).join('');
}

test('highlightParts marca la primera y las repeticiones, sin perder texto', () => {
  assert.equal(render(highlightParts('Pedido #4821', '482')), 'Pedido #[482]1');
  assert.equal(render(highlightParts('remito 12 y 12', '12')), 'remito [12] y [12]');
  assert.equal(render(highlightParts('PEYA-99', 'peya')), '[PEYA]-99');
  assert.equal(render(highlightParts('abc', 'xyz')), 'abc');
});

test('highlightParts sin query devuelve todo sin marcar', () => {
  assert.deepEqual(highlightParts('Pedido #4821', ''), [{ text: 'Pedido #4821', match: false }]);
  assert.deepEqual(highlightParts('Pedido #4821', '   '), [
    { text: 'Pedido #4821', match: false },
  ]);
  assert.deepEqual(highlightParts(null, 'x'), [{ text: '', match: false }]);
});
