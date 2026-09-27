import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCodeListDefaults,
  codeListItem,
  complaintFromCodeItem,
  parseComplaintCodeList,
} from './complaintCodeList.js';

test('parses pasted code columns, removes duplicates and reports invalid values', () => {
  const parsed = parseComplaintCodeList('Código\nPEYA-123456\tRAPPI987654;PEYA-123456\nmal código');
  assert.deepEqual(parsed.valid, ['PEYA-123456', 'RAPPI987654']);
  assert.deepEqual(parsed.duplicates, ['PEYA-123456']);
  assert.deepEqual(parsed.invalid, ['MAL CÓDIGO']);
});

test('matched photos provide date and aggregator automatically', () => {
  const item = codeListItem('123456', {
    status: 'matched',
    photo: {
      id: 'photo-1',
      created_at: '2026-09-27T15:00:00.000Z',
      file_path: 'orders/rappi/photo.jpg',
    },
  });
  assert.equal(item.day, '2026-09-27');
  assert.equal(item.aggregator, 'rappi');
  assert.equal(item.selected, false);
});

test('bulk defaults apply only to selected rows and produce pending complaints', () => {
  const items = [codeListItem('111111'), codeListItem('222222')];
  const changed = applyCodeListDefaults(items, [items[0].key], {
    day: '2026-09-27', aggregator: 'pedidosya',
  });
  assert.equal(changed[1].day, '');
  const complaint = complaintFromCodeItem(changed[0]);
  assert.equal(complaint.day, '2026-09-27');
  assert.equal(complaint.aggregator, 'pedidosya');
  assert.match(complaint.reason, /Pendiente/);
});

test('missing photos require both date and aggregator', () => {
  assert.throws(() => complaintFromCodeItem(codeListItem('111111')), /fecha/);
  assert.throws(() => complaintFromCodeItem({ ...codeListItem('111111'), day: '2026-09-27' }), /agregador/);
});
