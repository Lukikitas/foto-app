import { detectOrderCode } from './orderCode.js';
import { loadTesseract, OCR_ENGINE_ERROR, tessAssetUrl } from './tesseract';

const OCR_MAX_SIDE = 2560;
const TICKET_TARGET_SIDE = 2400;
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

async function recognizeOrder(worker, source, psm) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
  });
  const {
    data: { text },
  } = await worker.recognize(source);
  return detectOrderCode(text);
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
      if (block.mean > 145 && block.variance > 45) {
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

    if (cells.length < 5) continue;

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
    if (areaRatio < 0.02 || areaRatio > 0.72) continue;
    if (aspect > 3.2 || aspect < 0.18) continue;

    regions.push({
      x,
      y,
      width: regionWidth,
      height: regionHeight,
      score: cells.length * (varianceSum / cells.length),
    });
  }

  return regions.sort((left, right) => right.score - left.score).slice(0, 3);
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
  const canvases = [original];

  for (const region of findTicketRegions(original)) {
    canvases.push(cropRegion(original, region, TICKET_TARGET_SIDE));
  }

  const topHalf = cropBand(original, { height: 0.52 });
  if (topHalf) canvases.push(topHalf);

  return canvases;
}

async function recognizeSources(worker, PSM, canvases, rotations, psms) {
  for (const psm of psms) {
    for (const rotation of rotations) {
      for (const source of canvases) {
        let order;
        try {
          order = await recognizeOrder(worker, rotatedCanvas(source, rotation), psm);
        } catch (error) {
          fail(error);
        }
        if (order) return order;
      }
    }
  }
  return null;
}

/** Reads a ticket close-up. Never used on the live camera feed. */
export async function detectOrderFromPhoto(file) {
  if (!file) fail();

  const { worker, PSM } = await getWorker();
  let bitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    fail(error);
  }

  try {
    const canvases = prepareCanvases(bitmap);

    const found = await recognizeSources(
      worker,
      PSM,
      canvases.slice(0, 4),
      [0],
      [PSM.SINGLE_BLOCK, PSM.AUTO],
    );
    if (found) return found;

    const sparse = await recognizeSources(worker, PSM, [canvases[0]], [0], [PSM.SPARSE_TEXT]);
    if (sparse) return sparse;

    return recognizeSources(
      worker,
      PSM,
      canvases.slice(0, 2),
      [180, 90, 270],
      [PSM.AUTO],
    );
  } finally {
    bitmap.close();
  }
}
