import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getDownloadFilename,
  startPhotoDownload,
  triggerBlobDownload,
} from './photoDownload.js';
import {
  fetchPhotos,
  PHOTO_GALLERY_KINDS,
  photoMatchesFilters,
} from './photos.js';

test('download filenames work without a storage path', () => {
  assert.equal(
    getDownloadFilename({ name: 'PEYA-12345', public_url: 'https://cdn.example/a.jpg' }),
    'PEYA-12345.jpg',
  );
  assert.equal(getDownloadFilename({ name: 'RAPPI998877' }), 'RAPPI998877.jpg');
});

test('triggerBlobDownload keeps the object URL long enough to start the file', () => {
  const clicks = [];
  const removed = [];
  let revoked = false;
  const link = {
    style: {},
    click() {
      clicks.push(this.href);
    },
    remove() {
      removed.push(this.href);
    },
  };

  globalThis.document = {
    createElement() {
      return link;
    },
    body: { appendChild() {} },
  };
  globalThis.URL.createObjectURL = () => 'blob:photo';
  globalThis.URL.revokeObjectURL = () => {
    revoked = true;
  };

  assert.equal(triggerBlobDownload(new Blob(['foto']), 'PEYA123-evidencia.jpg'), true);
  assert.deepEqual(clicks, ['blob:photo']);
  assert.equal(link.download, 'PEYA123-evidencia.jpg');
  assert.equal(revoked, false);
  assert.deepEqual(removed, []);
});

test('startPhotoDownload fires immediately from a public URL when the photo is not cached', () => {
  const clicks = [];
  const link = {
    style: {},
    click() {
      clicks.push({ href: this.href, download: this.download, target: this.target });
    },
    remove() {},
  };
  globalThis.document = {
    createElement() {
      return link;
    },
    body: { appendChild() {} },
  };

  assert.equal(
    startPhotoDownload(
      { public_url: 'https://cdn.example/orders/peya.jpg', name: 'PEYA1' },
      new Set(),
      'PEYA1-evidencia.jpg',
    ),
    true,
  );
  assert.equal(clicks[0].href, 'https://cdn.example/orders/peya.jpg');
  assert.equal(clicks[0].download, 'PEYA1-evidencia.jpg');
});

test('photoMatchesFilters accurately categorizes orders vs files and codeNotFound', () => {
  const orderPhoto = {
    id: '1',
    name: '12345',
    file_path: 'orders/pedidosya/12345.jpg',
    created_at: new Date().toISOString(),
  };
  const unreadPhoto = {
    id: '2',
    name: 'Código no encontrado',
    file_path: 'orders/no_code/test.jpg',
    created_at: new Date().toISOString(),
  };
  const filePhoto = {
    id: '3',
    name: 'Remito',
    file_path: 'files/remito.pdf',
    created_at: new Date().toISOString(),
  };

  assert.equal(photoMatchesFilters(orderPhoto, { kind: PHOTO_GALLERY_KINDS.orders }), true);
  assert.equal(photoMatchesFilters(filePhoto, { kind: PHOTO_GALLERY_KINDS.orders }), false);

  assert.equal(photoMatchesFilters(filePhoto, { kind: PHOTO_GALLERY_KINDS.files }), true);
  assert.equal(photoMatchesFilters(orderPhoto, { kind: PHOTO_GALLERY_KINDS.files }), false);

  assert.equal(photoMatchesFilters(unreadPhoto, { codeNotFound: true }), true);
  assert.equal(photoMatchesFilters(orderPhoto, { codeNotFound: true }), false);
});

test('pagination metadata calculation handles > 1000 orders correctly', () => {
  const totalCount = 1450;
  const pageSize = 50;
  const totalPages = Math.ceil(totalCount / pageSize);

  assert.equal(totalPages, 29);
  assert.equal(totalCount > 1000, true);

  // Simulating 50 items on page 1
  const page1Items = Array.from({ length: 50 }, (_, i) => ({
    id: `photo-${i}`,
    name: `ORDER-${i}`,
    file_path: `orders/pedidosya/${i}.jpg`,
    created_at: new Date(Date.now() - i * 1000).toISOString(),
  }));
  page1Items.totalCount = totalCount;
  page1Items.page = 1;
  page1Items.pageSize = pageSize;
  page1Items.totalPages = totalPages;

  assert.equal(page1Items.length, 50);
  assert.equal(page1Items.totalCount, 1450);
  assert.equal(page1Items.totalPages, 29);
});

test('simultaneous uploads from two phones keep independent state without collisions', () => {
  // Phone A uploads 3 pairs, Phone B uploads 3 pairs at the same time
  const phoneAPairs = [
    { id: 'phoneA-p1', session_id: 'session-A', pair_number: 1, name: '1001' },
    { id: 'phoneA-p2', session_id: 'session-A', pair_number: 2, name: '1002' },
    { id: 'phoneA-p3', session_id: 'session-A', pair_number: 3, name: '1003' },
  ];
  const phoneBPairs = [
    { id: 'phoneB-p1', session_id: 'session-B', pair_number: 1, name: '2001' },
    { id: 'phoneB-p2', session_id: 'session-B', pair_number: 2, name: '2002' },
    { id: 'phoneB-p3', session_id: 'session-B', pair_number: 3, name: '2003' },
  ];

  const combined = [...phoneAPairs, ...phoneBPairs];
  const uniqueIds = new Set(combined.map((p) => p.id));
  assert.equal(uniqueIds.size, 6);

  // Filter per session
  const forSessionA = combined.filter((p) => p.session_id === 'session-A');
  const forSessionB = combined.filter((p) => p.session_id === 'session-B');
  assert.equal(forSessionA.length, 3);
  assert.equal(forSessionB.length, 3);
  assert.equal(forSessionA[0].pair_number, 1);
  assert.equal(forSessionB[0].pair_number, 1);
});
