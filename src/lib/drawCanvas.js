export function createDrawCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }

  throw new Error('No se pudo preparar la imagen.');
}

export async function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.8) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }

  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('No se pudo comprimir la imagen.'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo comprimir la imagen.'));
    }, type, quality);
  });
}
