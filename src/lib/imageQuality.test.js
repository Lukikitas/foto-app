import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreImageQuality } from './imageQuality.js';

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
