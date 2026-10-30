import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { saveCaptureDraft, getCaptureDraft, commitCaptureDraft, recoverCompletedCaptureDrafts, setCaptureDraftStoreForTests } from './captureDraftStore.js';

afterEach(() => setCaptureDraftStoreForTests(null));
function setup() {
  const records = new Map();
  setCaptureDraftStoreForTests({ put: async row => { records.set(row.id, structuredClone(row)); }, get: async id => records.get(id), delete: async id => records.delete(id), keys: async () => [...records.keys()] });
  return { id: 'capture-1', createdAt: 1234, ticketFile: new Blob(['ticket']), evidenceFile: new Blob(['evidence']), meta: { taken_by: 'team' } };
}

test('a failed queue handoff preserves both original files and capture time', async () => {
  const draft = setup();
  await saveCaptureDraft({ ...draft, ticketUpgrade: Promise.resolve(null) });
  await assert.rejects(commitCaptureDraft(draft.id, async () => { throw new Error('disk full'); }), /disk full/);
  const copy = await getCaptureDraft(draft.id);
  assert.equal(await copy.ticketFile.text(), 'ticket');
  assert.equal(await copy.evidenceFile.text(), 'evidence');
  assert.equal(copy.createdAt, 1234);
  assert.equal('ticketUpgrade' in copy, false);
});

test('restart recovers complete pairs while retaining incomplete tickets for the camera', async () => {
  const draft = setup();
  await saveCaptureDraft(draft);
  await saveCaptureDraft({ ...draft, id: 'incomplete', evidenceFile: null });
  const received = [];
  await recoverCompletedCaptureDrafts(async row => received.push(row));
  assert.equal(received.length, 1);
  assert.equal(received[0].id, draft.id);
  assert.equal(received[0].createdAt, 1234);
  assert.equal(await getCaptureDraft(draft.id), undefined);
  assert.ok(await getCaptureDraft('incomplete'));
});

test('Repetir persists a ticket draft before replacing the evidence', async () => {
  const draft = setup();
  await saveCaptureDraft(draft);
  await saveCaptureDraft({ ...draft, evidenceFile: null });
  assert.equal(await commitCaptureDraft(draft.id, () => assert.fail('incomplete draft uploaded')), false);
  await saveCaptureDraft({ ...draft, evidenceFile: new Blob(['replacement']) });
  await commitCaptureDraft(draft.id, async row => assert.equal(await row.file.text(), 'replacement'));
});
