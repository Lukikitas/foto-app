import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clipboardOrderCode,
  codeMatchScore,
  matchComplaintToPhotos,
  matchComplaintsToPhotos,
} from './complaintMatch.js';
import { mergeComplaintNotes } from './complaintMatch.js';

function photo(overrides) {
  return {
    id: 'p1',
    name: 'PEYA12345',
    file_path: 'orders/pedidosya/1.jpg',
    public_url: 'https://example.com/1.jpg',
    created_at: '2026-09-16T21:40:00.000-03:00',
    has_complaint: false,
    is_refutado: false,
    notes: null,
    ...overrides,
  };
}

function complaint(overrides) {
  return {
    id: 'c1',
    orderCode: 'PEYA12345',
    orderAtIso: '2026-09-16T21:30:00.000-03:00',
    timeOfDay: '21:30',
    dateAssumed: false,
    reason: 'Faltan productos',
    comment: 'Papas',
    ...overrides,
  };
}

test('clipboard copies the portal search id without the aggregator prefix', () => {
  assert.equal(clipboardOrderCode('PEYA-2277060160'), '2277060160');
  assert.equal(clipboardOrderCode('PEYA2277060160'), '2277060160');
  assert.equal(clipboardOrderCode('2277060160'), '2277060160');
  assert.equal(clipboardOrderCode('RAPPI-998877'), '998877');
  assert.equal(clipboardOrderCode('RAPPITURBO-112233'), '112233');
  assert.equal(clipboardOrderCode(''), '');
});

test('scores exact aggregator codes highest', () => {
  assert.equal(codeMatchScore('PEYA12345', 'PEYA12345'), 100);
  assert.equal(codeMatchScore('PEYA-12345', 'PEYA12345'), 100);
  assert.equal(codeMatchScore('PEYA12345', '12345'), 96);
  assert.equal(codeMatchScore('2284672300', 'PEYA-2284672300'), 96);
  assert.equal(codeMatchScore('PEYA12345', '2345'), 40);
  assert.equal(codeMatchScore('PEYA12345', 'Código no encontrado'), 0);
});

test('matches a complaint to the order photo by code and time', () => {
  const result = matchComplaintToPhotos(complaint(), [photo()]);
  assert.equal(result.status, 'matched');
  assert.equal(result.photo.id, 'p1');
});

test('matches the same code even if the photo was taken days earlier', () => {
  const result = matchComplaintToPhotos(
    complaint({ orderAtIso: '2026-09-20T18:00:00.000-03:00' }),
    [photo({ created_at: '2026-09-16T21:40:00.000-03:00' })],
  );
  assert.equal(result.status, 'matched');
  assert.equal(result.photo.id, 'p1');
});

test('matches a numeric sheet code to a PEYA photo name', () => {
  const result = matchComplaintToPhotos(
    complaint({ orderCode: '2284672300' }),
    [photo({ name: 'PEYA-2284672300' })],
  );
  assert.equal(result.status, 'matched');
});

test('matches a unique last-four even if the photo is from another day', () => {
  const result = matchComplaintToPhotos(complaint({ orderCode: '1234' }), [
    photo({
      id: 'old',
      name: 'PEYA991234',
      created_at: '2026-09-10T21:40:00.000-03:00',
    }),
  ]);
  assert.equal(result.status, 'matched');
});

test('does not guess among several last-four matches far from the complaint time', () => {
  const result = matchComplaintToPhotos(complaint({ orderCode: '1234' }), [
    photo({ id: 'a', name: 'PEYA111234', created_at: '2026-09-10T21:40:00.000-03:00' }),
    photo({ id: 'b', name: 'RAPPI991234', created_at: '2026-09-08T10:00:00.000-03:00' }),
  ]);
  assert.equal(result.status, 'unmatched');
});

test('marks last-four collisions in the same window as ambiguous', () => {
  const result = matchComplaintToPhotos(complaint({ orderCode: '2345' }), [
    photo({ id: 'a', name: 'PEYA112345', created_at: '2026-09-16T21:35:00.000-03:00' }),
    photo({ id: 'b', name: 'RAPPI992345', created_at: '2026-09-16T21:50:00.000-03:00' }),
  ]);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('uses a manually picked photo even if another one also matches', () => {
  const result = matchComplaintToPhotos(
    complaint({ orderCode: '2345' }),
    [
      photo({ id: 'a', name: 'PEYA112345' }),
      photo({ id: 'b', name: 'RAPPI992345' }),
    ],
    'b',
  );
  assert.equal(result.status, 'matched');
  assert.equal(result.photo.id, 'b');
});

test('keeps unmatched complaints when there is no photo', () => {
  const rows = matchComplaintsToPhotos([complaint()], []);
  assert.equal(rows[0].status, 'unmatched');
  assert.equal(rows[0].photo, null);
});

test('appends reclamo notes without duplicating them', () => {
  const once = mergeComplaintNotes(null, {
    reason: 'Faltan productos',
    comment: 'Papas',
  });
  assert.equal(once, 'Reclamo: Faltan productos\nPapas');
  assert.equal(
    mergeComplaintNotes(once, { reason: 'Faltan productos', comment: 'Papas' }),
    once,
  );
});
