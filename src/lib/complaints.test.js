import assert from 'node:assert/strict';
import { test } from 'node:test';
import { complaintPhotoSearchTokens, photoNameSearchVariants } from './complaintMatch.js';
import { matchComplaintToPhotos } from './complaintMatch.js';

test('search tokens keep the hyphenated gallery name and the compact code', () => {
  const variants = photoNameSearchVariants('PEYA-2286878556');
  assert.ok(variants.includes('PEYA-2286878556'));
  assert.ok(variants.includes('PEYA2286878556'));
  assert.ok(variants.includes('2286878556'));

  const tokens = complaintPhotoSearchTokens([{ orderCode: 'PEYA-2286878556' }]);
  assert.ok(tokens.includes('PEYA-2286878556'));
  assert.equal(tokens.includes('8556'), false);
});

test('numeric sheet codes search the digit tail that appears inside PEYA-... photo names', () => {
  const tokens = complaintPhotoSearchTokens([{ orderCode: '2286878556' }]);
  assert.ok(tokens.includes('2286878556'));
});

test('a hyphenated gallery photo still matches a compact sheet code', () => {
  const result = matchComplaintToPhotos(
    {
      id: 'c1',
      orderCode: 'PEYA2286878556',
      orderAtIso: '2026-09-20T18:00:00.000-03:00',
      timeOfDay: '18:00',
      dateAssumed: false,
      reason: '',
      comment: '',
    },
    [
      {
        id: 'p1',
        name: 'PEYA-2286878556',
        file_path: 'orders/pedidosya/1.jpg',
        created_at: '2026-09-17T17:51:00.000-03:00',
      },
    ],
  );
  assert.equal(result.status, 'matched');
  assert.equal(result.photo.id, 'p1');
});

test('last-four tokens are only added when the caller asks for short matches', () => {
  const short = complaintPhotoSearchTokens([{ orderCode: 'PEYA-2286878556' }], { includeShort: true });
  assert.ok(short.includes('8556'));
});
