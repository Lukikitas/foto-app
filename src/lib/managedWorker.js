/** One job at a time, hard timeout, abort and idle disposal of large worker heaps. */
export function createManagedWorker(factory,{timeoutMs=45000,idleMs=60000}={}) {
  let worker=null,active=null,idle=null,nextId=0,tail=Promise.resolve();
  function dispose(reason) {
    clearTimeout(idle);idle=null;
    const previous=worker;worker=null;
    if(previous){previous.onmessage=null;previous.onerror=null;previous.onmessageerror=null;previous.terminate();}
    if(active){const job=active;active=null;job.finish(reason||Object.assign(new Error('Procesamiento interrumpido.'),{name:'AbortError'}));}
  }
  function run(payload,{signal,timeout=timeoutMs}={}) {
    const job=tail.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(Object.assign(new Error('Procesamiento interrumpido.'),{name:'AbortError'}));return;}
      clearTimeout(idle);idle=null;
      const id=++nextId;let timer;
      const aborted=()=>dispose(Object.assign(new Error('Procesamiento interrumpido.'),{name:'AbortError'}));
      const finish=(error,value)=>{
        clearTimeout(timer);signal?.removeEventListener('abort',aborted);
        if(active?.id===id)active=null;
        if(worker)idle=setTimeout(()=>dispose(),idleMs);
        if(error)reject(error);else resolve(value);
      };
      active={id,finish};
      signal?.addEventListener('abort',aborted,{once:true});
      try {
        if(!worker){
          worker=factory();const owner=worker;
          worker.onmessage=({data})=>{if(worker!==owner||data?.id!==active?.id)return;if(data.error)active.finish(Object.assign(new Error(data.error),{code:data.code}));else active.finish(null,data.result);};
          worker.onerror=()=>{if(worker===owner)dispose(new Error('No respondió el procesamiento de la imagen.'));};
          worker.onmessageerror=()=>{if(worker===owner)dispose(new Error('No se pudo recibir la imagen procesada.'));};
        }
        timer=setTimeout(()=>dispose(Object.assign(new Error('El procesamiento tardó demasiado. La captura se conserva para reintentar.'),{code:'WORKER_TIMEOUT'})),timeout);
        worker.postMessage({id,...payload});
      } catch(error) {dispose(error);}
    }));
    tail=job.then(()=>undefined,()=>undefined);return job;
  }
  return {run,dispose};
}
