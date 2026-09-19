import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getDownloadFilename,
  startPhotoDownload,
  triggerBlobDownload,
} from './photoDownload.js';

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
