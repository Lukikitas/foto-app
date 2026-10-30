import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureTicketStored } from './ticketUploadProtocol.js';

test('a reservation whose upload was interrupted is not reported as stored', async () => {
  let uploaded = false;
  const result = await ensureTicketStored({ findReference: async () => ({}), reserve: async () => true,
    exists: async () => uploaded, upload: async () => { uploaded = true; } });
  assert.equal(uploaded, true);
  assert.deepEqual(result, { stored: true });
});
test('a lost upload acknowledgement reconciles the object without deleting its reservation', async () => {
  let stored = false;
  const result = await ensureTicketStored({ findReference: async () => null, reserve: async () => true,
    exists: async () => stored, upload: async () => { stored = true; throw new Error('connection lost after commit'); } });
  assert.deepEqual(result, { stored: true, cached: true });
});
test('a failed transfer remains an error with no false acknowledgement', async () => {
  await assert.rejects(ensureTicketStored({ findReference: async () => ({}), reserve: async () => true,
    exists: async () => false, upload: async () => { throw new Error('offline'); } }), /offline/);
});
test('quota exhaustion never acknowledges or attempts an upload', async () => {
  const result = await ensureTicketStored({ findReference: async () => null, reserve: async () => false,
    exists: async () => false, upload: () => assert.fail('quota should stop upload') });
  assert.deepEqual(result, { stored: false, reason: 'quota' });
});
