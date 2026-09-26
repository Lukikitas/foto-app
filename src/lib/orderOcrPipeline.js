import {
  chooseOrderFromOcrTexts,
  inspectOrderFromOcrTexts,
  isConfidentOrderMatch,
  isCompleteOrderCode,
} from './orderCode.js';
import {
  buildEvidencePasses,
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

function brightPaperColumns(source, top, height) {
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const y = Math.floor(source.height * top);
  const bandHeight = Math.min(source.height - y, Math.max(1, Math.floor(source.height * height)));
  const { data } = context.getImageData(0, y, source.width, bandHeight);
  let start = -1;
  let best = { start: 0, length: 0 };
  for (let x = 0; x <= source.width; x += 1) {
    let bright = 0;
    let samples = 0;
    if (x < source.width) {
      for (let row = 0; row < bandHeight; row += 4) {
        const index = (row * source.width + x) * 4;
        const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
        if (luminance > 160) bright += 1;
        samples += 1;
      }
    }
    const paper = x < source.width && bright / Math.max(1, samples) > 0.48;
    if (paper && start < 0) start = x;
    if (!paper && start >= 0) {
      if (x - start > best.length) best = { start, length: x - start };
      start = -1;
    }
  }
  if (best.length < source.width * 0.2) return null;
  const margin = Math.round(source.width * 0.025);
  const left = Math.max(0, best.start - margin);
  const right = Math.min(source.width, best.start + best.length + margin);
  return { left: left / source.width, width: (right - left) / source.width };
}

export function fastCodeCropPlan(width, height) {
  const portrait = height >= width;
  if (portrait) {
    return [
      { rotation: 0, top: 0.28, height: 0.1, left: 0.22, width: 0.56, scale: 3 },
      { rotation: 0, top: 0.25, height: 0.15, left: 0.2, width: 0.6, scale: 3 },
      { rotation: 90, top: 0.12, height: 0.38 },
      { rotation: 270, top: 0.12, height: 0.38 },
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

function adaptiveThresholdInPlace(canvas, radius = 14, delta = 8) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const { width, height } = canvas;
  if (width <= 0 || height <= 0) return;
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;

  // Compute grayscale and 32-bit Integral Image
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const srcRow = y * width * 4;
    const intRow = (y + 1) * stride;
    const prevIntRow = y * stride;

    for (let x = 0; x < width; x += 1) {
      const srcIdx = srcRow + x * 4;
      const gray = Math.round(0.299 * data[srcIdx] + 0.587 * data[srcIdx + 1] + 0.114 * data[srcIdx + 2]);
      data[srcIdx] = gray;
      rowSum += gray;
      integral[intRow + (x + 1)] = integral[prevIntRow + (x + 1)] + rowSum;
    }
  }

  // Threshold each pixel against its local window average
  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height, y + radius + 1);
    const countY = y2 - y1;
    const rowOffset = y * width * 4;

    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width, x + radius + 1);
      const count = (x2 - x1) * countY;

      const sum =
        integral[y2 * stride + x2] -
        integral[y1 * stride + x2] -
        integral[y2 * stride + x1] +
        integral[y1 * stride + x1];

      const avg = sum / count;
      const gray = data[rowOffset + x * 4];
      const val = gray <= avg - delta ? 0 : 255;

      const idx = rowOffset + x * 4;
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
    }
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

function prepareTicketViews(bitmap, { evidence = false } = {}) {
  const original = canvasFromSource(bitmap, evidence ? 2600 : OCR_MAX_SIDE);
  const enhancedFull = cloneCanvas(original);
  enhanceInPlace(enhancedFull);

  const regionCrops = findTicketRegions(enhancedFull).map((region) =>
    cropRegion(original, region, TICKET_TARGET_SIDE),
  );
  const extraBands = evidence ? [] : [
    cropBand(original, { height: 0.4 }),
    cropBand(original, { top: 0.04, left: 0.04, width: 0.92, height: 0.32 }),
  ].filter(Boolean);

  const evidenceCrops = evidence
    ? [
      cropBand(original, { left: 0.5, top: 0.15, width: 0.5, height: 0.75 }),
      cropBand(original, { left: 0.25, top: 0.15, width: 0.55, height: 0.75 }),
      cropBand(original, { left: 0, top: 0.15, width: 0.55, height: 0.75 }),
    ].filter(Boolean)
    : [];
  return { enhancedFull, regionCrops, extraBands, evidenceCrops };
}

