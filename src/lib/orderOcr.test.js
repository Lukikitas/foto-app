import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OCR_MAX_SIDE,
  TICKET_TARGET_SIDE,
  buildRecognitionPasses,
  countRecognitionJobs,
} from './ocrPlan.js';

const PSM = {
  SINGLE_BLOCK: 6,
  AUTO: 3,
  SPARSE_TEXT: 11,
};

function fakeCanvas(id) {
  return { id };
}

test('OCR canvases stay large enough for printed codes but smaller than before', () => {
  assert.ok(OCR_MAX_SIDE >= 1800);
  assert.ok(OCR_MAX_SIDE <= 2200);
  assert.ok(TICKET_TARGET_SIDE >= 1600);
  assert.ok(TICKET_TARGET_SIDE <= OCR_MAX_SIDE);
});

test('first thorough pass is a short SINGLE_BLOCK read of the best views', () => {
  const passes = buildRecognitionPasses({
    enhancedFull: fakeCanvas('full'),
    regionCrops: [fakeCanvas('region')],
    extraBands: [fakeCanvas('band')],
    PSM,
    thorough: true,
  });

  assert.deepEqual(passes[0].psms, [PSM.SINGLE_BLOCK]);
  assert.deepEqual(passes[0].rotations, [0]);
  assert.equal(passes[0].sources.length, 2);
  assert.ok(countRecognitionJobs([passes[0]]) <= 4);
  assert.ok(countRecognitionJobs(passes) <= 28);
  assert.ok(countRecognitionJobs(passes) >= 10);
});

test('fallback evidence photos use a lighter plan', () => {
  const passes = buildRecognitionPasses({
    enhancedFull: fakeCanvas('full'),
    regionCrops: [fakeCanvas('region')],
    extraBands: [fakeCanvas('band')],
    PSM,
    thorough: false,
  });

  assert.equal(passes.some((pass) => pass.rotations.includes(90)), false);
  assert.ok(countRecognitionJobs(passes) <= 6);
});
