import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTrackTorch, trackSupportsTorch } from './cameraFlash.js';

test('trackSupportsTorch is false without a torch capability', () => {
  assert.equal(trackSupportsTorch(null), false);
  assert.equal(trackSupportsTorch({}), false);
  assert.equal(trackSupportsTorch({ getCapabilities: () => ({}) }), false);
});

test('trackSupportsTorch is true when the track advertises torch', () => {
  assert.equal(trackSupportsTorch({ getCapabilities: () => ({ torch: true }) }), true);
});

test('setTrackTorch applies advanced torch constraints first', async () => {
  const applied = [];
  const track = {
    applyConstraints: async (constraints) => {
      applied.push(constraints);
    },
  };

  assert.equal(await setTrackTorch(track, true), true);
  assert.deepEqual(applied[0], { advanced: [{ torch: true }] });
});

test('setTrackTorch falls back if advanced constraints fail', async () => {
  const applied = [];
  const track = {
    applyConstraints: async (constraints) => {
      applied.push(constraints);
      if (constraints.advanced) throw new Error('unsupported');
    },
  };

  assert.equal(await setTrackTorch(track, false), true);
  assert.equal(applied.length, 2);
  assert.deepEqual(applied[1], { torch: false });
});

test('setTrackTorch returns false when the track cannot apply constraints', async () => {
  assert.equal(await setTrackTorch(null, true), false);
  assert.equal(
    await setTrackTorch(
      {
        applyConstraints: async () => {
          throw new Error('no torch');
        },
      },
      true,
    ),
    false,
  );
});
