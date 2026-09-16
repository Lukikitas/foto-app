import { detectOrderCode } from './orderCode.js';
import { loadTesseract, OCR_ENGINE_ERROR, tessAssetUrl } from './tesseract';

const OCR_MAX_SIDE = 2400;
const TICKET_TARGET_SIDE = 2200;
const CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:- ';

let workerPromise = null;

function fail(error) {
  if (error) console.error(error);
  throw new Error(OCR_ENGINE_ERROR);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await loadTesseract();
      const worker = await createWorker('eng', 1, {
        workerPath: tessAssetUrl('worker.min.js'),
        corePath: tessAssetUrl('core'),
        langPath: tessAssetUrl('lang'),
        gzip: true,
        errorHandler: (error) => console.error(error),
      });
      await worker.setParameters({
        tessedit_char_whitelist: CHAR_WHITELIST,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
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

function findTextRegion(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  const cell = Math.max(16, Math.round(Math.min(width, height) / 40));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const blocks = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      blocks.push({
        row,
        col,
        ...blockStats(data, width, height, col * cell, row * cell, cell),
      });
    }
  }

  const paper = blocks.filter((block) => block.mean > 140 && block.variance > 80);
  const candidates = paper.length >= 6
    ? paper
    : blocks.filter((block) => block.variance > 150);

  if (candidates.length < 4) return null;

  const variances = candidates.map((block) => block.variance).sort((a, b) => a - b);
  const cutoff = variances[Math.floor(variances.length * 0.35)] || 0;
  const hot = candidates.filter((block) => block.variance >= cutoff);
  if (hot.length < 4) return null;

  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = 0;
  let maxCol = 0;
  for (const block of hot) {
    minRow = Math.min(minRow, block.row);
    minCol = Math.min(minCol, block.col);
    maxRow = Math.max(maxRow, block.row);
    maxCol = Math.max(maxCol, block.col);
  }

  minRow = Math.max(0, minRow - 1);
  minCol = Math.max(0, minCol - 1);
  maxRow = Math.min(rows - 1, maxRow + 1);
  maxCol = Math.min(cols - 1, maxCol + 1);

  const x = minCol * cell;
  const y = minRow * cell;
  const regionWidth = Math.min(width - x, (maxCol - minCol + 1) * cell);
  const regionHeight = Math.min(height - y, (maxRow - minRow + 1) * cell);

  if (regionWidth < 60 || regionHeight < 60) return null;
  if (regionWidth * regionHeight > width * height * 0.88) return null;

  return { x, y, width: regionWidth, height: regionHeight };
}

function cropRegion(source, region, targetSide) {
  const scale = Math.min(3, Math.max(1.2, targetSide / Math.max(region.width, region.height)));
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

/** Reads a captured order image outside the camera flow. */
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
    const full = canvasFromSource(bitmap, OCR_MAX_SIDE);
    enhanceInPlace(full);
    const region = findTextRegion(full);
    const ticket = region ? cropRegion(full, region, TICKET_TARGET_SIDE) : null;
    const sources = ticket ? [ticket, full] : [full];

    for (const psm of [PSM.SPARSE_TEXT, PSM.AUTO]) {
      for (const rotation of [0, 180, 90, 270]) {
        for (const source of sources) {
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
  } finally {
    bitmap.close();
  }
}
