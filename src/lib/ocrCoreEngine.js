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
    globalThis.importScripts(url);
    return;
  }

  const source = await (await fetch(url)).text();
  const run = new Function(source);
  run();
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

async function sourceToBytes(source) {
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());

  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    const canvas = createDrawCanvas(source.width, source.height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error(OCR_ENGINE_ERROR);
    context.drawImage(source, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/png');
    return new Uint8Array(await blob.arrayBuffer());
  }

  if (source && typeof source.getContext === 'function') {
    const blob = await canvasToBlob(source, 'image/png');
    return new Uint8Array(await blob.arrayBuffer());
  }

  throw new Error(OCR_ENGINE_ERROR);
}

export async function recognize(source, psm, extraParams = {}) {
  const TessModule = await getModule();
  const bytes = await sourceToBytes(source);
  TessModule.FS.writeFile('/input', bytes);
  if (api.SetImageFile(1, 0) === 1) throw new Error(OCR_ENGINE_ERROR);

  api.SetVariable('tessedit_pageseg_mode', String(psm));
  api.SetVariable('tessedit_char_whitelist', OCR_CHAR_WHITELIST);
  api.SetVariable('preserve_interword_spaces', '1');
  api.SetVariable('user_defined_dpi', '300');
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
