import {
  chooseOrderFromOcrTexts,
  inspectOrderFromOcrTexts,
  isConfidentOrderMatch,
} from './orderCode.js';
import {
  buildRecognitionPasses,
  OCR_MAX_SIDE,
  TICKET_TARGET_SIDE,
} from './ocrPlan.js';
import { createDrawCanvas } from './drawCanvas.js';
import { isAbortError, OCR_ENGINE_ERROR, PSM } from './tesseractAssets.js';

const NEIGHBORS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
const OCR_BUDGET_MS = 25_000;

function fail(error) {
  if (error) console.error(error);
  throw new Error(OCR_ENGINE_ERROR);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
}

async function recognizeTexts(source, psm, recognizeOcrData) {
  const { data } = await recognizeOcrData(source, psm);
  const texts = [];
  if (data?.text) texts.push(data.text);
  if (data?.lines?.length) {
    texts.push(data.lines.map((line) => line.text).join('\n'));
    const confident = data.lines
      .filter((line) => (line.confidence || 0) >= 40)
      .map((line) => line.text)
      .join('\n');
    if (confident) texts.push(confident);
  }
  if (data?.words?.length) {
    texts.push(data.words.map((word) => word.text).join(' '));
  }
  return texts.filter((text) => String(text || '').trim());
}

function canvasFromSource(source, maxSide) {
  const sourceWidth = source.width || source.videoWidth;
  const sourceHeight = source.height || source.videoHeight;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight, 1));
  const canvas = createDrawCanvas(
    Math.max(1, Math.round(sourceWidth * scale)),
    Math.max(1, Math.round(sourceHeight * scale)),
  );
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) fail();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cloneCanvas(source) {
  const canvas = createDrawCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) fail();
  context.drawImage(source, 0, 0);
  return canvas;
}

function fastCodeCrop(source, top, height, left = 0.1, relativeWidth = 0.8, requestedScale) {
  const x = Math.round(source.width * left);
  const y = Math.round(source.height * top);
  const width = Math.max(1, Math.round(source.width * relativeWidth));
  const cropHeight = Math.max(1, Math.round(source.height * height));
  const scale = requestedScale || (relativeWidth <= 0.55
    ? 3
    : Math.max(1, Math.min(2.5, 1600 / width)));
  const canvas = createDrawCanvas(Math.round(width * scale), Math.round(cropHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) fail();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, x, y, width, cropHeight, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function fastCodeCropPlan(width, height) {
  const portrait = height >= width;
  if (portrait) {
    return [
      { rotation: 0, top: 0.28, height: 0.1, left: 0.22, width: 0.56, scale: 3 },
      { rotation: 0, top: 0.25, height: 0.15, left: 0.2, width: 0.6, scale: 3 },
      { rotation: 0, top: 0.2, height: 0.17 },
      { rotation: 0, top: 0.12, height: 0.3 },
      { rotation: 180, top: 0.2, height: 0.17 },
    ];
  }
  return [
    { rotation: 270, top: 0.39, height: 0.1, left: 0.105, width: 0.55 },
    { rotation: 270, top: 0.36, height: 0.16, left: 0.105, width: 0.55 },
    { rotation: 270, top: 0.25, height: 0.35 },
    { rotation: 90, top: 0.39, height: 0.1, left: 0.105, width: 0.55 },
    { rotation: 90, top: 0.36, height: 0.16, left: 0.105, width: 0.55 },
    { rotation: 90, top: 0.25, height: 0.35 },
    { rotation: 0, top: 0.2, height: 0.17 },
    { rotation: 0, top: 0.12, height: 0.3 },
    { rotation: 180, top: 0.2, height: 0.17 },
  ];
}

function enhanceInPlace(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) fail();

  const { width, height } = canvas;
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  let min = 255;
  let max = 0;

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
    data[index] = gray;
    data[index + 1] = gray;
    data[index + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  const range = Math.max(1, max - min);
  for (let index = 0; index < data.length; index += 4) {
    const stretched = Math.round(((data[index] - min) / range) * 255);
    data[index] = stretched;
    data[index + 1] = stretched;
    data[index + 2] = stretched;
  }

  context.putImageData(imageData, 0, 0);
}

function otsuThreshold(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 140;

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    hist[data[index]] += 1;
    total += 1;
  }

  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * hist[value];

  let sumB = 0;
  let weightB = 0;
  let max = 0;
  let threshold = 140;
  for (let value = 0; value < 256; value += 1) {
    weightB += hist[value];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += value * hist[value];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) ** 2;
    if (between > max) {
      max = between;
      threshold = value;
    }
  }
  return threshold;
}

