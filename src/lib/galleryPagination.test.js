import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPage, galleryPage, galleryPageCount, pageNumbers } from './galleryPagination.js';

const items = Array.from({ length: 250 }, (_, index) => index);

test('galleryPageCount calcula páginas de100 en 100', () => {
  assert.equal(galleryPageCount(0), 1);
  assert.equal(galleryPageCount(1), 1);
  assert.equal(galleryPageCount(100), 1);
  assert.equal(galleryPageCount(101), 2);
  assert.equal(galleryPageCount(250), 3);
  assert.equal(galleryPageCount(250, 50), 5);
});

test('clampPage recorta la página fuera de rango', () => {
  assert.equal(clampPage(1, 250), 1);
  assert.equal(clampPage(3, 250), 3);
  assert.equal(clampPage(9, 250), 3);
  assert.equal(clampPage(0, 250), 1);
  assert.equal(clampPage('x', 250), 1);
  assert.equal(clampPage(5, 0), 1);
});

test('galleryPage devuelve la ventana correcta y recorta si el total baja', () => {
  const first = galleryPage(items, 1);
  assert.equal(first.page, 1);
  assert.equal(first.pageCount, 3);
  assert.equal(first.items.length, 100);
  assert.equal(first.items[0], 0);

  const second = galleryPage(items, 2);
  assert.equal(second.start, 100);
  assert.equal(second.items[0], 100);

  // Página pedida ya inexistente (p. ej. borrados en vivo): se recorta.
  const last = galleryPage(items.slice(0, 150), 3);
  assert.equal(last.page, 2);
  assert.equal(last.items.length, 50);

  const single = galleryPage([], 7);
  assert.equal(single.page, 1);
  assert.equal(single.pageCount, 1);
  assert.deepEqual(single.items, []);
});

test('pageNumbers inserta guiones solo cuando hay saltos', () => {
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(1, 12), [1, 2, '…', 12]);
  assert.deepEqual(pageNumbers(6, 12), [1, '…', 5, 6, 7, '…', 12]);
  assert.deepEqual(pageNumbers(12, 12), [1, '…', 11, 12]);
  assert.deepEqual(pageNumbers(2, 12), [1, 2, 3, '…', 12]);
});
