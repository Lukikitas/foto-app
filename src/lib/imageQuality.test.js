import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSharpest, scoreImageQuality } from './imageQuality.js';

function pixels(width, height, shade) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = shade(x, y);
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

test('dark and featureless captures get a warning without rejecting the photo', () => {
  assert.equal(scoreImageQuality(pixels(32, 32, () => 25)).issue, 'dark');
  assert.equal(scoreImageQuality(pixels(32, 32, () => 160)).issue, 'blurry');
});

test('sharp text-like edges remain usable', () => {
  const image = pixels(32, 32, (x, y) => (x % 4 < 2 || y % 8 < 2 ? 235 : 45));
  assert.equal(scoreImageQuality(image).issue, null);
});

test('pickSharpest prefers clean frames over sharper frames with warnings', () => {
  const dark = { id: 'dark', quality: { issue: 'dark', sharpness: 9999 } };
  const clean = { id: 'clean', quality: { issue: null, sharpness: 100 } };
  assert.equal(pickSharpest([dark, clean]), clean);
  assert.equal(pickSharpest([clean, dark]), clean);
});

test('pickSharpest ranks warned frames by sharpness', () => {
  const soft = { id: 'soft', quality: { issue: 'blurry', sharpness: 40 } };
  const sharp = { id: 'sharp', quality: { issue: 'dark', sharpness: 300 } };
  assert.equal(pickSharpest([soft, sharp]), sharp);
  assert.equal(pickSharpest([sharp, soft]), sharp);
});

test('pickSharpest keeps the earliest frame on ties', () => {
  const first = { id: 'first', quality: { issue: null, sharpness: 120 } };
  const second = { id: 'second', quality: { issue: null, sharpness: 120 } };
  assert.equal(pickSharpest([first, second]), first);
});

test('pickSharpest folds a burst exactly like the capture does', () => {
  const burst = [
    { id: 'f0', quality: { issue: null, sharpness: 95 } },
    { id: 'f1', quality: { issue: 'blurry', sharpness: 400 } },
    { id: 'f2', quality: { issue: null, sharpness: 150 } },
  ];
  let best = burst[0];
  for (let i = 1; i < burst.length; i += 1) best = pickSharpest([best, burst[i]]);
  assert.equal(best, burst[2]);
  assert.equal(pickSharpest([]), null);
  assert.equal(pickSharpest(), null);
});