function thresholdInPlace(canvas, cutoff) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) fail();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index] >= cutoff ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
}

function invertInPlace(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) fail();
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255 - data[index];
    data[index + 1] = 255 - data[index + 1];
    data[index + 2] = 255 - data[index + 2];
  }
  context.putImageData(imageData, 0, 0);
}

function blockStats(data, width, height, startX, startY, cell) {
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  const endX = Math.min(width, startX + cell);
  const endY = Math.min(height, startY + cell);

  for (let y = startY; y < endY; y += 1) {
    let offset = (y * width + startX) * 4;
    for (let x = startX; x < endX; x += 1) {
      const value = data[offset];
      sum += value;
      sumSq += value * value;
      count += 1;
      offset += 4;
    }
  }

  if (!count) return { mean: 0, variance: 0 };
  const mean = sum / count;
  return { mean, variance: sumSq / count - mean * mean };
}

function cropRegion(source, region, targetSide) {
  const scale = Math.min(4, Math.max(1.35, targetSide / Math.max(region.width, region.height, 1)));
  const canvas = createDrawCanvas(
    Math.max(1, Math.round(region.width * scale)),
    Math.max(1, Math.round(region.height * scale)),
  );
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) fail();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  enhanceInPlace(canvas);
  return canvas;
}

function cropBand(source, { left = 0, top = 0, width = 1, height = 1 }) {
  const region = {
    x: Math.round(source.width * left),
    y: Math.round(source.height * top),
    width: Math.round(source.width * width),
    height: Math.round(source.height * height),
  };
  region.width = Math.min(region.width, source.width - region.x);
  region.height = Math.min(region.height, source.height - region.y);
  if (region.width < 80 || region.height < 80) return null;
  return cropRegion(source, region, TICKET_TARGET_SIDE);
}

function findTicketRegions(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];

  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  const cell = Math.max(14, Math.round(Math.min(width, height) / 48));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const stats = [];
  const hot = new Set();

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const block = blockStats(data, width, height, col * cell, row * cell, cell);
      stats.push({ row, col, ...block });
      if (block.mean > 130 && block.variance > 35) {
        hot.add(row * cols + col);
      }
    }
  }

  const visited = new Set();
  const regions = [];

  for (const block of stats) {
    const start = block.row * cols + block.col;
    if (!hot.has(start) || visited.has(start)) continue;

    const cells = [];
    const stack = [block];
    visited.add(start);

    while (stack.length) {
      const current = stack.pop();
      cells.push(current);
      for (const [deltaRow, deltaCol] of NEIGHBORS) {
        const nextRow = current.row + deltaRow;
        const nextCol = current.col + deltaCol;
        if (nextRow < 0 || nextCol < 0 || nextRow >= rows || nextCol >= cols) continue;
        const key = nextRow * cols + nextCol;
        if (!hot.has(key) || visited.has(key)) continue;
        visited.add(key);
        stack.push(stats[key]);
      }
    }

    if (cells.length < 4) continue;

    let minRow = Infinity;
    let minCol = Infinity;
    let maxRow = 0;
    let maxCol = 0;
    let varianceSum = 0;
    for (const cellBlock of cells) {
      minRow = Math.min(minRow, cellBlock.row);
      minCol = Math.min(minCol, cellBlock.col);
      maxRow = Math.max(maxRow, cellBlock.row);
      maxCol = Math.max(maxCol, cellBlock.col);
      varianceSum += cellBlock.variance;
    }

    minRow = Math.max(0, minRow - 1);
    minCol = Math.max(0, minCol - 1);
    maxRow = Math.min(rows - 1, maxRow + 1);
    maxCol = Math.min(cols - 1, maxCol + 1);

    const x = minCol * cell;
    const y = minRow * cell;
    const regionWidth = Math.min(width - x, (maxCol - minCol + 1) * cell);
    const regionHeight = Math.min(height - y, (maxRow - minRow + 1) * cell);
    const areaRatio = (regionWidth * regionHeight) / (width * height);
    const aspect = regionWidth / Math.max(regionHeight, 1);

    if (regionWidth < 70 || regionHeight < 70) continue;
    if (areaRatio < 0.015 || areaRatio > 0.8) continue;
    if (aspect > 3.6 || aspect < 0.16) continue;

    regions.push({
      x,
      y,
      width: regionWidth,
      height: regionHeight,
      score: cells.length * (varianceSum / cells.length),
    });
  }

  return regions.sort((left, right) => right.score - left.score).slice(0, 2);
}

function rotatedCanvas(source, rotation) {
  if (!rotation) return source;

  const swapped = rotation === 90 || rotation === 270;
  const canvas = createDrawCanvas(
    swapped ? source.height : source.width,
    swapped ? source.width : source.height,
  );
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) fail();

  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }

  context.drawImage(source, 0, 0);
  return canvas;
}

