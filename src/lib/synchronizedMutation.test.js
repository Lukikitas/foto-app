import assert from 'node:assert/strict';
import test from 'node:test';
import { runSynchronizedMutation } from './synchronizedMutation.js';

test('a synchronized mutation commits without compensation', async () => {
  const calls = [];
  const result = await runSynchronizedMutation({
    apply: async () => { calls.push('apply'); return 'photo'; },
    commit: async (photo) => { calls.push(`commit:${photo}`); return 'history'; },
    rollback: async () => calls.push('rollback'),
  });
  assert.equal(result, 'history');
  assert.deepEqual(calls, ['apply', 'commit:photo']);
});

test('a history failure compensates the gallery write and remains retryable', async () => {
  const calls = [];
  await assert.rejects(() => runSynchronizedMutation({
    apply: async () => { calls.push('apply'); return { snapshot: 'before' }; },
    commit: async () => { calls.push('commit'); throw new Error('history unavailable'); },
    rollback: async (value) => calls.push(`rollback:${value.snapshot}`),
  }), /history unavailable/);
  assert.deepEqual(calls, ['apply', 'commit', 'rollback:before']);
});
