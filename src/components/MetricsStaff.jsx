import { useEffect, useMemo, useState } from 'react';
import Dialog from './Dialog';
import ComplaintDetailDialog from './ComplaintDetailDialog';
import { confirmAction } from '../lib/confirmAction';
import { normalizePhotographerAliases } from '../lib/metrics';
import { listHistoryItems, COMPLAINT_STATUS_LABELS } from '../lib/complaintHistory';
import { downloadTextFile } from '../lib/complaints';
import { formatDayLabel, formatMoney, formatKnownMoney, formatNumber, formatPct } from '../lib/metrics';
import { fetchOrderPhotosMatchingNames, fetchPhotos, fetchPhotosByIds } from '../lib/photos';
import { compactCode } from '../lib/complaintMatch';
import { buildStaffCsv, buildStaffReport } from '../lib/staffPerformance';

const STAFF_COLUMNS = 'id,name,file_path,created_at,taken_by,has_complaint,is_refutado,aggregator,public_url';

const SORT_BUTTONS = [
  { key: 'photos', label: 'Por fotos' },
  { key: 'complaints', label: 'Por quejas' },
];

function hourLabel(hour) {
  return hour == null ? 'Sin hora' : `${String(hour).padStart(2, '0')}:00`;
}

function StaffBar({ pct }) {
  const width = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <span className="staff-bar" aria-hidden="true">
      <span className="staff-bar__fill" style={{ width: `${width}%` }} />
    </span>
  );
}

