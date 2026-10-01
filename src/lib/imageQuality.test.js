import test from 'node:test';
import assert from 'node:assert/strict';
import {
  centerCropBox,
  normalizedCorrelation,
  pickSharpest,
  SAME_SCENE_MIN_CORRELATION,
  sceneSimilarity,
  scoreImageQuality,
} from './imageQuality.js';

const GRID_WIDTH = 64;
const GRID_HEIGHT = 48;

// Escena sintética texturizada (patrón tipo ticket/bolsa): sinusoides +
// bloques de alta frecuencia, determinística.
function sceneGrid(width = GRID_WIDTH, height = GRID_HEIGHT) {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = 110 + 70 * Math.sin(x / 3.1) * Math.cos(y / 2.7) + ((x * y) % 97);
    }
  }
  return data;
}

// Recorte central con reescalado nearest-neighbor: simula un still que viene
// "más zoom" que el frame del visor.
function zoomCenterGrid(source, width, height, factor) {
  const cropWidth = width / factor;
  const cropHeight = height / factor;
  const offsetX = (width - cropWidth) / 2;
  const offsetY = (height - cropHeight) / 2;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(width - 1, Math.floor(offsetX + (x * cropWidth) / width));
      const sy = Math.min(height - 1, Math.floor(offsetY + (y * cropHeight) / height));
      out[y * width + x] = source[sy * width + sx];
    }
  }
  return out;
}

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

test('centerCropBox centers both landscape and portrait sources on the target aspect', () => {
  assert.deepEqual(centerCropBox(400, 300, 4 / 3), { sx: 0, sy: 0, width: 400, height: 300 });
  // Fuente más ancha → se recortan los costados.
  assert.deepEqual(centerCropBox(640, 360, 4 / 3), { sx: 80, sy: 0, width: 480, height: 360 });
  // Fuente más alta → se recorta arriba y abajo.
  assert.deepEqual(centerCropBox(300, 400, 4 / 3), { sx: 0, sy: 88, width: 300, height: 225 });
});

test('the same frame and an exposure-shifted still count as the same framing', () => {
  const frame = sceneGrid();
  // El HDR/tone mapping del fabricante cambia brillo y contraste, no el encuadre.
  const exposed = Float32Array.from(frame, (value) => value * 0.55 + 50);
  assert.ok(normalizedCorrelation(frame, frame) > 0.999);
  assert.ok(normalizedCorrelation(frame, exposed) > 0.99);
  assert.ok(sceneSimilarity(frame, exposed) >= SAME_SCENE_MIN_CORRELATION);
});

test('a couple pixels of hand shake still count as the same framing', () => {
  const frame = sceneGrid();
  const shifted = new Float32Array(frame.length);
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      shifted[y * GRID_WIDTH + x] = frame[y * GRID_WIDTH + Math.max(0, x - 2)];
    }
  }
  assert.ok(sceneSimilarity(frame, shifted) >= SAME_SCENE_MIN_CORRELATION);
});

test('a center-cropped (zoomed) still never matches the previewed frame', () => {
  // Este es el bug reportado: el still de takePhoto() viene recortado y no
  // debe reemplazar al frame que el empleado vio en cámara.
  const frame = sceneGrid();
  for (const factor of [1.15, 1.3]) {
    const score = sceneSimilarity(frame, zoomCenterGrid(frame, GRID_WIDTH, GRID_HEIGHT, factor));
    assert.ok(
      score < SAME_SCENE_MIN_CORRELATION,
      `zoom ${factor}× quedó en ${score.toFixed(3)}, debe quedar bajo ${SAME_SCENE_MIN_CORRELATION}`,
    );
  }
});

test('a different scene stays below the framing threshold', () => {
  const frame = sceneGrid();
  const other = new Float32Array(frame.length);
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      other[y * GRID_WIDTH + x] = (x * 7919 + y * 104729) % 251;
    }
  }
  assert.ok(sceneSimilarity(frame, other) < SAME_SCENE_MIN_CORRELATION);
  assert.equal(sceneSimilarity(null, other), 0);
  assert.equal(sceneSimilarity(frame, new Float32Array(10)), 0);
  assert.equal(normalizedCorrelation([1, 2, 3], [1, 2]), 0);
});
