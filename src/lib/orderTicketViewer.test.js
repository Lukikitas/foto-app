import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadOrderTicket, syncTicketToCloud, ticketDownloadFilename } from './orderTicketViewer.js';

test('viewer prefers the local ticket and never asks Supabase for it', async () => {
  const ticket = new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' });
  const result = await loadOrderTicket('photo-1', {
    getLocalTicket: async () => ticket,
    getRemoteTicket: async () => { throw new Error('Remote should not be used'); },
    createUrl: (file) => `blob:${file.name}`,
    syncLocalTicket: null,
  });
  assert.equal(result.source, 'local');
  assert.equal(result.url, 'blob:ticket.jpg');
  assert.equal(result.file, ticket);
  assert.equal(result.sync, null);
});

test('viewer schedules a cloud re-upload for a local ticket when enabled', async () => {
  const ticket = new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' });
  const synced = [];
  const result = await loadOrderTicket('photo-sync', {
    getLocalTicket: async () => ticket,
    getRemoteTicket: async () => { throw new Error('Remote should not be used'); },
    createUrl: (file) => `blob:${file.name}`,
    syncLocalTicket: async (id, file) => {
      synced.push([id, file]);
      return true;
    },
  });
  assert.equal(result.source, 'local');
  assert.ok(result.sync instanceof Promise);
  assert.equal(await result.sync, true);
  assert.deepEqual(synced, [['photo-sync', ticket]]);
});

test('viewer never fails the preview because the cloud re-upload rejects', async () => {
  const ticket = new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' });
  const result = await loadOrderTicket('photo-sync-fail', {
    getLocalTicket: async () => ticket,
    getRemoteTicket: async () => { throw new Error('Remote should not be used'); },
    createUrl: () => 'blob:ticket.jpg',
    syncLocalTicket: async () => { throw new Error('upload failed'); },
  });
  assert.equal(result.source, 'local');
  assert.equal(await result.sync, false);
});

test('viewer falls back to the Supabase signed url when the device has no copy', async () => {
  const result = await loadOrderTicket('photo-2', {
    getLocalTicket: async () => null,
    getRemoteTicket: async (id) => {
      assert.equal(id, 'photo-2');
      return 'https://example.test/ticket.jpg?token=abc';
    },
  });
  assert.equal(result.source, 'remote');
  assert.equal(result.url, 'https://example.test/ticket.jpg?token=abc');
  assert.equal(result.file, null);
  assert.equal(result.sync, null);
});

test('viewer returns null when neither source has a ticket', async () => {
  const result = await loadOrderTicket('photo-3', {
    getLocalTicket: async () => null,
    getRemoteTicket: async () => null,
  });
  assert.equal(result, null);
});

test('viewer still tries Supabase when the local store fails', async () => {
  const result = await loadOrderTicket('photo-4', {
    getLocalTicket: async () => { throw new Error('IndexedDB unavailable'); },
    getRemoteTicket: async () => 'https://example.test/ticket.jpg',
  });
  assert.equal(result.source, 'remote');
});

test('viewer propagates remote errors so the UI can show a retry message', async () => {
  await assert.rejects(
    loadOrderTicket('photo-5', {
      getLocalTicket: async () => null,
      getRemoteTicket: async () => { throw new Error('Function failed'); },
    }),
    /Function failed/,
  );
});

test('viewer short-circuits without a photo id', async () => {
  const result = await loadOrderTicket(null, {
    getLocalTicket: async () => { throw new Error('Should not run'); },
    getRemoteTicket: async () => { throw new Error('Should not run'); },
  });
  assert.equal(result, null);
});

test('ticket download filename keeps the order code and drops unreadable names', () => {
  assert.equal(ticketDownloadFilename({ name: 'PEYA12345' }), 'ticket-PEYA12345.jpg');
  assert.equal(ticketDownloadFilename({ name: 'Código no encontrado' }), 'ticket.jpg');
  assert.equal(ticketDownloadFilename({ name: '../../etc' }), 'ticket-etc.jpg');
  assert.equal(ticketDownloadFilename({}), 'ticket.jpg');
});

test('sync skips the upload when Supabase already has the ticket', async () => {
  const ticket = new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' });
  let uploaded = false;
  const synced = await syncTicketToCloud('photo-a', ticket, {
    hasRemoteTicket: async () => 'https://example.test/existing.jpg',
    uploadTicket: async () => { uploaded = true; return true; },
  });
  assert.equal(synced, false);
  assert.equal(uploaded, false);
});

test('sync uploads the local ticket when Supabase has none', async () => {
  const ticket = new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' });
  const calls = [];
  const synced = await syncTicketToCloud('photo-b', ticket, {
    hasRemoteTicket: async () => null,
    uploadTicket: async (id, file) => {
      calls.push([id, file]);
      return true;
    },
  });
  assert.equal(synced, true);
  assert.deepEqual(calls, [['photo-b', ticket]]);
});

test('sync never throws when Supabase rejects (window, quota or offline)', async () => {
  const ticket = new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' });
  const synced = await syncTicketToCloud('photo-c', ticket, {
    hasRemoteTicket: async () => { throw new Error('offline'); },
    uploadTicket: async () => true,
  });
  assert.equal(synced, false);
});
