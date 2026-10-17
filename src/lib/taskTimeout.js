export function withTimeout(task,ms,onTimeout,message='El procesamiento tardó demasiado. La foto se conserva para reintentar.') {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{onTimeout?.();reject(Object.assign(new Error(message),{code:'WORKER_TIMEOUT'}));},ms);
    Promise.resolve(task).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
}
