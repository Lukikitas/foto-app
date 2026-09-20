import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestBackgroundQueueProcessing } from './uploadQueueBackground.js';
import { UPLOAD_QUEUE_MESSAGE, UPLOAD_QUEUE_SYNC_TAG } from './uploadQueueProtocol.js';

test('requestBackgroundQueueProcessing asks the service worker to keep draining', async () => {
  const messages = [];
  const tags = [];
  const ok = await requestBackgroundQueueProcessing({
    navigator: {
      serviceWorker: {
        ready: Promise.resolve({
          active: {
            postMessage(data) {
              messages.push(data);
            },
          },
          sync: {
            async register(tag) {
              tags.push(tag);
            },
          },
        }),
      },
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(messages, [{ type: UPLOAD_QUEUE_MESSAGE.process }]);
  assert.deepEqual(tags, [UPLOAD_QUEUE_SYNC_TAG]);
});

test('requestBackgroundQueueProcessing still works if Background Sync is missing', async () => {
  const messages = [];
  const ok = await requestBackgroundQueueProcessing({
    navigator: {
      serviceWorker: {
        ready: Promise.resolve({
          active: {
            postMessage(data) {
              messages.push(data);
            },
          },
        }),
      },
    },
  });

  assert.equal(ok, true);
  assert.equal(messages[0].type, UPLOAD_QUEUE_MESSAGE.process);
});