function SortHeader({ label, sortKey, current, dir, onSort, numeric = true }) {
  const active = current === sortKey;
  return (
    <th
      scope="col"
      className={numeric ? 'staff__th--num' : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`staff__sort${active ? ' is-active' : ''}`}
        onClick={() => onSort(sortKey)}
        title={`Ordenar por ${label}`}
      >
        {label}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

/**
 * "Desempeño de personal": who takes the photos, complaint rates per person
 * and the hourly distribution of orders (photos) vs complaints (history).
 */
export default function MetricsStaff({ history, range, aggregator = 'all', store, onSave, onManage, remoteReport, remoteVariants, serverMode = false }) {
  const [selected, setSelected] = useState(null);
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [variant, setVariant] = useState('');
  const [presentation, setPresentation] = useState('');
  const [aliasBusy, setAliasBusy] = useState(false);
  const target = store?.targetComplaintPct ?? 2.4;
  const [photos, setPhotos] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  const [extraPhotos, setExtraPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: 'photos', dir: 'desc' });

  useEffect(() => {
    if (!selectedComplaint?.photoId || selectedComplaint.photoUrl) return;
    const controller = new AbortController();
    const id = selectedComplaint.id;
    fetchPhotosByIds([selectedComplaint.photoId], { signal: controller.signal }).then(rows => {
      if (controller.signal.aborted) return;
      const photo = rows[0];
      if (photo?.public_url) setSelectedComplaint(current => current?.id === id
        ? { ...current, photoUrl: photo.public_url } : current);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message || 'No se pudo consultar la foto del pedido.');
    });
    return () => controller.abort();
  }, [selectedComplaint?.id, selectedComplaint?.photoId, selectedComplaint?.photoUrl]);

  const photosKey = `${range.from}|${range.to}|${aggregator}`;
  const loading = serverMode ? !remoteReport : !remoteReport && loadedKey !== photosKey;

  const items = useMemo(
    () => listHistoryItems(history, { from: range.from, to: range.to, aggregator }),
    [history, range.from, range.to, aggregator],
  );

  // Fotos del período: solo se reejecutan al cambiar rango o agregador. Los
  // refrescos del historial que llegan desde otras pantallas no deben volver
  // a mostrar el spinner.
  useEffect(() => {
    if (serverMode || remoteReport) return;
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const filters = { dateFrom: range.from, dateTo: range.to, columns: STAFF_COLUMNS };
        if (aggregator && aggregator !== 'all') filters.aggregator = aggregator;
        const periodPhotos = await fetchPhotos(filters);
        if (!cancelled) {
          setPhotos(periodPhotos);
          // Las fotos extra del período anterior no corresponden al nuevo:
          // se limpian para que el efecto de faltantes traiga las del nuevo.
          setExtraPhotos([]);
          setLoadedKey(photosKey);
        }
      } catch (loadError) {
        if (!cancelled) {
          setPhotos(null);
          setExtraPhotos([]);
          setError(loadError.message || 'No se pudieron leer las fotos del período.');
          setLoadedKey(photosKey);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [photosKey, range.from, range.to, aggregator, remoteReport, serverMode]);

  // Fotos de fuera del período que sirven para atribuir quejas: ids referenciados
  // que no están en el período + nombres de foto concretos que no se encontraron.
  // (Con las fotos del período ya completas por paginación, una queja sin foto
  // vinculada no necesita búsqueda: no tiene foto que atribuir.)
  const missing = useMemo(() => {
    const knownIds = new Set(
      [...(photos || []), ...extraPhotos].map((photo) => photo.id).filter(Boolean),
    );
    const knownCompacts = new Set(
      [...(photos || []), ...extraPhotos]
        .map((photo) => compactCode(photo?.name))
        .filter(Boolean),
    );
    const ids = new Set();
    const tokens = new Set();
    for (const item of items) {
      const photoIdKnown = Boolean(item.photoId) && knownIds.has(item.photoId);
      if (item.photoId && !photoIdKnown) ids.add(item.photoId);
      const nameCode = item.photoName ? compactCode(item.photoName) : '';
      if (nameCode && !knownCompacts.has(nameCode)) {
        // Solo con el nombre real de la foto: la búsqueda es precisa.
        tokens.add(nameCode);
        const digits = nameCode.replace(/\D/g, '');
        if (digits.length >= 4) tokens.add(digits);
      } else if (item.photoId && !photoIdKnown) {
        // El id ya no existe (foto borrada): búsqueda de respaldo por código.
        const fallback = compactCode(item.orderCode);
        if (fallback.length >= 4) tokens.add(fallback);
        const digits = fallback.replace(/\D/g, '');
        if (digits.length >= 4) tokens.add(digits);
      }
    }
    return { ids: [...ids], tokens: [...tokens] };
  }, [photos, extraPhotos, items]);

  const missingKey = `${missing.ids.join(',')}|${missing.tokens.join(',')}`;

  useEffect(() => {
    if (serverMode || remoteReport) return;
    if (missingKey === '|') return undefined;
    let cancelled = false;
    const [idsPart, tokensPart] = missingKey.split('|');
    const jobs = [];
    if (idsPart) jobs.push(fetchPhotosByIds(idsPart.split(',')));
    if (tokensPart) jobs.push(fetchOrderPhotosMatchingNames(tokensPart.split(',')));
    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return;
        const found = results.flat();
        if (found.length === 0) return;
        setExtraPhotos((prev) => {
          const byId = new Map(prev.map((photo) => [photo.id, photo]));
          found.forEach((photo) => byId.set(photo.id, photo));
          return [...byId.values()];
        });
      })
      .catch((failure) => { if (!cancelled) setError('Lectura de atribución incompleta: '+failure.message); });
    return () => {
      cancelled = true;
    };
  }, [missingKey, remoteReport, serverMode]);

  const report = useMemo(
    () => remoteReport || buildStaffReport({ photos: photos || [], historyItems: items, extraPhotos, aliases: store?.photographerAliases }),
    [remoteReport, photos, items, extraPhotos, store?.photographerAliases],
  );

  const people = useMemo(() => {
    const rows = [...report.people];
    if (!rows.some(row=>row.isUnassigned)) rows.push({key:'sin asignar',name:'Sin asignar',isUnassigned:true,photos:0,orders:0,complaints:0,refutadoAceptado:0,noRefutable:0,rejected:0,pending:0,inProgress:0,items:[],complaintAmount:0,recoveredAmount:0,photoSharePct:0,complaintPct:null,adjustedComplaintPct:null});
    const factor = sort.dir === 'desc' ? -1 : 1;
    rows.sort((left, right) => {
      if (left.isUnassigned !== right.isUnassigned) return left.isUnassigned ? 1 : -1;
      if (sort.key === 'name') return factor * left.name.localeCompare(right.name, 'es');
      return factor * ((Number(left[sort.key]) || 0) - (Number(right[sort.key]) || 0));
    });
    return rows;
  }, [report.people, sort]);

  const maxPhotos = Math.max(...report.people.map((row) => row.photos), 1);

  function toggleSort(key) {
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: 'desc' }));
  }

  function handleCsv() {
    downloadTextFile(
      `desempeno-personal-${range.from}-a-${range.to}.csv`,
      buildStaffCsv(report),
    );
  }


  const unassigned = report.people.find((row) => row.isUnassigned);
  const rateTone = report.totals.complaintPct != null && report.totals.complaintPct > 0
    ? (report.totals.orders > 0 && report.totals.complaintPct > target ? 'bad' : undefined)
    : undefined;

  return (
    <section className="staff" aria-label="Desempeño de personal">
      <header className="staff__header">
        <div>
          <h3 className="staff__title">Desempeño de personal</h3>
          <p className="staff__lead">
            Capturas con su autor original y pedidos únicos atribuidos a la segunda captura cronológica (o la única disponible).
            La atribución fotográfica no determina responsabilidad. Las horas corresponden a pedidos únicos y los totales diarios provienen de otra fuente.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={handleCsv}
          disabled={loading || Boolean(error) || (!report.people.length && !report.hourly.length)}
          title="Descargar el desempeño y la distribución horaria como CSV"
        >
          Descargar CSV
        </button>
      </header>

      {error ? <p className="message message--error" role="alert">{error} Los resultados siguientes son incompletos y no deben interpretarse como definitivos.</p> : null}

      {loading ? (
        <div className="gallery__state">
          <div className="spinner" aria-hidden="true" />
          <p>Cargando fotos del período…</p>
        </div>
      ) : (
        <>
          <div className="metrics-kpis staff__kpis">
            <article className="metrics-kpi">
              <p>Capturas</p>
              <strong>{formatNumber(report.totals.photos)}</strong>
              <span>{formatNumber(report.totals.orders)} pedidos únicos</span>
            </article>
            <article className="metrics-kpi">
              <p>Personal</p>
              <strong>{formatNumber(report.totals.people)}</strong>
              <span>con fotos en el período</span>
            </article>
            <article className="metrics-kpi">
              <p>Quejas</p>
              <strong>{formatNumber(report.totals.complaints)}</strong>
              <span>
                {report.totals.unassignedComplaints > 0
                  ? `${formatNumber(report.totals.unassignedComplaints)} sin asignar`
                  : 'todas con foto asignada'}
              </span>
            </article>
            <article className={`metrics-kpi${rateTone ? ' metrics-kpi--bad' : ''}`}>
              <p>% quejas</p>
              <strong>{formatPct(report.totals.complaintPct)}</strong>
              <span>{report.totals.complaints} / {report.totals.orders} pedidos únicos</span>
            </article>
            <article className="metrics-kpi"><p>Sin aceptadas</p><strong>{formatPct(report.totals.adjustedComplaintPct)}</strong><span>{report.totals.complaints-report.totals.refutadoAceptado} / {report.totals.orders} pedidos únicos</span></article>
            <article className={`metrics-kpi${report.totals.recoveredAmount > 0 ? ' metrics-kpi--good' : ''}`}>
              <p>$ recuperado</p>
              <strong>{formatKnownMoney(report.totals.recoveredAmount,report.totals.missingRecoveredCount)}</strong>
              <span>de {formatKnownMoney(report.totals.complaintAmount,report.totals.missingAmountCount)} en quejas</span>
            </article>
          </div>


          {people.length === 0 ? (
            <div className="gallery__state gallery__state--empty">
              <p>No hay fotos ni quejas en este período.</p>
            </div>
          ) : (
            <>
              <div className="staff__toolbar">
                <span className="staff__toolbar-label">Ordenar</span>
                {SORT_BUTTONS.map((button) => (
                  <button
                    key={button.key}
                    type="button"
                    className={`filter-row__btn${sort.key === button.key ? ' filter-row__btn--active' : ''}`}
                    onClick={() => setSort({ key: button.key, dir: 'desc' })}
                    aria-pressed={sort.key === button.key}
                  >
                    {button.label}
                  </button>
                ))}
              </div>

              <div className="metrics-table-wrap">
                <table className="metrics-table staff__table">
                  <thead>
                    <tr>
                      <SortHeader label="Persona" sortKey="name" current={sort.key} dir={sort.dir} onSort={toggleSort} numeric={false} />
                      <SortHeader label="Fotos" sortKey="photos" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <th scope="col" className="staff__th--num">% del total</th>
                      <SortHeader label="Pedidos" sortKey="orders" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="Quejas" sortKey="complaints" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <th
                        scope="col"
                        className="staff__th--num"
                        title="Refutaciones aceptadas según el estado registrado"
                      >
                        Ref. acept.
                      </th>
                      <th
                        scope="col"
                        className="staff__th--num"
                        title="Casos registrados como no refutables"
                      >
                        No refut.
                      </th>
                      <SortHeader label="% quejas" sortKey="complaintPct" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="% sin aceptadas" sortKey="adjustedComplaintPct" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="Rechazadas" sortKey="rejected" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="Pendientes" sortKey="pending" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="En disputa" sortKey="inProgress" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="$ quejas" sortKey="complaintAmount" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                      <SortHeader label="$ recuperado" sortKey="recoveredAmount" current={sort.key} dir={sort.dir} onSort={toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((row) => (
                      <tr key={row.key} className={row.isUnassigned ? 'staff__row--unassigned' : undefined}>
                        <td>
                          <span className={`staff__person${row.isUnassigned ? ' staff__person--none' : ''}`}>
                            <button type="button" className="metrics-table-link" title="Ver detalle de esta persona" onClick={() => setSelected(row)}>{row.name}</button>
                          </span>
                        </td>
                        <td className="staff__td--bar">
                          <span className="staff__td-value">{formatNumber(row.photos)}</span>
                          <StaffBar pct={(row.photos / maxPhotos) * 100} />
                        </td>
                        <td className="staff__td--num">{formatPct(row.photoSharePct, 1)}</td>
                        <td className="staff__td--num">{formatNumber(row.orders)}</td>
                        <td className="staff__td--num">{formatNumber(row.complaints)}</td>
                        <td className="staff__td--num">{formatNumber(row.refutadoAceptado)}</td>
                        <td className={`staff__td--num${row.noRefutable > 0 ? ' is-bad' : ''}`}>
                          {formatNumber(row.noRefutable)}
                        </td>
                        <td className={`staff__td--num${row.complaintPct != null && row.complaintPct > target ? ' is-bad' : ''}`}>
                          {formatPct(row.complaintPct)}<small>{row.complaints} / {row.orders}</small>
                        </td>
                        <td>{formatPct(row.adjustedComplaintPct)}<small>{row.complaints-row.refutadoAceptado} / {row.orders}</small></td><td>{row.rejected}</td><td>{row.pending}</td><td>{row.inProgress}</td>
                        <td className="staff__td--num">{formatKnownMoney(row.complaintAmount,row.missingAmountCount)}</td>
                        <td className="staff__td--num">{formatKnownMoney(row.recoveredAmount,row.missingRecoveredCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="staff__footnote">
                Las tasas utilizan pedidos únicos. Aceptada describe el resultado registrado, sin inferir responsabilidad del autor de la captura.
              </p>
            </>
          )}


          {report.hourly.length > 0 && (
            <div className="staff__hourly">
              <h4 className="staff__subtitle">Pedidos y quejas hora por hora</h4>
              <div className="metrics-table-wrap">
                <table className="metrics-table staff__table">
                  <thead>
                    <tr>
                      <th scope="col">Hora</th>
                      <th scope="col" className="staff__th--bar">Pedidos</th>
                      <th scope="col" className="staff__th--num">% pedidos</th>
                      <th scope="col" className="staff__th--num">Quejas</th>
                      <th scope="col" className="staff__th--num">% quejas</th>
                      <th scope="col" className="staff__th--num">% quejas s/ pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.hourly.map((row) => (
                      <tr key={hourLabel(row.hour)}>
                        <td><strong>{hourLabel(row.hour)}</strong></td>
                        <td className="staff__td--bar">
                          <span className="staff__td-value">{formatNumber(row.orders)}</span>
                          <StaffBar pct={row.ordersPct} />
                        </td>
                        <td className="staff__td--num">{formatPct(row.ordersPct, 1)}</td>
                        <td className="staff__td--num">{formatNumber(row.complaints)}</td>
                        <td className="staff__td--num">{formatPct(row.complaintsPct, 1)}</td>
                        <td className={`staff__td--num${row.ratePct != null && row.ratePct > target ? ' is-bad' : ''}`}>
                          {formatPct(row.ratePct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="staff__footnote">
                {unassigned && unassigned.complaints > 0
                  ? `${formatNumber(unassigned.complaints)} queja(s) sin foto asignada no se atribuyen a ninguna persona. `
                  : ''}
                Los pedidos se agrupan por día argentino, agregador y código válido. Sin identificación válida se conservan por separado.
              </p>
            </div>
          )}
        </>
      )}

      {report.attributionWarnings.map((warning,index)=><p key={index} className="message message--error">{warning}</p>)}
      <details className="metrics-quality"><summary>Asociar variantes de nombres</summary><p>Solo cambia la presentación de este informe. Los autores originales se conservan.</p>
      <label>Nombre original<select value={variant} onChange={event=>setVariant(event.target.value)}><option value="">Seleccionar</option>{(remoteVariants || [...new Set((photos||[]).map(photo=>photo.taken_by).filter(Boolean))].sort()).map(name=><option key={name}>{name}</option>)}</select></label>
      <label>Presentación común<input value={presentation} onChange={event=>setPresentation(event.target.value)} maxLength={80}/></label>
      <button className="btn btn--primary" disabled={!variant||!presentation.trim()||aliasBusy} onClick={async()=>{
        if(!await confirmAction('Se mostrará “'+variant+'” como “'+presentation.trim()+'”. No se modifican los autores originales.',{danger:false,title:'Confirmar asociación',confirmLabel:'Asociar'}))return;
        setAliasBusy(true);
        try{await onSave({...store,photographerAliases:normalizePhotographerAliases({...store.photographerAliases,[variant.toLowerCase().trim().replace(/\s+/g,' ')]:presentation.trim()})},'Presentación de nombres guardada.');}
        finally{setAliasBusy(false);}
      }}>Asociar nombres</button>
      {Object.entries(store?.photographerAliases||{}).map(([key,value])=><p key={key}>{key} → {value} <button className="btn btn--ghost btn--small" disabled={aliasBusy} onClick={async()=>{if(!await confirmAction('¿Quitar esta asociación?',{danger:false}))return;const aliases={...store.photographerAliases};delete aliases[key];setAliasBusy(true);try{await onSave({...store,photographerAliases:aliases},'Asociación eliminada.');}finally{setAliasBusy(false);}}}>Quitar</button></p>)}</details>
      {selected && <Dialog variant="wide" labelledBy="staff-detail-title" onClose={()=>setSelected(null)}><section className="complaint-reason-modal"><div className="complaint-detail__header"><div><h3 id="staff-detail-title">Quejas de {selected.name}</h3><p>{selected.photos} capturas · {selected.orders} pedidos únicos · {selected.complaints} casos</p></div><button type="button" className="btn btn--ghost" onClick={()=>setSelected(null)}>Cerrar</button></div><div className="metrics-table-wrap"><table className="metrics-table"><thead><tr><th>Pedido</th><th>Fecha</th><th>Estado</th><th>Monto</th><th>Detalle</th></tr></thead><tbody>{selected.items.map(item=><tr key={item.id}><td>{item.orderCode}</td><td>{formatDayLabel(item.day)}</td><td>{COMPLAINT_STATUS_LABELS[item.status] || item.status}</td><td>{item.amount == null ? 'Sin monto' : formatMoney(item.amount)}</td><td><button type="button" className="metrics-table-link" aria-label={'Ver detalle del pedido '+item.orderCode} onClick={()=>{const photo=[...(photos || []),...extraPhotos].find(photo=>photo.id===item.photoId);setSelectedComplaint({...item,photoUrl:item.photoUrl || photo?.public_url});}}>Ver detalle →</button></td></tr>)}</tbody></table></div></section></Dialog>}
      {selectedComplaint && <ComplaintDetailDialog key={selectedComplaint.id} item={selectedComplaint} refutadoDays={store?.refutadoDays} onClose={()=>setSelectedComplaint(null)} onManage={onManage ? item=>{setSelected(null);onManage(item);} : undefined}/>}
    </section>
  );
}

