import { useId, useState } from 'react';
import Dialog from './Dialog';
import PhotoLightbox from './PhotoLightbox';
import { getAggregatorLabel } from '../lib/aggregators';
import { COMPLAINT_STATUS_LABELS } from '../lib/complaintHistory';
import { formatDayLabel, formatMoney } from '../lib/metrics';
import { translatedReason } from '../lib/metricsQuality';
import { isRefutadoExpired, refutadoDeadlineDate } from '../lib/refutadoDeadline';

function localTime(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' }) : 'No informada';
}

export default function ComplaintDetailDialog({ item, refutadoDays, onClose, onManage }) {
  const titleId = useId();
  const [zoom, setZoom] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const expired = item.status === 'queja' && isRefutadoExpired(item.day, refutadoDays, item.aggregator);
  const deadline = refutadoDeadlineDate(item.day, refutadoDays, item.aggregator);
  const reason = translatedReason(item.reason);
  const photo = { id: item.photoId, name: item.photoName || item.orderCode, public_url: item.photoUrl, created_at: item.orderAtIso };
  return <>
    <Dialog variant="wide" labelledBy={titleId} onClose={onClose}>
      <section className="complaint-reason-modal complaint-detail">
        <header className="complaint-detail__header"><div><p className="complaint-detail__eyebrow">Detalle de la queja</p><h3 id={titleId}>Pedido {item.orderCode}</h3><p>{getAggregatorLabel(item.aggregator)} · {item.day ? formatDayLabel(item.day) : 'Fecha no informada'}</p></div><button type="button" className="btn btn--ghost" onClick={onClose}>Cerrar</button></header>
        <div className="complaint-detail__body">
          <section className="complaint-detail__evidence" aria-label="Foto del pedido"><h4>Evidencia fotográfica</h4>{item.photoUrl && !imageFailed ? <><button type="button" className="complaint-detail__photo" onClick={()=>setZoom(true)} aria-label="Ampliar foto del pedido"><img src={item.photoUrl} alt={'Foto del pedido '+item.orderCode} onError={()=>setImageFailed(true)}/></button><button type="button" className="btn btn--ghost" onClick={()=>setZoom(true)}>Ampliar foto</button></> : <div className="complaint-detail__empty"><strong>{imageFailed ? 'No se pudo cargar la foto' : 'Sin foto disponible'}</strong><p>{imageFailed ? 'Podés volver a intentar cargar la imagen.' : 'El historial conserva la información de la queja aunque no haya una imagen disponible.'}</p>{imageFailed && <button type="button" className="btn btn--ghost" onClick={()=>setImageFailed(false)}>Reintentar</button>}</div>}</section>
          <section className="complaint-detail__info" aria-label="Información de la queja">
            <dl className="complaint-detail__facts">
              <div><dt>Estado</dt><dd>{COMPLAINT_STATUS_LABELS[expired ? 'queja_vencida' : item.status] || item.status}</dd></div>
              <div><dt>Monto reclamado</dt><dd>{item.amount == null ? 'Sin monto informado' : formatMoney(item.amount)}</dd></div>
              <div><dt>Fecha del pedido</dt><dd>{item.day ? formatDayLabel(item.day) : 'No informada'}{item.dateAssumed && <small>Fecha estimada al importar</small>}</dd></div>
              <div><dt>Hora del pedido · Argentina</dt><dd>{item.timeOfDay || localTime(item.orderAtIso)}</dd></div>
              <div><dt>Agregador</dt><dd>{getAggregatorLabel(item.aggregator)}</dd></div>
              <div><dt>Combo</dt><dd>{item.combo || 'No informado'}</dd></div>
              <div className="complaint-detail__full"><dt>Plazo para refutar</dt><dd>{deadline ? formatDayLabel(deadline)+' (inclusive)' : item.day ? 'Sin límite' : 'No se puede determinar sin fecha'}</dd></div>
              <div className="complaint-detail__full"><dt>Motivo de la queja</dt><dd>{reason || 'No informado'}{item.reason && reason !== item.reason && <small>Original: {item.reason}</small>}</dd></div>
              {item.unrefutableReason && <div className="complaint-detail__full"><dt>Motivo no refutable</dt><dd>{item.unrefutableReason}</dd></div>}
              {item.rejectionReason && <div className="complaint-detail__full"><dt>Motivo del rechazo</dt><dd>{item.rejectionReason}</dd></div>}
              <div className="complaint-detail__full"><dt>Comentario</dt><dd>{item.comment || 'Sin comentario'}</dd></div>
            </dl>
            {Object.keys(item.fields || {}).length > 0 && <details className="complaint-detail__additional"><summary tabIndex={0}>Más datos del registro</summary><dl className="complaint-detail__facts">{Object.entries(item.fields).map(([label,value])=><div className="complaint-detail__full" key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></details>}
          </section>
        </div>
        {onManage && <footer className="complaint-detail__footer"><span>Para gestionar el reclamo y su estado:</span><button type="button" className="btn btn--primary" onClick={()=>{onClose();onManage(item);}}>Abrir en Gestionar</button></footer>}
      </section>
    </Dialog>
    {zoom && <PhotoLightbox photo={photo} onClose={()=>setZoom(false)}/>}
  </>;
}
