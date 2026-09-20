import { canvasToBlob, createDrawCanvas } from './drawCanvas.js';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

export async function compressImage(file) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('El archivo no es una imagen válida.');
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let targetWidth = width;
  let targetHeight = height;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width >= height) {
      targetWidth = MAX_DIMENSION;
      targetHeight = Math.round((height / width) * MAX_DIMENSION);
    } else {
      targetHeight = MAX_DIMENSION;
      targetWidth = Math.round((width / height) * MAX_DIMENSION);
    }
  }

  try {
    const canvas = createDrawCanvas(targetWidth, targetHeight);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo preparar la compresión.');
    }

    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'foto';
    if (typeof File === 'function') {
      return new File([blob], `${baseName}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    }
    return blob;
  } finally {
    bitmap.close();
  }
}