function applyPassVariants(sources, variants) {
  const out = [];
  if (variants.includes('plain')) out.push(...sources);
  if (variants.includes('adaptive')) {
    for (const source of sources) {
      const adaptive = cloneCanvas(source);
      adaptiveThresholdInPlace(adaptive);
      out.push(adaptive);
    }
  }
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

function isInstantFastMatch(inspection) {
  return isCompleteOrderCode(inspection?.order) && inspection.labeled > 0;
}

async function readFastCode(bitmap, recognizeOcrData, signal, deadline) {
  const frame = canvasFromSource(bitmap, OCR_MAX_SIDE);
  const votes = new Map();
  for (const { rotation, top, height, left, width, scale } of fastCodeCropPlan(frame.width, frame.height)) {
    if (Date.now() >= deadline) return null;
    throwIfAborted(signal);
    const crop = fastCodeCrop(rotatedCanvas(frame, rotation), top, height, left, width, scale);
    let found;
    try {
      found = await recognizeTexts(crop, PSM.SINGLE_BLOCK, recognizeOcrData);
    } catch (error) {
      if (isAbortError(error)) throw error;
      fail(error);
    }
    let inspection = inspectOrderFromOcrTexts(found);

    // If plain crop didn't find a code, try adaptive threshold on this crop
    if (!inspection?.order) {
      adaptiveThresholdInPlace(crop);
      try {
        const adaptiveFound = await recognizeTexts(crop, PSM.SINGLE_BLOCK, recognizeOcrData);
        inspection = inspectOrderFromOcrTexts(adaptiveFound);
      } catch (error) {
        if (isAbortError(error)) throw error;
      }
    }

    if (!inspection?.order) continue;

    // Early exit if confident match
    if (isInstantFastMatch(inspection)) {
      return inspection.order;
    }

    const key = inspection.order.displayCode.replace(/[^A-Z0-9]/g, '');
    const count = (votes.get(key)?.count || 0) + 1;
    votes.set(key, { order: inspection.order, count });
    if (count >= 2 && isCompleteOrderCode(inspection.order)) return inspection.order;
  }
  return null;
}

async function readEvidenceEdgeCodes(views, recognizeOcrData, signal, deadline) {
  const votes = new Map();
  let weak = null;
  const sources = [
    { canvas: views.evidenceCrops[0], crop: { left: 0.5, top: 0.15, width: 0.5, height: 0.75 } },
    { canvas: views.regionCrops[0], crop: null },
    { canvas: views.enhancedFull, crop: null },
  ].filter((source) => source.canvas);
  for (const source of sources) {
    for (const rotation of [90, 270]) {
      const rotated = rotatedCanvas(source.canvas, rotation);
      for (const top of [0, 0.82]) {
        if (Date.now() >= deadline) return { strong: null, weak };
        throwIfAborted(signal);
        const columns = brightPaperColumns(rotated, top, 0.18);
        if (!columns) continue;
        const crop = fastCodeCrop(rotated, top, 0.18, columns.left, columns.width, 2.5);
        const seenInCrop = new Set();
        for (const variant of ['plain', 'adaptive']) {
          if (Date.now() >= deadline) return { strong: null, weak };
          if (variant === 'adaptive') adaptiveThresholdInPlace(crop);
          const found = await recognizeTexts(crop, PSM.SPARSE_TEXT, recognizeOcrData);
          const inspection = inspectOrderFromOcrTexts(found);
          if (!inspection?.order) continue;
          if (!weak || isCompleteOrderCode(inspection.order)) weak = inspection.order;
          if (!isCompleteOrderCode(inspection.order)) continue;
          const order = { ...inspection.order, preview: { rotation, crop: source.crop } };
          if (inspection.labeled) return { strong: order, weak };
          const key = inspection.order.displayCode.replace(/[^A-Z0-9]/g, '');
          if (seenInCrop.has(key)) continue;
          seenInCrop.add(key);
          const count = (votes.get(key) || 0) + 1;
          votes.set(key, count);
          if (count >= 2) return { strong: order, weak };
        }
      }
    }
  }
  return { strong: null, weak };
}

async function readBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

export function isCompleteEvidenceCode(inspection) {
  return Boolean(inspection?.labeled && isCompleteOrderCode(inspection.order));
}

async function readOrderFromFile(file, { thorough = true, evidence = false, requireStrong = false, signal, recognizeOcrData, deadline } = {}) {
  throwIfAborted(signal);
  let bitmap;
  try {
    bitmap = await readBitmap(file);
  } catch (error) {
    fail(error);
  }

  try {
    if (!evidence) {
      const fast = await readFastCode(bitmap, recognizeOcrData, signal, deadline);
      if (fast) return fast;
      if (Date.now() >= deadline) return null;
    }

    const texts = [];
    const views = prepareTicketViews(bitmap, { evidence });
    const edge = evidence
      ? await readEvidenceEdgeCodes(views, recognizeOcrData, signal, deadline)
      : null;
    if (edge?.strong) return edge.strong;
    const passes = evidence
      ? buildEvidencePasses({ ...views, PSM })
      : buildRecognitionPasses({ ...views, PSM, thorough });

    for (const pass of passes) {
      const completed = await collectGroup(pass, texts, signal, recognizeOcrData, deadline);
      const inspection = inspectOrderFromOcrTexts(texts);
      if (isCompleteEvidenceCode(inspection) || (!requireStrong && !evidence && isConfidentOrderMatch(inspection))) {
        return inspection.order;
      }
      if (!completed) return evidence && !requireStrong ? chooseOrderFromOcrTexts(texts) || edge?.weak : null;
    }

    return requireStrong ? null : chooseOrderFromOcrTexts(texts) || edge?.weak;
  } finally {
    bitmap.close();
  }
}

/** The same OCR plan runs in the page and in the service worker. */
export function createOrderDetector(recognizeOcrData) {
  return async function detectOrderFromPhoto(file, options = {}) {
    if (!file) fail();
    throwIfAborted(options.signal);

    const fallbackFiles = (options.fallbackFiles || []).filter((extra) => extra && extra !== file);
    const deadline = Date.now() + (options.budgetMs || OCR_BUDGET_MS);
    let found;
    try {
      found = await readOrderFromFile(file, {
        thorough: true,
        evidence: Boolean(options.evidence),
        requireStrong: Boolean(options.requireStrong),
        signal: options.signal,
        recognizeOcrData,
        deadline,
      });
    } catch (error) {
      if (isAbortError(error) || !fallbackFiles.length) throw error;
    }
    if (found) return found;

    for (const extra of fallbackFiles) {
      const fallback = await readOrderFromFile(extra, {
        thorough: false,
        evidence: true,
        requireStrong: true,
        signal: options.signal,
        recognizeOcrData,
        deadline: Date.now() + (options.fallbackBudgetMs || 25_000),
      });
      if (fallback) return fallback;
    }

    return null;
  };
}
