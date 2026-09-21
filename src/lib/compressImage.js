import { canvasToBlob, createDrawCanvas } from './drawCanvas.js';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
export const EVIDENCE_IMAGE_OPTIONS = Object.freeze({
  maxDimension: 2400,
  jpegQuality: 0.9,
  sharpen: true,
});

/** A restrained edge-only sharpening pass; flat areas are left alone to avoid boosting noise. */
export function sharpenImageData(imageData) {
  const { width, height, data } = imageData;
  if (width < 3 || height < 3) return imageData;
  const source = new Uint8ClampedArray(data);
  const stride = width * 4;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * stride + x * 4;
      const left = index - 4;
      const right = index + 4;
      const above = index - stride;
      const below = index + stride;
      const centerLuma = 0.299 * source[index] + 0.587 * source[index + 1] + 0.114 * source[index + 2];
      const neighborRed = source[left] + source[right] + source[above] + source[below];
      const neighborGreen = source[left + 1] + source[right + 1] + source[above + 1] + source[below + 1];
      const neighborBlue = source[left + 2] + source[right + 2] + source[above + 2] + source[below + 2];
      const neighborLuma = (0.299 * neighborRed + 0.587 * neighborGreen + 0.114 * neighborBlue) / 4;
      if (Math.abs(centerLuma - neighborLuma) < 7) continue;

      const red = source[index];
      const green = source[index + 1];
      const blue = source[index + 2];
      data[index] = Math.max(0, Math.min(255, red + 0.45 * (4 * red - neighborRed) / 8));
      data[index + 1] = Math.max(0, Math.min(255, green + 0.45 * (4 * green - neighborGreen) / 8));
      data[index + 2] = Math.max(0, Math.min(255, blue + 0.45 * (4 * blue - neighborBlue) / 8));
    }
  }
  return imageData;
}

export async function compressImage(file, options = {}) {
  if (!file?.type?.startsWith('image/')) {
    throw new Error('El archivo no es una imagen válida.');
  }

  const { maxDimension = MAX_DIMENSION, jpegQuality = JPEG_QUALITY, sharpen = false } = options;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const { width, height } = bitmap;

  let targetWidth = width;
  let targetHeight = height;

  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      targetWidth = maxDimension;
      targetHeight = Math.round((height / width) * maxDimension);
    } else {
      targetHeight = maxDimension;
      targetWidth = Math.round((width / height) * maxDimension);
    }
  }

  try {
    const canvas = createDrawCanvas(targetWidth, targetHeight);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo preparar la compresión.');
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    if (sharpen) {
      try {
        const pixels = context.getImageData(0, 0, targetWidth, targetHeight);
        context.putImageData(sharpenImageData(pixels), 0, 0);
      } catch (error) {
        // Keep the full-resolution image rather than failing an upload on a low-memory phone.
        console.warn('No se pudo aplicar nitidez a la evidencia.', error);
      }
    }
    const blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
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
