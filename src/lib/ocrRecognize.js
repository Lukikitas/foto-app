let enginePromise = null;

export function canUseNestedWorker() {
  return typeof Worker === 'function';
}

async function loadEngine() {
  if (canUseNestedWorker()) {
    try {
      return await import('./ocrWorkerEngine.js');
    } catch (error) {
      console.error(error);
    }
  }
  return import('./ocrCoreEngine.js');
}

export function getOcrEngine() {
  if (!enginePromise) {
    enginePromise = loadEngine().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export async function recognizeOcrData(source, psm, extraParams = {}) {
  const engine = await getOcrEngine();
  return engine.recognize(source, psm, extraParams);
}

export function resetOcrEngineForTests() {
  enginePromise = null;
}
