import { canvasToBlob, createDrawCanvas } from './drawCanvas.js';
import { OCR_CHAR_WHITELIST, OCR_ENGINE_ERROR, tessAssetUrl } from './tesseractAssets.js';

let modulePromise = null;
let api = null;

function supportsSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch {
    return false;
  }
}

async function gunzip(bytes) {
  if (bytes[0] === 31 && bytes[1] === 139) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

async function loadClassicScript(url) {
  if (typeof globalThis.importScripts === 'function') {
    try { globalThis.importScripts(url); return; }
    catch (error) { if (!(error instanceof TypeError)) throw error; } // Module workers expose importScripts but forbid calling it.
  }

  const source = await (await fetch(url)).text();
  const run = new Function(source + '\n;return typeof TesseractCore === "function" ? TesseractCore : null;');
  const factory=run();
  if(factory)globalThis.TesseractCore=factory;
}

function coreFactory() {
  return globalThis.TesseractCore;
}

async function loadLanguageData(TessModule, lang) {
  const response = await fetch(tessAssetUrl(`lang/${lang}.traineddata.gz`));
  if (!response.ok) throw new Error(OCR_ENGINE_ERROR);
  const data = await gunzip(new Uint8Array(await response.arrayBuffer()));
  TessModule.FS.writeFile(`${lang}.traineddata`, data);
}

async function getModule() {
  if (modulePromise) return modulePromise;

  modulePromise = (async () => {
    const file = supportsSimd()
      ? 'tesseract-core-simd-lstm.wasm.js'
      : 'tesseract-core-lstm.wasm.js';
    if (!coreFactory()) {
      await loadClassicScript(tessAssetUrl(`core/${file}`));
    }
    const factory = coreFactory();
    if (!factory) throw new Error(OCR_ENGINE_ERROR);

    const TessModule = await factory({
      locateFile: (path) => tessAssetUrl(`core/${path}`),
    });

    try {
      await loadLanguageData(TessModule, 'spa');
      await loadLanguageData(TessModule, 'eng');
    } catch (error) {
      console.error(error);
      await loadLanguageData(TessModule, 'eng');
    }

    api = new TessModule.TessBaseAPI();
    let status = api.Init(null, 'spa+eng', 1);
    if (status === -1) {
      api.End();
      api = new TessModule.TessBaseAPI();
      status = api.Init(null, 'eng', 1);
    }
    if (status === -1) throw new Error(OCR_ENGINE_ERROR);
    return TessModule;
  })().catch((error) => {
    modulePromise = null;
    api = null;
    throw error;
  });

  return modulePromise;
}

function canvasToBmpBytes(canvas) {
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const width = canvas.width;
    const height = canvas.height;
    if (width <= 0 || height <= 0) return null;
    const imgData = context.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 24-bit BMP row stride aligned to 4 bytes
    const rowStride = (width * 3 + 3) & ~3;
    const imageSize = rowStride * height;
    const fileSize = 54 + imageSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // BMP Header (14 bytes)
    view.setUint16(0, 0x4d42, true); // 'BM'
    view.setUint32(2, fileSize, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint32(10, 54, true); // offset to pixels

    // DIB Header (BITMAPINFOHEADER, 40 bytes)
    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, -height, true); // top-down
    view.setUint16(26, 1, true); // planes
    view.setUint16(28, 24, true); // 24 bpp (BGR)
    view.setUint32(30, 0, true); // uncompressed
    view.setUint32(34, imageSize, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    view.setUint32(46, 0, true);
    view.setUint32(50, 0, true);

    let dst = 54;
    for (let y = 0; y < height; y++) {
      let src = y * width * 4;
      const rowEnd = dst + width * 3;
      while (dst < rowEnd) {
        bytes[dst] = data[src + 2];     // B
        bytes[dst + 1] = data[src + 1]; // G
        bytes[dst + 2] = data[src];     // R
        dst += 3;
        src += 4;
      }
      while (dst % 4 !== 0) {
        bytes[dst++] = 0;
      }
    }
    return bytes;
  } catch {
    return null;
  }
}

async function sourceToBytes(source) {
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());

  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    const canvas = createDrawCanvas(source.width, source.height);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error(OCR_ENGINE_ERROR);
    context.drawImage(source, 0, 0);
    const bmp = canvasToBmpBytes(canvas);
    if (bmp) return bmp;
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    return new Uint8Array(await blob.arrayBuffer());
  }

  if (source && typeof source.getContext === 'function') {
    const bmp = canvasToBmpBytes(source);
    if (bmp) return bmp;
    const blob = await canvasToBlob(source, 'image/jpeg', 0.95);
    return new Uint8Array(await blob.arrayBuffer());
  }

  throw new Error(OCR_ENGINE_ERROR);
}

export async function recognize(source, psm, extraParams = {}) {
  const TessModule = await getModule();
  const bytes = await sourceToBytes(source);
  TessModule.FS.writeFile('/input', bytes);
  if (api.SetImageFile() === 1) throw new Error(OCR_ENGINE_ERROR);

  api.SetVariable('tessedit_pageseg_mode', String(psm));
  api.SetVariable('tessedit_char_whitelist', OCR_CHAR_WHITELIST);
  api.SetVariable('preserve_interword_spaces', '1');
  api.SetVariable('user_defined_dpi', '300');

  // Disable linguistic dictionary bias for pure optical alphanumeric code recognition
  api.SetVariable('load_system_dawg', '0');
  api.SetVariable('load_freq_dawg', '0');
  api.SetVariable('load_punc_dawg', '0');
  api.SetVariable('load_number_dawg', '0');
  api.SetVariable('load_unambig_dawg', '0');
  api.SetVariable('load_bigram_dawg', '0');
  api.SetVariable('classify_bln_numeric_mode', '0');

  for (const [key, value] of Object.entries(extraParams)) {
    if (key.startsWith('tessjs_')) continue;
    api.SetVariable(key, String(value));
  }

  api.Recognize(null);
  return {
    data: {
      text: api.GetUTF8Text() || '',
      lines: [],
      words: [],
    },
  };
}
