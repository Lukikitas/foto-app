import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OCR_MAX_SIDE,
  TICKET_TARGET_SIDE,
  buildEvidencePasses,
  buildRecognitionPasses,
  countRecognitionJobs,
} from './ocrPlan.js';
import { fastCodeCropPlan, isCompleteEvidenceCode } from './orderOcrPipeline.js';

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
  const passes = buildEvidencePasses({
    enhancedFull: fakeCanvas('full'),
    regionCrops: [fakeCanvas('region')],
    evidenceCrops: [fakeCanvas('right')],
    PSM,
  });

  assert.deepEqual(passes[0].rotations, [90, 270]);
  assert.equal(passes[0].sources[0].id, 'region');
  assert.equal(passes[1].sources[0].id, 'right');
  assert.ok(countRecognitionJobs(passes) <= 8);
});

test('evidence only auto-assigns labeled codes with complete platform length', () => {
  assert.equal(isCompleteEvidenceCode({ labeled: 1, order: { displayCode: 'PEYA2299229072', aggregator: 'pedidosya' } }), true);
  assert.equal(isCompleteEvidenceCode({ labeled: 1, order: { displayCode: 'PEYA229922907', aggregator: 'pedidosya' } }), false);
  assert.equal(isCompleteEvidenceCode({ labeled: 0, order: { displayCode: 'PEYA2299229072', aggregator: 'pedidosya' } }), false);
});

test('focused ticket reads prioritize the likely orientation without requiring live OCR', () => {
  assert.deepEqual(fastCodeCropPlan(960, 1280).map((entry) => entry.rotation), [0, 0, 90, 270, 0, 0, 180]);
  assert.deepEqual(fastCodeCropPlan(1280, 960).map((entry) => entry.rotation), [270, 270, 270, 90, 90, 90, 0, 0, 180]);
  assert.equal(fastCodeCropPlan(960, 1280)[0].top, 0.28);
  assert.equal(fastCodeCropPlan(1280, 960)[0].width, 0.55);
});
