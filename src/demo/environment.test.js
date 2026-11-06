import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedStorage } from './environment.js';

test('demo on the real domain cannot read or overwrite operational browser data', () => {
  const entries = new Map([['foto-app-review-draft-v1', 'original draft'], ['foto-app-theme', 'light']]);
  const storage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
    key: index => [...entries.keys()][index] ?? null,
    get length() { return entries.size; },
  };
  const demo = createScopedStorage(storage);
  assert.equal(demo.getItem('foto-app-review-draft-v1'), null);
  demo.setItem('foto-app-theme', 'dark');
  assert.equal(storage.getItem('foto-app-theme'), 'light');
  assert.equal(demo.getItem('foto-app-theme'), 'dark');
  assert.equal(demo.length, 1);
  assert.equal(demo.key(0), 'foto-app-theme');
  demo.clear();
  assert.equal(storage.getItem('foto-app-review-draft-v1'), 'original draft');
  assert.equal(storage.getItem('foto-app-theme'), 'light');
  assert.equal(demo.length, 0);
});
