import { createWorker } from 'tesseract.js';
import { OCR_CHAR_WHITELIST, OCR_ENGINE_ERROR, tessAssetUrl } from './tesseractAssets.js';

let workerPromise = null;

function fail(error) {
  if (error) console.error(error);
  throw new Error(OCR_ENGINE_ERROR);
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
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
        tessedit_char_whitelist: OCR_CHAR_WHITELIST,
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      fail(error);
    });
  }

  return workerPromise;
}

export async function recognize(source, psm, extraParams = {}) {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    tessedit_char_whitelist: OCR_CHAR_WHITELIST,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    ...extraParams,
  });
  return worker.recognize(source);
}
