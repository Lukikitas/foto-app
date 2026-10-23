export async function withRequestTimeout(task, { signal, timeoutMs = 15000 } = {}) {
  if (signal?.aborted) throw new DOMException('Interrumpido','AbortError');
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  let stop;
  const interrupted=new Promise((_,reject)=>{
    stop=()=>reject(timedOut ? Object.assign(new Error('La consulta tardó demasiado. Verificá la conexión y volvé a intentar.'),{code:'REQUEST_TIMEOUT'}) : new DOMException('Interrumpido','AbortError'));
    controller.signal.addEventListener('abort',stop,{once:true});
  });
  try { return await Promise.race([task(controller.signal),interrupted]); }
  finally { clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',stop); }
}
