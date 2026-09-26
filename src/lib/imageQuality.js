// A deliberately cheap capture check. It only warns; it never rejects a photo.
export function scoreImageQuality({ width, height, data }, { ticket = false } = {}) {
  if (!width || !height || !data?.length) return { issue: null, sharpness: 0 };
  const gray = new Float32Array(width * height);
  let brightness = 0;
  let brightBorder = 0;
  let borderCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const value = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      gray[y * width + x] = value;
      brightness += value;
      if (x < width * 0.025 || x >= width * 0.975 || y < height * 0.025 || y >= height * 0.975) {
        borderCount += 1;
        if (value > 205) brightBorder += 1;
      }
    }
  }
  brightness /= width * height;
  let edgeEnergy = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = y * width + x;
      const laplacian = 4 * gray[index] - gray[index - 1] - gray[index + 1]
        - gray[index - width] - gray[index + width];
      edgeEnergy += laplacian * laplacian;
      count += 1;
    }
  }
  const sharpness = count ? edgeEnergy / count : 0;
  const issue = brightness < 52 ? 'dark'
    : sharpness < 90 ? 'blurry'
      : ticket && brightBorder / Math.max(borderCount, 1) > 0.23 ? 'cropped' : null;
  return { issue, sharpness, brightness };
}

export function inspectCaptureCanvas(source, { ticket = false } = {}) {
  const sample = document.createElement('canvas');
  sample.width = 160;
  sample.height = 120;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) return { issue: null, sharpness: 0 };
  context.drawImage(source, 0, 0, sample.width, sample.height);
  return scoreImageQuality(context.getImageData(0, 0, sample.width, sample.height), { ticket });
}

export function isSameCapturedScene(first, second) {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 36;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(first, 0, 0, canvas.width, canvas.height);
  const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
  context.drawImage(second, 0, 0, canvas.width, canvas.height);
  const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let difference = 0;
  for (let i = 0; i < before.length; i += 4) {
    difference += Math.abs(before[i] - after[i]);
    difference += Math.abs(before[i + 1] - after[i + 1]);
    difference += Math.abs(before[i + 2] - after[i + 2]);
  }
  return difference / (canvas.width * canvas.height * 3) < 35;
}
