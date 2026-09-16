import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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

test('scores exact aggregator codes highest', () => {
  assert.equal(codeMatchScore('PEYA12345', 'PEYA12345'), 100);
  assert.equal(codeMatchScore('PEYA-12345', 'PEYA12345'), 100);
  assert.equal(codeMatchScore('PEYA12345', '12345'), 92);
  assert.equal(codeMatchScore('PEYA12345', '2345'), 40);
  assert.equal(codeMatchScore('PEYA12345', 'Código no encontrado'), 0);
});

test('matches a complaint to the order photo by code and time', () => {
  const result = matchComplaintToPhotos(complaint(), [photo()]);
  assert.equal(result.status, 'matched');
  assert.equal(result.photo.id, 'p1');
});

test('does not match a last-four collision outside the time window', () => {
  const result = matchComplaintToPhotos(complaint({ orderCode: '1234' }), [
    photo({
      id: 'old',
      name: 'PEYA991234',
      created_at: '2026-09-10T21:40:00.000-03:00',
    }),
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
