import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVIDENCE_IMAGE_OPTIONS, sharpenImageData } from './compressImage.js';

test('evidence processing preserves more detail than generic compression', () => {
  assert.equal(EVIDENCE_IMAGE_OPTIONS.maxDimension, 2400);
  assert.equal(EVIDENCE_IMAGE_OPTIONS.jpegQuality, 0.9);
  assert.equal(EVIDENCE_IMAGE_OPTIONS.sharpen, true);
});

test('sharpening leaves flat pixels alone and increases real edge contrast', () => {
  const width = 3;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = data[index + 1] = data[index + 2] = 100;
    data[index + 3] = 255;
  }
  const center = (width + 1) * 4;
  data[center] = data[center + 1] = data[center + 2] = 140;
  const result = sharpenImageData({ width, height, data });
  assert.ok(result.data[center] > 140);
  assert.equal(result.data[0], 100);
  assert.equal(result.data[center + 3], 255);
});
