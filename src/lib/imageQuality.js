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

// Pick the best burst candidate: frames without any warning win first, then the
// sharpest one; ties keep the earliest frame (closest to the shutter press).
export function pickSharpest(candidates) {
  if (!candidates?.length) return null;
  let best = null;
  let bestProblem = true;
  let bestSharpness = -Infinity;
  for (const candidate of candidates) {
    const problem = Boolean(candidate.quality?.issue);
    const sharpness = candidate.quality?.sharpness || 0;
    const better = best === null
      || (bestProblem && !problem)
      || (bestProblem === problem && sharpness > bestSharpness);
    if (better) {
      best = candidate;
      bestProblem = problem;
      bestSharpness = sharpness;
    }
  }
  return best;
}

// --- Puerta de encuadre para la foto de alta resolución ---------------------
// La tira muestra el frame congelado que el empleado acaba de ver. La foto de
// ImageCapture.takePhoto() puede venir con OTRO encuadre (muchos fabricantes
// recortan al centro), así que solo puede reemplazar al frame visto cuando
// demostramos que ambas cubren el mismo campo de visión. ante la duda se
// conserva lo que se vio: la exigencia es «lo que ves es lo que sube», con la
// mejor calidad disponible.
export const SAME_SCENE_MIN_CORRELATION = 0.9;
const SCENE_WIDTH = 64;
const SCENE_HEIGHT = 48;
// Tolerancia a temblor de mano entre el burst y el still.
const SCENE_MAX_OFFSET = 2;

/** Rectángulo centrado para recortar `width × height` a `aspect` (w/h). */
export function centerCropBox(width, height, aspect) {
  const sourceAspect = width / height;
  let cropWidth = width;
  let cropHeight = height;
  if (sourceAspect > aspect) {
    cropWidth = Math.max(1, Math.round(height * aspect));
  } else if (sourceAspect < aspect) {
    cropHeight = Math.max(1, Math.round(width / aspect));
  }
  return {
    sx: Math.round((width - cropWidth) / 2),
    sy: Math.round((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/**
 * Correlación de Pearson entre dos vectores: ~1 cuando la estructura coincide,
 * aunque cambie la exposición o el contraste (HDR, tone mapping del
 * fabricante); cae cuando el contenido está escalado o desplazado — que es
 * exactamente lo que se ve con un still recortado/zoomeado.
 */
export function normalizedCorrelation(a, b) {
  const length = a?.length;
  if (!length || length !== b?.length) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < length; i += 1) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= length;
  meanB /= length;
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < length; i += 1) {
    const deltaA = a[i] - meanA;
    const deltaB = b[i] - meanB;
    numerator += deltaA * deltaB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
  }
  if (varianceA <= 0 || varianceB <= 0) return varianceA <= 0 && varianceB <= 0 ? 1 : 0;
  return numerator / Math.sqrt(varianceA * varianceB);
}

/**
 * Mejor correlación de dos grillas planas permitiendo ±maxOffset px de
 * temblor. Las grillas deben venir con el mismo aspecto ya aplicado.
 */
export function sceneSimilarity(a, b, {
  width = SCENE_WIDTH,
  height = SCENE_HEIGHT,
  maxOffset = SCENE_MAX_OFFSET,
} = {}) {
  if (!a || !b || a.length !== width * height || b.length !== a.length) return 0;
  let best = 0;
  for (let offsetY = -maxOffset; offsetY <= maxOffset; offsetY += 1) {
    for (let offsetX = -maxOffset; offsetX <= maxOffset; offsetX += 1) {
      const fromX = Math.max(0, -offsetX);
      const toX = Math.min(width, width - offsetX);
      const fromY = Math.max(0, -offsetY);
      const toY = Math.min(height, height - offsetY);
      const overlapWidth = toX - fromX;
      const overlapHeight = toY - fromY;
      if (overlapWidth < width * 0.75 || overlapHeight < height * 0.75) continue;
      const sampleA = new Float32Array(overlapWidth * overlapHeight);
      const sampleB = new Float32Array(sampleA.length);
      let index = 0;
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) {
          sampleA[index] = a[y * width + x];
          sampleB[index] = b[(y + offsetY) * width + (x + offsetX)];
          index += 1;
        }
      }
      const score = normalizedCorrelation(sampleA, sampleB);
      if (score > best) best = score;
      if (best >= 1) return best;
    }
  }
  return best;
}

function sceneGrid(source, aspect) {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_WIDTH;
  canvas.height = SCENE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const sourceWidth = source?.width || source?.videoWidth;
  const sourceHeight = source?.height || source?.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;
  const box = centerCropBox(sourceWidth, sourceHeight, aspect);
  context.drawImage(source, box.sx, box.sy, box.width, box.height, 0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  const { data } = context.getImageData(0, 0, SCENE_WIDTH, SCENE_HEIGHT);
  const gray = new Float32Array(SCENE_WIDTH * SCENE_HEIGHT);
  for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
    gray[index] = data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114;
  }
  return gray;
}

export function isSameCapturedScene(first, second) {
  const referenceWidth = first?.width || first?.videoWidth;
  const referenceHeight = first?.height || first?.videoHeight;
  if (!referenceWidth || !referenceHeight) return false;
  // Ambos se recortan al aspecto del frame visto: una diferencia de
  // proporción (16:9 vs 4:3, o un EXIF sin aplicar) ya no se compara mal
  // estirada, y un still con menos campo de visión baja de correlación.
  const aspect = referenceWidth / referenceHeight;
  const before = sceneGrid(first, aspect);
  const after = sceneGrid(second, aspect);
  if (!before || !after) return false;
  return sceneSimilarity(before, after) >= SAME_SCENE_MIN_CORRELATION;
}
