import { createOrderDetector } from './orderOcrPipeline.js';
import { recognizeOcrData } from './ocrRecognize.js';
import { createManagedWorker } from './managedWorker.js';
import { activity } from './activity.js';
const fallback=createOrderDetector(recognizeOcrData);
const client=createManagedWorker(()=>new Worker(new URL('./orderOcrWorker.js',import.meta.url),{type:'module'}),{timeoutMs:75000,idleMs:90000});
/** Process the entire OCR plan off the UI thread where OffscreenCanvas is available. */
export async function detectOrderFromPhoto(file,options={}) {
  if(typeof Worker!=='function'||typeof OffscreenCanvas!=='function') {
    await activity.wait(options.signal, { whenClosed: true });
    return fallback(file,options);
  }
  const {signal,...workerOptions}=options;
  try {return await client.run({file,options:workerOptions},{signal});}
  catch(error){
    if(error.name==='AbortError'||error.code==='WORKER_TIMEOUT')throw error;
    // Safari may decode a persisted image only via the page's HTML image decoder.
    await activity.wait(options.signal, { whenClosed: true });
    return fallback(file,options);
  }
}
