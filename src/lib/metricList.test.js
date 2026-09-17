import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMetricList, parseMetricList } from './metricList.js';
import { emptyStore, upsertDayStats } from './metrics.js';

const SAMPLE = `Martes	1-sept	174	5	14
Miércoles	2-sept	173	3	19
Jueves	3-sept	180	7	11
Viernes	4-sept	285	10	10
Sábado	5-sept	302	4	31
Domingo	6-sept	251	3	14
Lunes	7-sept	153	2	5
Martes	8-sept	148	1	19
Miércoles	9-sept	173	4	7
Jueves	10-sept	161	6	17
Viernes	11-sept	266	5	14
Sábado	12-sept	250	6	39
Domingo	13-sept	190	5	19`;

test('parses an Excel PedidosYa list with weekday, 1-sept, pedidos, quejas and AWT', () => {
  const { rows, errors } = parseMetricList(SAMPLE, { today: '2026-09-17' });
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 13);
  assert.deepEqual(rows[0], {
    day: '2026-09-01',
    orders: 174,
    complaints: 5,
    awt: 14,
    raw: 'Martes\t1-sept\t174\t5\t14',
  });
  assert.equal(rows[4].day, '2026-09-05');
  assert.equal(rows[4].orders, 302);
  assert.equal(rows[4].awt, 31);
  assert.equal(rows[12].day, '2026-09-13');
  assert.equal(rows[12].complaints, 5);
});

test('skips headers and reads space-separated rows without AWT', () => {
  const { rows, errors } = parseMetricList(
    `Pedidos Quejas AWT
1-sept 174 5
2 sept 80 1`,
    { today: '2026-09-17' },
  );
  assert.equal(errors.length, 0);
  assert.equal(rows[0].awt, 0);
  assert.equal(rows[1].day, '2026-09-02');
  assert.equal(rows[1].orders, 80);
});

test('applies the list to one aggregator without wiping the others', () => {
  let store = upsertDayStats(emptyStore(), '2026-09-01', 'rappi', { orders: 40, complaints: 1 });
  const { rows } = parseMetricList('1-sept\t174\t5\t14', { today: '2026-09-17' });
  store = applyMetricList(store, 'pedidosya', rows);
  assert.equal(store.days['2026-09-01'].pedidosya.orders, 174);
  assert.equal(store.days['2026-09-01'].pedidosya.awt, 14);
  assert.equal(store.days['2026-09-01'].rappi.orders, 40);
});
