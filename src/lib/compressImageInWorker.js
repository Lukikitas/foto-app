import { compressImage } from './compressImage.js';
import { createManagedWorker } from './managedWorker.js';
const client=createManagedWorker(()=>new Worker(new URL('./imageWorker.js',import.meta.url),{type:'module'}),{timeoutMs:30000,idleMs:30000});
export async function compressImageInWorker(file,options) {
  if(typeof Worker!=='function'||typeof OffscreenCanvas!=='function')return compressImage(file,options);
  try {return await client.run({file,options});}
  catch(error){
    if(error.code==='WORKER_TIMEOUT'||error.name==='AbortError')throw error;
    console.warn('Se procesa la evidencia en la página.',error);return compressImage(file,options);
  }
}
