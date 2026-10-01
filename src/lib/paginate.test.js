import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllPages } from './paginate.js';

function tableQuery(table, { cap = null } = {}) {
  return () => ({
    async range(from, to) {
      const end = cap == null ? to + 1 : Math.min(to + 1, from + cap);
      return { data: table.slice(from, end), error: null };
    },
  });
}

test('fetchAllPages concatena páginas hasta agotar la tabla', async () => {
  const table = Array.from({ length: 2500 }, (_, index) => ({ id: index }));
  const rows = await fetchAllPages(tableQuery(table), { pageSize: 1000 });
  assert.equal(rows.length, 2500);
  assert.equal(rows[0].id, 0);
  assert.equal(rows[2499].id, 2499);
});

test('fetchAllPages se detiene en la primera página corta', async () => {
  const table = Array.from({ length: 700 }, (_, index) => ({ id: index }));
  const rows = await fetchAllPages(tableQuery(table), { pageSize: 1000 });
  assert.equal(rows.length, 700);
});

test('fetchAllPages devuelve vacío sin llamadas extra cuando no hay filas', async () => {
  let calls = 0;
  const buildQuery = () => ({
    async range() {
      calls += 1;
      return { data: [], error: null };
    },
  });
  const rows = await fetchAllPages(buildQuery, { pageSize: 1000 });
  assert.deepEqual(rows, []);
  assert.equal(calls, 1);
});

test('fetchAllPages corta en maxRows sin pedir páginas de más', async () => {
  const table = Array.from({ length: 9000 }, (_, index) => ({ id: index }));
  const rows = await fetchAllPages(tableQuery(table), { pageSize: 1000, maxRows: 1200 });
  assert.equal(rows.length, 1200);
  assert.equal(rows[1199].id, 1199);
});

test('fetchAllPages propaga el error de la query', async () => {
  const buildQuery = () => ({
    async range() {
      return { data: null, error: new Error('falló la red') };
    },
  });
  await assert.rejects(() => fetchAllPages(buildQuery), /falló la red/);
});

test('fetchAllPages corta en maxPages aunque la tabla siga devolviendo filas', async () => {
  const infinite = () => ({
    async range(from, to) {
      return { data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })), error: null };
    },
  });
  const rows = await fetchAllPages(infinite, { pageSize: 100, maxPages: 3 });
  assert.equal(rows.length, 300);
});

test('fetchAllPages deduplica filas repetidas entre páginas', async () => {
  // Simula una foto nueva que empuja filas mientras paginamos.
  const pages = [
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'b' }, { id: 'c' }],
    [{ id: 'c' }],
  ];
  let page = 0;
  const buildQuery = () => ({
    async range() {
      return { data: pages[page++] ?? [], error: null };
    },
  });
  const rows = await fetchAllPages(buildQuery, { pageSize: 2 });
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c']);
});

test('fetchAllPages notifica el acumulado después de cada bloque con onPage', async () => {
  const table = Array.from({ length: 250 }, (_, index) => ({ id: index }));
  const snapshots = [];
  const rows = await fetchAllPages(tableQuery(table), {
    pageSize: 100,
    onPage: (chunk) => snapshots.push(chunk.length),
  });
  assert.equal(rows.length, 250);
  // Primer bloque de100 (para pintar de inmediato), luego 200 y el total.
  assert.deepEqual(snapshots, [100, 200, 250]);
});
