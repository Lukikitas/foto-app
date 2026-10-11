import { useCallback, useEffect, useState } from 'react';
import { formatBytes, loadStorageUsage } from '../lib/storageUsage';

const CATEGORIES=[['orders','Fotos de pedidos'],['files','Archivos'],['tickets','Tickets remotos'],['other','Otros objetos del sistema']];
const empty={count:0,bytes:0,unknownSizeCount:0};
export default function StoragePanel({retention,onCleanup,refreshKey, loadUsage = loadStorageUsage}) {
  const [data,setData]=useState(null); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    setBusy(true);setError('');
    try{setData(await loadUsage(retention?.retention_days||30));}
    catch(failure){setError(failure.message||'No se pudo consultar el almacenamiento.');}
    finally{setBusy(false);}
  },[retention,loadUsage]);
  useEffect(()=>{const timer=setTimeout(()=>void refresh(),0); return()=>clearTimeout(timer);},[refresh,refreshKey]);
  const currentRetention=data?.retention || retention;
  const eligible=data?.selections?.eligible||empty; const protectedFiles=data?.selections?.protected||empty;
  return <section className="storage-panel" aria-label="Almacenamiento remoto">
    <div className="storage-panel__header"><h3>Almacenamiento</h3><button className="btn btn--ghost btn--small" onClick={refresh} disabled={busy}>{busy?'Consultando…':'Actualizar'}</button></div>
    <p>Archivos remotos de la app · fotos y tickets</p>
    {error && <p className="message message--error" role="alert">{error} {data?'Los valores anteriores pueden estar desactualizados.':''}</p>}
    {!data&&busy&&<p role="status">Calculando espacio ocupado…</p>}
    {data&&<>
      <p className="storage-total">{data.total.count && data.total.unknownSizeCount === data.total.count ? 'Sin tamaño conocido' : formatBytes(data.total.bytes)}</p><small>{data.total.count.toLocaleString('es-AR')} objetos · tamaños conocidos</small>
      <div className="storage-breakdown" aria-hidden="true">{CATEGORIES.map(([key])=><span key={key} style={{width:`${data.total.bytes?(data.categories[key]?.bytes||0)/data.total.bytes*100:0}%`}}/>)}</div>
      <div className="storage-grid">{CATEGORIES.map(([key,label])=>{const row=data.categories[key]||empty;return <article key={key}><small>{label}</small><strong>{row.count && row.unknownSizeCount === row.count ? 'Sin tamaño conocido' : formatBytes(row.bytes)}</strong><small>{row.count.toLocaleString('es-AR')} objetos{row.unknownSizeCount?` · ${row.unknownSizeCount} sin tamaño conocido`:''}</small></article>;})}</div>
      {data.total.unknownSizeCount>0&&<p>⚠ {data.total.unknownSizeCount} objetos sin tamaño informado: el espacio mostrado es parcial.</p>}
      <div className="storage-cleanup"><strong>Limpieza de fotos de pedidos</strong>
        <p>{data.retainedRecords.toLocaleString('es-AR')} registros con imagen · {data.recordsWithoutImage.toLocaleString('es-AR')} registros conservados sin imagen.</p>
        <p>{protectedFiles.count.toLocaleString('es-AR')} archivos protegidos · {formatBytes(protectedFiles.bytes)}{protectedFiles.unknownSizeCount?' (parcial)':''}.</p>
        <p><strong>{eligible.count.toLocaleString('es-AR')} archivos elegibles · {formatBytes(eligible.bytes)} liberables{eligible.unknownSizeCount?' (parcial)':''}</strong> con el plazo de {currentRetention?.retention_days||30} días.</p>
        <p>Automática: {currentRetention?.enabled?'activa':'desactivada'}. Última limpieza: {currentRetention?.last_run_at?new Date(currentRetention.last_run_at).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}):'sin corrida registrada'} · {currentRetention?.last_removed||0} fotos borradas.</p>
        <button className="btn btn--danger btn--small" onClick={onCleanup}>Elegir fecha y limpiar fotos</button>
      </div>
      <p className="metric-source">Consultado {new Date(data.snapshotAt).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})}. No incluye cachés ni tickets guardados solamente en este dispositivo. Las candidatas se vuelven a validar al confirmar.</p>
    </>}
  </section>;
}
