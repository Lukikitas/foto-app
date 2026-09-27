import { useCallback, useEffect, useRef, useState } from 'react';
import { AGGREGATOR_OPTIONS, getAggregatorLabel } from '../lib/aggregators';
import { complaintDay, complaintHistoryId, emptyHistory } from '../lib/complaintHistory';
import { draftComparison, findDraftHistory } from '../lib/complaintDraft';
import { loadDraft, updateDraft, discardDraft, confirmDraft, subscribeDrafts, matchDraft, cachedDraft } from '../lib/complaintDraftStore';
import { loadComplaintHistory } from '../lib/complaintHistoryStore';
import { formatMoney } from '../lib/metrics';
import PhotoLightbox from './PhotoLightbox';

export default function ComplaintDraftReview({ active, onOpenHistory, onResolved }) {
  const [draft, setDraft] = useState(cachedDraft);
  const [history, setHistory] = useState(emptyHistory);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulk, setBulk] = useState({ aggregator: '', day: '' });
  const [photo, setPhoto] = useState(null);
  const [connected, setConnected] = useState(navigator.onLine !== false);
  const requestId = useRef(0);
  const matchedRevision = useRef('');
  const blocked = useRef(false);
  useEffect(() => { blocked.current = busy || Boolean(editing); }, [busy, editing]);
  const refresh = useCallback(async (nextDraft, forceMatch = false) => {
    const sequence = ++requestId.current;
    const incoming = nextDraft === undefined ? await loadDraft() : nextDraft;
    const store = await loadComplaintHistory({ force: true, strict: true });
    const revision = incoming ? incoming.id + ':' + incoming.revision : '';
    const matched = incoming && (forceMatch || revision !== matchedRevision.current) ? await matchDraft(incoming, store) : null;
    if (sequence !== requestId.current) return;
    if (revision !== matchedRevision.current) setSelected(new Set());
    matchedRevision.current = revision;
    setDraft(incoming); setHistory(store);
    if (!incoming) setRows([]); else if (matched) setRows(matched.rows);
  }, []);
  useEffect(() => {
    const requests = requestId;
    function reload() {
      if (!active || document.visibilityState === 'hidden' || blocked.current || navigator.onLine === false) return;
      refresh().catch(e => setError(e.message));
    }
    function connectivity() { setConnected(navigator.onLine !== false); reload(); }
    const off = subscribeDrafts(value => {
      setEditing(null); setSelected(new Set());
      refresh(value).catch(e => setError(e.message));
    });
    reload();
    const timer = setInterval(reload, 5000);
    window.addEventListener('focus', reload); window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', reload);
    return () => { ++requests.current; off(); clearInterval(timer);
      window.removeEventListener('focus', reload); window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', reload); };
  }, [active, refresh]);
  async function act(work) {
    blocked.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (e) { setError(e.message); if (e.message.includes('REVISION_CONFLICT')) { setEditing(null); await refresh().catch(() => {}); } }
    finally { blocked.current = false; setBusy(false); }
  }
  function patchRows(transform) {
    return act(async () => {
      const pickedPhotoIds = { ...draft.data.pickedPhotoIds };
      const complaints = draft.data.complaints.map((before,index) => {
        const after = transform(before,index);
        if (before.orderCode !== after.orderCode || before.aggregator !== after.aggregator || complaintDay(before) !== complaintDay(after)) {
          delete pickedPhotoIds[before.id];
          return { ...after, identityEdited: true };
        }
        return after;
      });
      await updateDraft(draft, { complaints, pickedPhotoIds });
      setEditing(null); setSelected(new Set()); setBulk({ aggregator: '', day: '' });
    });
  }
  let summary; let validation = '';
  try { if (draft) summary = draftComparison(history, draft.data, rows); }
  catch (e) { validation = e.message; }
  const disabled = busy || !connected;
  return <section className="draft-review" aria-label="Lista pendiente de revisión" hidden={!active}>
    {error && <p className="message message--error" role="alert">{error}</p>}
    {notice && <div className="message message--success" role="status">{notice} <button className="btn btn--small btn--ghost" onClick={onOpenHistory}>Ver Historial</button></div>}
    {!connected && <p role="status">Sin conexión. Podés consultar la lista, pero los cambios necesitan conexión.</p>}
    {!draft ? <div className="gallery__state gallery__state--empty"><h3>Todo listo para una nueva carga</h3><p>Cargá datos, revisá los reclamos y elegí cuándo guardarlos en Historial.</p></div> : <>
      <header className="draft-review__head"><div><span className="badge">Pendiente de guardar · Compartida</span><h3>{draft.data.complaints.length} reclamos para revisar</h3>
        {summary && <p>{summary.added} nuevos · {summary.changed} modificados · {summary.unchanged} sin cambios</p>}
        <p>Revisá el agregador, el monto y las fotos. Quitar una fila no borra reclamos del Historial.</p></div>
        <div className="draft-review__row-actions"><button className="btn btn--ghost" disabled={disabled || Boolean(editing)} onClick={() => act(() => refresh(undefined, true))}>Actualizar coincidencias</button>
        <button className="btn btn--ghost" disabled={disabled} onClick={() => { if (window.confirm('¿Descartar esta lista compartida? El Historial y las Métricas no se modificarán.')) void act(async () => { await discardDraft(draft); onResolved?.(); }); }}>Descartar lista</button></div>
      </header>
      <div className="draft-review__bulk">
        <label><input type="checkbox" checked={selected.size > 0 && selected.size === draft.data.complaints.length} onChange={e => setSelected(e.target.checked ? new Set(draft.data.complaints.map((_,i) => i)) : new Set())} /> Seleccionar todas</label>
        <label>Agregador <select value={bulk.aggregator} onChange={e => setBulk({ ...bulk, aggregator: e.target.value })}><option value="">Sin cambiar</option>{AGGREGATOR_OPTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <label>Fecha <input type="date" value={bulk.day} onChange={e => setBulk({ ...bulk, day: e.target.value })} /></label>
        <button className="btn btn--ghost btn--small" disabled={disabled || !selected.size || (!bulk.day && !bulk.aggregator)} onClick={() => patchRows((c,i) => selected.has(i) ? { ...c, ...(bulk.aggregator ? { aggregator: bulk.aggregator } : {}), ...(bulk.day ? { day: bulk.day, orderAtIso: null, timeOfDay: null, dateAssumed: false } : {}) } : c)}>Aplicar a seleccionados</button>
        <button className="btn btn--ghost btn--small" disabled={disabled || !selected.size} onClick={() => act(async () => { await updateDraft(draft, { complaints: draft.data.complaints.filter((_,i) => !selected.has(i)) }); setSelected(new Set()); })}>Quitar seleccionados</button>
      </div>
      {validation && <p className="message message--error" role="alert">{validation}</p>}
      <div className="draft-review__rows">
        {draft.data.complaints.map((complaint,index) => {
          const row = rows[index];
          let existing = null;
          try { existing = findDraftHistory(history, complaint); } catch { /* Validation above explains the conflict. */ }
          return <article className="draft-review__row" key={index}>
            <label className="checkbox-label"><input type="checkbox" checked={selected.has(index)} onChange={() => setSelected(old => { const next = new Set(old); if (next.has(index)) next.delete(index); else next.add(index); return next; })} /><strong>{complaint.orderCode}</strong></label>
            <div><span>{getAggregatorLabel(complaint.aggregator)} · {complaintDay(complaint) || 'Falta fecha'}</span><p>{complaint.reason || 'Sin motivo'}{complaint.comment ? ' · ' + complaint.comment : ''}</p>
              <p className="draft-review__amount">Monto: {existing?.amount != null && existing.amount !== complaint.amount && complaint.amount != null ? <><s>{formatMoney(existing.amount)}</s> → </> : null}<strong>{complaint.amount == null ? (existing?.amount == null ? 'Sin monto' : formatMoney(existing.amount) + ' (se conserva)') : formatMoney(complaint.amount)}</strong></p>
            </div>
            <div className="draft-review__photo">
              {row?.photo ? <button type="button" className="draft-review__thumbnail" onClick={() => setPhoto(row.photo)}><img src={row.photo.public_url} alt={'Foto del pedido ' + complaint.orderCode} loading="lazy" /></button> : <span>{row?.status === 'ambiguous' ? 'Elegí una foto: hay varias coincidencias' : 'Sin foto'}</span>}
              {(row?.candidates?.length > 0 || row?.photo) && <select aria-label={'Foto de ' + complaint.orderCode} disabled={disabled} value={draft.data.pickedPhotoIds?.[complaint.id || complaintHistoryId(complaint)] || row?.photo?.id || ''} onChange={e => act(() => updateDraft(draft, { pickedPhotoIds: { ...draft.data.pickedPhotoIds, [complaint.id || complaintHistoryId(complaint)]: e.target.value || null } }))}>
                <option value="">Sin selección manual</option>{[...new Map([...(row?.candidates || []), ...(row?.photo ? [row.photo] : [])].map(p => [p.id,p])).values()].map(p => <option value={p.id} key={p.id}>{p.name} · {p.created_at?.slice(0,10)}</option>)}
              </select>}
            </div>
            <div className="draft-review__row-actions"><button className="btn btn--small btn--ghost" disabled={disabled} onClick={() => setEditing({ index, revision: draft.revision, value: { ...complaint, day: complaintDay(complaint), amount: complaint.amount ?? '' } })}>Corregir</button>
              <button className="btn btn--small btn--ghost" disabled={disabled} onClick={() => act(() => updateDraft(draft, { complaints: draft.data.complaints.filter((_,i) => i !== index) }))}>Quitar de la lista</button>
            </div>
          </article>;
        })}
      </div>
      {draft.data.report && <p className="draft-review__metrics">Al guardar también se actualizarán las Métricas con las cifras originales del Excel. Quitar reclamos de esta lista no cambia esos totales.</p>}
      <div className="draft-review__commit"><button className="btn btn--primary" disabled={disabled || Boolean(validation) || Boolean(editing)} onClick={() => act(async () => {
        const result = await confirmDraft(draft); onResolved?.(); setNotice(`Guardado: ${result.added} nuevos y ${result.updated} existentes. ${result.warning || ''}`);
      })}>{busy ? 'Guardando…' : 'Guardar en Historial'}</button><span>Solo este botón confirma la lista.</span></div>
    </>}
    {editing && <div className="release-modal"><form className="release-modal__dialog draft-review__editor" aria-label="Corregir reclamo" onSubmit={e => {
      e.preventDefault(); const value = editing.value;
      void patchRows((c,i) => i === editing.index ? { ...c, ...value, amount: value.amount === '' ? null : Number(value.amount),
        ...(value.day !== complaintDay(c) ? { orderAtIso: null, timeOfDay: null, dateAssumed: false } : {}) } : c);
    }}>
      <h3>Corregir reclamo</h3>
      {[['orderCode','Código'],['day','Fecha'],['reason','Motivo'],['comment','Comentario'],['combo','Producto'],['amount','Monto']].map(([key,label]) => <label key={key}>{label}<input required={['orderCode','day'].includes(key)} type={key === 'day' ? 'date' : key === 'amount' ? 'number' : 'text'} min={key === 'amount' ? 0 : undefined} step={key === 'amount' ? '0.01' : undefined} value={editing.value[key] || (key === 'amount' && editing.value[key] === 0 ? 0 : '')} onChange={e => setEditing({ ...editing, value: { ...editing.value, [key]: e.target.value } })} /></label>)}
      <label>Agregador<select required value={editing.value.aggregator || ''} onChange={e => setEditing({ ...editing, value: { ...editing.value, aggregator: e.target.value } })}><option value="">Elegir</option>{AGGREGATOR_OPTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
      <div className="draft-review__row-actions"><button type="submit" className="btn btn--primary" disabled={disabled}>Aplicar corrección</button><button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>Cancelar</button></div>
    </form></div>}
    {photo && <PhotoLightbox photo={photo} onClose={() => setPhoto(null)} />}
  </section>;
}