function prepareTicketViews(bitmap) {
  const original = canvasFromSource(bitmap, OCR_MAX_SIDE);
  const enhancedFull = cloneCanvas(original);
  enhanceInPlace(enhancedFull);

  const regionCrops = findTicketRegions(enhancedFull).map((region) =>
    cropRegion(original, region, TICKET_TARGET_SIDE),
  );
  const extraBands = [
    cropBand(original, { height: 0.4 }),
    cropBand(original, { top: 0.04, left: 0.04, width: 0.92, height: 0.32 }),
  ].filter(Boolean);

  return { enhancedFull, regionCrops, extraBands };
}

function applyPassVariants(sources, variants) {
  const out = [];
  if (variants.includes('plain')) out.push(...sources);
  if (variants.includes('binary')) {
    for (const source of sources) {
      const binary = cloneCanvas(source);
      thresholdInPlace(binary, otsuThreshold(binary));
      out.push(binary);
    }
  }
  if (variants.includes('invert')) {
    for (const source of sources) {
      const inverted = cloneCanvas(source);
      invertInPlace(inverted);
      out.push(inverted);
    }
  }
  return out;
}

async function collectGroup({ sources, rotations, psms, variants }, texts, signal, recognizeOcrData, deadline) {
  const prepared = applyPassVariants(sources, variants || ['plain']);
  for (const psm of psms) {
    for (const rotation of rotations) {
      for (const source of prepared) {
        if (Date.now() >= deadline) return false;
        throwIfAborted(signal);
        let found;
        try {
          found = await recognizeTexts(rotatedCanvas(source, rotation), psm, recognizeOcrData);
        } catch (error) {
          if (isAbortError(error)) throw error;
          fail(error);
        }
        texts.push(...found);
      }
    }
  }
  return true;
}

async function readFastCode(bitmap, recognizeOcrData, signal, deadline) {
  const frame = canvasFromSource(bitmap, OCR_MAX_SIDE);
  const votes = new Map();
  for (const { rotation, top, height, left, width, scale } of fastCodeCropPlan(frame.width, frame.height)) {
    if (Date.now() >= deadline) return null;
    throwIfAborted(signal);
    let found;
    try {
      found = await recognizeTexts(
        fastCodeCrop(rotatedCanvas(frame, rotation), top, height, left, width, scale),
        PSM.SINGLE_BLOCK,
        recognizeOcrData,
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      fail(error);
    }
    const inspection = inspectOrderFromOcrTexts(found);
    if (!inspection?.order) continue;
    const key = inspection.order.displayCode.replace(/[^A-Z0-9]/g, '');
    const count = (votes.get(key)?.count || 0) + 1;
    votes.set(key, { order: inspection.order, count });
    if (count >= 2) return inspection.order;
  }
  return null;
}

async function readBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

async function readOrderFromFile(file, { thorough = true, signal, recognizeOcrData, deadline } = {}) {
  throwIfAborted(signal);
  let bitmap;
  try {
    bitmap = await readBitmap(file);
  } catch (error) {
    fail(error);
  }

  try {
    const fast = await readFastCode(bitmap, recognizeOcrData, signal, deadline);
    if (fast) return fast;
    if (Date.now() >= deadline) return null;

    const texts = [];
    const views = prepareTicketViews(bitmap);
    const passes = buildRecognitionPasses({ ...views, PSM, thorough });

    for (const pass of passes) {
      const completed = await collectGroup(pass, texts, signal, recognizeOcrData, deadline);
      const inspection = inspectOrderFromOcrTexts(texts);
      if (isConfidentOrderMatch(inspection)) return inspection.order;
      if (!completed) return null;
    }

    return chooseOrderFromOcrTexts(texts);
  } finally {
    bitmap.close();
  }
}

/** The same OCR plan runs in the page and in the service worker. */
export function createOrderDetector(recognizeOcrData) {
  return async function detectOrderFromPhoto(file, options = {}) {
    if (!file) fail();
    throwIfAborted(options.signal);

    const deadline = Date.now() + OCR_BUDGET_MS;
    const found = await readOrderFromFile(file, {
      thorough: true,
      signal: options.signal,
      recognizeOcrData,
      deadline,
    });
    if (found) return found;

    for (const extra of options.fallbackFiles || []) {
      if (!extra || extra === file) continue;
      const fallback = await readOrderFromFile(extra, {
        thorough: false,
        signal: options.signal,
        recognizeOcrData,
        deadline,
      });
      if (fallback) return fallback;
    }

    return null;
  };
}
