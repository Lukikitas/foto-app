import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoData } from './data.js';
import { performanceView } from '../lib/performanceViews.js';
import { toArgentinaDate } from '../lib/metrics.js';

test('demo orders, complaints, evidence and daily metrics agree across all platforms and dates', () => {
  const { metrics, history, photos } = createDemoData('2026-11-06');
  const orders = photos.filter(photo => photo.file_path.startsWith('orders/'));
  const cases = Object.values(history.items);
  assert.equal(Object.keys(metrics.days).length, 70);
  const byPhoto = new Map(orders.map(photo => [photo.id, photo]));
  const orderGroups = new Map();
  for (const photo of orders) {
    const key = `${toArgentinaDate(photo.created_at)}|${photo.aggregator}`;
    if (!orderGroups.has(key)) orderGroups.set(key, []);
    orderGroups.get(key).push(photo);
  }
  for (const item of cases) {
    const photo = byPhoto.get(item.photoId);
    assert.ok(photo);
    assert.equal(photo.name, item.orderCode);
    assert.equal(photo.aggregator, item.aggregator);
    assert.equal(photo.has_complaint, true);
    assert.equal(photo.public_url, item.photoUrl);
    assert.ok(item.amount > 0);
  }
  for (const [day, platforms] of Object.entries(metrics.days)) {
    for (const [aggregator, stats] of Object.entries(platforms)) {
      const matching = orderGroups.get(`${day}|${aggregator}`) || [];
      assert.equal(matching.length, stats.orders, `${day}/${aggregator} orders`);
      assert.equal(cases.filter(item => item.day === day && item.aggregator === aggregator).length, stats.complaints);
      assert.equal(matching.filter(photo => photo.has_complaint).length, stats.complaints);
      assert.ok(stats.awt <= stats.orders);
    }
  }
  const from = '2026-11-01'; const to = '2026-11-06';
  for (const view of ['overview', 'report', 'staff', 'complaints', 'pending']) {
    const result = performanceView({ view, metrics, history, photos: orders.filter(photo => toArgentinaDate(photo.created_at) >= from), from, to, today: to });
    assert.ok(result.metrics);
  }
});

test('demo generation is deterministic and follows the presentation date', () => {
  const first = createDemoData('2026-11-06');
  assert.deepEqual(first, createDemoData('2026-11-06'));
  const next = createDemoData('2026-11-07');
  assert.equal(Object.keys(next.metrics.days).at(-1), '2026-11-07');
  assert.equal(Object.keys(first.metrics.days).at(-1), '2026-11-06');
});
