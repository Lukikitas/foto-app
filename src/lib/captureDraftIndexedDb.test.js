import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { saveCaptureDraft, getCaptureDraft, deleteCaptureDraft, commitCaptureDraft } from './captureDraftStore.js';

const previous = globalThis.indexedDB;
globalThis.indexedDB = new IDBFactory();
after(() => { globalThis.indexedDB = previous; });

test('IndexedDB transaction commits both exact files before a capture is acknowledged', async () => {
  const draft = { id: 'idb-capture', createdAt: 1700000000123, ticketFile: new File([Uint8Array.of(1, 2, 3)], 'ticket.jpg', { type: 'image/jpeg' }),
    evidenceFile: new File([Uint8Array.of(4, 5, 6)], 'evidence.jpg', { type: 'image/jpeg' }), meta: { taken_by: 'Prueba' } };
  await saveCaptureDraft(draft);
  const stored = await getCaptureDraft(draft.id);
  assert.deepEqual(new Uint8Array(await stored.ticketFile.arrayBuffer()), Uint8Array.of(1, 2, 3));
  assert.deepEqual(new Uint8Array(await stored.evidenceFile.arrayBuffer()), Uint8Array.of(4, 5, 6));
  assert.equal(stored.createdAt, draft.createdAt);
  await assert.rejects(commitCaptureDraft(draft.id, async () => { throw new Error('queue quota exceeded'); }), /quota/);
  assert.ok(await getCaptureDraft(draft.id));
  await commitCaptureDraft(draft.id, async row => {
    assert.ok(await getCaptureDraft(row.id), 'draft must survive until the queue acknowledges its copy');
    assert.equal(row.id, draft.id);
  });
  assert.equal(await getCaptureDraft(draft.id), undefined);
});

test('an incomplete ticket survives a completed-pair recovery attempt', async () => {
  await saveCaptureDraft({ id: 'incomplete-idb', createdAt: 1234, ticketFile: new Blob(['ticket']) });
  assert.equal(await commitCaptureDraft('incomplete-idb', () => assert.fail('unexpected enqueue')), false);
  assert.equal(await (await getCaptureDraft('incomplete-idb')).ticketFile.text(), 'ticket');
  await deleteCaptureDraft('incomplete-idb');
});
