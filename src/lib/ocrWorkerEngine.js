import { createWorker } from 'tesseract.js';
import { OCR_CHAR_WHITELIST, OCR_ENGINE_ERROR, tessAssetUrl } from './tesseractAssets.js';
import { withTimeout } from './taskTimeout.js';
let workerPromise=null,currentWorker=null,idle=null,generation=0,tail=Promise.resolve();
function dispose() {
  clearTimeout(idle);idle=null;generation++;workerPromise=null;
  const old=currentWorker;currentWorker=null;if(old)void old.terminate().catch(()=>{});
}
async function getWorker() {
  if(!workerPromise){
    const epoch=generation;
    workerPromise=(async()=>{
      const options={workerPath:tessAssetUrl('worker.min.js'),corePath:tessAssetUrl('core'),langPath:tessAssetUrl('lang'),gzip:true,errorHandler:error=>console.error(error)};
      let worker;
      try {worker=await createWorker('spa+eng',1,options);}
      catch(error){if(epoch!==generation)throw error;worker=await createWorker('eng',1,options);}
      if(epoch!==generation){void worker.terminate();throw new Error(OCR_ENGINE_ERROR);}
      currentWorker=worker;
      await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300',tessedit_char_whitelist:OCR_CHAR_WHITELIST});
      return worker;
    })().catch(error=>{if(epoch===generation)dispose();throw error;});
  }
  return workerPromise;
}
export function recognize(source,psm,extraParams={}) {
  const result=tail.catch(()=>{}).then(async()=>{
    clearTimeout(idle);
    try {
      return await withTimeout((async()=>{
        const worker=await getWorker();
        await worker.setParameters({tessedit_pageseg_mode:String(psm),tessedit_char_whitelist:OCR_CHAR_WHITELIST,preserve_interword_spaces:'1',user_defined_dpi:'300',...extraParams});
        return worker.recognize(source);
      })(),35000,dispose);
    } catch(error){dispose();throw error;}
    finally {if(currentWorker)idle=setTimeout(dispose,90000);}
  });
  tail=result.then(()=>undefined,()=>undefined);return result;
}
