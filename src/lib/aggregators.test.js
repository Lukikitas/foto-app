import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignComplaintsAggregator, getComplaintAggregator } from './aggregators.js';

test('assignComplaintsAggregator stamps a known partner on every row', () => {
  const stamped = assignComplaintsAggregator(
    [{ orderCode: '2093192289' }, { orderCode: 'PEYA-1', aggregator: 'pedidosya' }],
    'rappi',
  );
  assert.equal(stamped[0].aggregator, 'rappi');
  assert.equal(stamped[1].aggregator, 'rappi');
  assert.equal(getComplaintAggregator(stamped[0]), 'rappi');
  assert.equal(getComplaintAggregator(stamped[1]), 'rappi');
});

test('assignComplaintsAggregator leaves rows alone when no partner is chosen', () => {
  const list = [{ orderCode: 'PEYA-1' }];
  assert.equal(assignComplaintsAggregator(list, ''), list);
  assert.equal(assignComplaintsAggregator(list, 'unknown'), list);
  assert.equal(getComplaintAggregator(list[0]), 'pedidosya');
});
