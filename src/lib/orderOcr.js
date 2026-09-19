import {
  chooseOrderFromOcrTexts,
  inspectOrderFromOcrTexts,
  isConfidentOrderMatch,
} from './orderCode.js';
import { loadTesseract, OCR_ENGINE_ERROR, tessAssetUrl } from './tesseract';

const OCR_MAX_SIDE = 2800;
const TICKET_TARGET_SIDE = 2600;
const OCR_CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-: ';
const NEIGHBORS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

let workerPromise = null;

function fail(error) {
  if (error) console.error(error);
  throw new Error(OCR_ENGINE_ERROR);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await loadTesseract();
      const options = {
        workerPath: tessAssetUrl('worker.min.js'),
        corePath: tessAssetUrl('core'),
        langPath: tessAssetUrl('lang'),
        gzip: true,
        errorHandler: (error) => console.error(error),
      };
      let worker;
      try {
        worker = await createWorker('spa+eng', 1, options);
      } catch (error) {
        console.error(error);
        worker = await createWorker('eng', 1, options);
      }
      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
        tessedit_char_whitelist: OCR_CHAR_WHITELIST,
        tessedit_pageseg_mode: PSM.AUTO,
      });
      return { worker, PSM };
    })().catch((error) => {
      workerPromise = null;
      fail(error);
    });
  }

  return workerPromise;
}

async function recognizeTexts(worker, source, psm) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  });
  const { data } = await worker.recognize(source);
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
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) fail();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cloneCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) fail();
  context.drawImage(source, 0, 0);
  return canvas;
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
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
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

  return regions.sort((left, right) => right.score - left.score).slice(0, 5);
}

function rotatedCanvas(source, rotation) {
  if (!rotation) return source;

  const canvas = document.createElement('canvas');
  const swapped = rotation === 90 || rotation === 270;
  canvas.width = swapped ? source.height : source.width;
  canvas.height = swapped ? source.width : source.height;
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

function prepareCanvases(bitmap) {
  const original = canvasFromSource(bitmap, OCR_MAX_SIDE);
  const enhancedFull = cloneCanvas(original);
  enhanceInPlace(enhancedFull);

  const canvases = [enhancedFull];
  for (const region of findTicketRegions(enhancedFull)) {
    canvases.push(cropRegion(original, region, TICKET_TARGET_SIDE));
  }

  const bands = [
    { height: 0.4 },
    { height: 0.55 },
    { left: 0.06, width: 0.88, height: 0.46 },
    { top: 0.06, left: 0.04, width: 0.92, height: 0.3 },
  ];
  for (const band of bands) {
    const cropped = cropBand(original, band);
    if (cropped) canvases.push(cropped);
  }

  return canvases;
}

function withVariants(canvases) {
  const variants = [...canvases];

  for (const canvas of canvases.slice(0, 5)) {
    const binary = cloneCanvas(canvas);
    thresholdInPlace(binary, otsuThreshold(binary));
    variants.push(binary);
  }

  for (const canvas of canvases.slice(0, 2)) {
    const inverted = cloneCanvas(canvas);
    invertInPlace(inverted);
    variants.push(inverted);
  }

  return variants;
}

async function collectGroup(worker, { sources, rotations, psms }, texts) {
  for (const psm of psms) {
    for (const rotation of rotations) {
      for (const source of sources) {
        let found;
        try {
          found = await recognizeTexts(worker, rotatedCanvas(source, rotation), psm);
        } catch (error) {
          fail(error);
        }
        texts.push(...found);
      }
    }
  }
}

async function readBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

async function readOrderFromFile(worker, PSM, file) {
  let bitmap;
  try {
    bitmap = await readBitmap(file);
  } catch (error) {
    fail(error);
  }

  try {
    const texts = [];
    const canvases = prepareCanvases(bitmap);
    const variants = withVariants(canvases);

    const groups = [
      {
        sources: variants.slice(0, 8),
        rotations: [0],
        psms: [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT],
      },
      {
        sources: variants.slice(0, 6),
        rotations: [0],
        psms: [PSM.SINGLE_LINE, PSM.AUTO],
      },
      {
        sources: canvases.slice(0, 4),
        rotations: [180],
        psms: [PSM.SINGLE_BLOCK, PSM.AUTO],
      },
      {
        sources: canvases.slice(0, 2),
        rotations: [90, 270],
        psms: [PSM.AUTO],
      },
    ];

    for (const group of groups) {
      await collectGroup(worker, group, texts);
      const inspection = inspectOrderFromOcrTexts(texts);
      if (isConfidentOrderMatch(inspection)) return inspection.order;
    }

    return chooseOrderFromOcrTexts(texts);
  } finally {
    bitmap.close();
  }
}

/** Reads a ticket close-up. Never used on the live camera feed. */
export async function detectOrderFromPhoto(file, options = {}) {
  if (!file) fail();

  const { worker, PSM } = await getWorker();
  const found = await readOrderFromFile(worker, PSM, file);
  if (found) return found;

  for (const extra of options.fallbackFiles || []) {
    if (!extra || extra === file) continue;
    const fallback = await readOrderFromFile(worker, PSM, extra);
    if (fallback) return fallback;
  }

  return null;
}
