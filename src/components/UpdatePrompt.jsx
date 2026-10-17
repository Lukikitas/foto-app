import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { prepareQueueForUpdate } from '../lib/uploadQueue';
import Dialog from './Dialog';

const CHECK_MS = 60 * 1000;
function checkForUpdate(registration) {
  if (!registration || !navigator.onLine) return;
  registration.update().catch(() => {});
}

export default function UpdatePrompt() {
  const registrationRef = useRef(null);
  const busyRef = useRef(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const {needRefresh:[needRefresh],updateServiceWorker} = useRegisterSW({
    immediate:true,
    onRegisteredSW(_url,registration) { registrationRef.current=registration||null;checkForUpdate(registration); },
  });
  async function applyUpdate() {
    if (busyRef.current) return;
    busyRef.current=true;setBusy(true);setError('');
    try {
      await prepareQueueForUpdate();
      // Never activate or reload until every memory capture was written and read back.
      registrationRef.current?.waiting?.postMessage({type:'SKIP_WAITING'});
      await updateServiceWorker(true);
      window.setTimeout(()=>window.location.reload(),250);
    } catch (failure) {
      setError(failure.message || 'No se pudo asegurar la cola. Conservá la pestaña abierta; no se actualizó la app.');
      busyRef.current=false;setBusy(false);
    }
  }
  useEffect(()=>{
    const check=()=>checkForUpdate(registrationRef.current);
    const onVisible=()=>{if(document.visibilityState==='visible')check();};
    const interval=window.setInterval(check,CHECK_MS);
    document.addEventListener('visibilitychange',onVisible);window.addEventListener('online',check);
    return()=>{window.clearInterval(interval);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('online',check);};
  },[]);
  if(!needRefresh&&!busy&&!error)return null;
  return <>
    <div className="install-banner" role="status" aria-live="polite" aria-label="Actualización disponible">
      <div><strong>Actualización disponible</strong><p>Se pausará el procesamiento y se comprobará que todas las fotos y tickets pendientes estén guardados antes de actualizar.</p>{error&&<p role="alert">{error}</p>}</div>
      <div className="install-banner__actions"><button type="button" className="btn btn--primary btn--small" onClick={applyUpdate} disabled={busy}>{busy?'Comprobando fotos…':'Guardar cola y actualizar'}</button></div>
    </div>
    {busy&&<Dialog busy label="Comprobando fotos antes de actualizar"><section className="complaint-reason-modal"><h3>Conservando tus fotos pendientes</h3><p>Estamos comprobando el guardado de las fotos y los tickets. Mantené esta pestaña abierta.</p><div className="spinner" aria-hidden="true"/></section></Dialog>}
  </>;
}
