import { detectOrderCode } from './orderCode';
import { loadTesseract } from './tesseract';

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = await loadTesseract();
      if (!Tesseract?.createWorker) {
        throw new Error('No se pudo iniciar el lector del ticket.');
      }
      return Tesseract.createWorker('eng');
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

async function recognizeOrder(worker, source) {
  const {
    data: { text },
  } = await worker.recognize(source);
  return detectOrderCode(text);
}

function rotatedCanvas(bitmap, rotation) {
  const canvas = document.createElement('canvas');
  const isRotated = rotation === 90 || rotation === 270;
  canvas.width = isRotated ? bitmap.height : bitmap.width;
  canvas.height = isRotated ? bitmap.width : bitmap.height;
  const context = canvas.getContext('2d', { alpha: false });

  if (!context) throw new Error('No se pudo preparar la lectura del ticket.');

  if (rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 270) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  }

  context.drawImage(bitmap, 0, 0);
  return canvas;
}

/** Reads a captured order image outside the camera flow. */
export async function detectOrderFromPhoto(file) {
  const worker = await getWorker();
  let order = await recognizeOrder(worker, file);
  if (order) return order;

  const bitmap = await createImageBitmap(file);
  try {
    for (const rotation of [90, 270]) {
      order = await recognizeOrder(worker, rotatedCanvas(bitmap, rotation));
      if (order) return order;
    }
  } finally {
    bitmap.close();
  }

  return null;
}
