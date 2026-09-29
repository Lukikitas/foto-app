import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // 'all', 'pedidosya', 'rappi', 'with_photo', 'no_photo'

  const requestId = useRef(0);
  const matchedRevision = useRef('');
  const blocked = useRef(false);

  useEffect(() => {
    blocked.current = busy || Boolean(editing);
  }, [busy, editing]);

  // Las comparaciones recorren todo el historial por reclamo: se memoizan y se
  // saltean con el panel oculto para no congelar la pantalla con lotes grandes.
  const { summary, validation } = useMemo(() => {
    if (!active || !draft) return { summary: undefined, validation: '' };
    try {
      return { summary: draftComparison(history, draft.data, rows), validation: '' };
    } catch (e) {
      return { summary: undefined, validation: e.message };
    }
  }, [active, draft, history, rows]);

  const refresh = useCallback(async (nextDraft, forceMatch = false) => {
    const sequence = ++requestId.current;
    const incoming = nextDraft === undefined ? await loadDraft() : nextDraft;
    const store = await loadComplaintHistory({ force: true, strict: true });
    const revision = incoming ? incoming.id + ':' + incoming.revision : '';
    const matched = incoming && (forceMatch || revision !== matchedRevision.current) ? await matchDraft(incoming, store) : null;
    if (sequence !== requestId.current) return;
    if (revision !== matchedRevision.current) setSelected(new Set());
    matchedRevision.current = revision;
    // Mismo id y revisión = mismo contenido: conservar la referencia evita
    // re-renderizar la tabla completa cada 5 segundos.
    setDraft((prev) => (
      prev && incoming && prev.id === incoming.id && prev.revision === incoming.revision
        ? prev
        : incoming
    ));
    setHistory(store);
    setRows((prev) => {
      if (!incoming) return prev.length === 0 ? prev : [];
      if (matched) return matched.rows;
      return prev;
    });
  }, []);

  useEffect(() => {
    const requests = requestId;
    function reload() {
      if (!active || document.visibilityState === 'hidden' || blocked.current || navigator.onLine === false) return;
      refresh().catch(e => setError(e.message));
    }
    function connectivity() {
      setConnected(navigator.onLine !== false);
      reload();
    }
    const off = subscribeDrafts(value => {
      setEditing(null);
      setSelected(new Set());
      refresh(value).catch(e => setError(e.message));
    });
    reload();
    const timer = setInterval(reload, 5000);
    window.addEventListener('focus', reload);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', reload);
    return () => {
      ++requests.current;
      off();
      clearInterval(timer);
      window.removeEventListener('focus', reload);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [active, refresh]);

  async function act(work) {
    blocked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e.message);
      if (e.message.includes('REVISION_CONFLICT')) {
        setEditing(null);
        await refresh().catch(() => {});
      }
    } finally {
      blocked.current = false;
      setBusy(false);
    }
  }

  function patchRows(transform) {
    return act(async () => {
      const pickedPhotoIds = { ...draft.data.pickedPhotoIds };
      const complaints = draft.data.complaints.map((before, index) => {
        const after = transform(before, index);
        if (
          before.orderCode !== after.orderCode ||
          before.aggregator !== after.aggregator ||
          complaintDay(before) !== complaintDay(after)
        ) {
          delete pickedPhotoIds[before.id];
          return { ...after, identityEdited: true };
        }
        return after;
      });
      await updateDraft(draft, { complaints, pickedPhotoIds });
      setEditing(null);
      setSelected(new Set());
      setBulk({ aggregator: '', day: '' });
    });
  }

  const disabled = busy || !connected;

  // Referencia estable: draft?.data?.complaints crea un array nuevo en cada
  // render y invalidaba los useMemo dependientes.
  const complaintsList = useMemo(() => draft?.data?.complaints || [], [draft]);

  const filteredIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const result = [];
    for (let i = 0; i < complaintsList.length; i++) {
      const c = complaintsList[i];
      const r = rows[i];
      const agg = (c.aggregator || '').toLowerCase();
      const hasPhoto = Boolean(r?.photo);

      if (filterType === 'pedidosya' && !agg.includes('pedidosya')) continue;
      if (filterType === 'rappi' && !agg.includes('rappi')) continue;
      if (filterType === 'with_photo' && !hasPhoto) continue;
      if (filterType === 'no_photo' && hasPhoto) continue;

      if (q) {
        const text = [
          c.orderCode,
          c.reason,
          c.comment,
          c.combo,
          complaintDay(c),
          getAggregatorLabel(c.aggregator),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!text.includes(q)) continue;
      }

      result.push(i);
    }
    return result;
  }, [complaintsList, rows, searchQuery, filterType]);

  const totalAmount = useMemo(() => {
    return complaintsList.reduce((acc, c) => {
      let ext = null;
      try { ext = findDraftHistory(history, c); } catch { /* Sin historial previo. */ }
      const val = c.amount != null ? c.amount : (ext?.amount != null ? ext.amount : 0);
      return acc + (Number(val) || 0);
    }, 0);
  }, [complaintsList, history]);

  const selectedAmount = useMemo(() => {
    let sum = 0;
    for (const idx of selected) {
      const c = complaintsList[idx];
      if (!c) continue;
      let ext = null;
      try { ext = findDraftHistory(history, c); } catch { /* Sin historial previo. */ }
      const val = c.amount != null ? c.amount : (ext?.amount != null ? ext.amount : 0);
      sum += Number(val) || 0;
    }
    return sum;
  }, [selected, complaintsList, history]);

  function handleSelectAllFiltered(checked) {
    if (checked) {
      setSelected(new Set(filteredIndices));
    } else {
      setSelected(new Set());
    }
  }

  const allFilteredSelected = filteredIndices.length > 0 && filteredIndices.every(i => selected.has(i));

  return (
    <section className="draft-review" aria-label="Lista pendiente de revision" hidden={!active}>
      {error && <p className="message message--error" role="alert">{error}</p>}
      {notice && (
        <div className="message message--success" role="status">
          {notice} <button className="btn btn--small btn--ghost" onClick={onOpenHistory}>Ver Historial</button>
        </div>
      )}
      {!connected && (
        <p className="draft-review__offline" role="status">
          Sin conexion. Podes consultar la lista, pero los cambios necesitan conexion.
        </p>
      )}

      {!draft ? (
        <div className="gallery__state gallery__state--empty">
          <h3>Todo listo para una nueva carga</h3>
          <p>Carga datos, revisa los reclamos y elegi cuando guardarlos en Historial.</p>
        </div>
      ) : (
        <>
          {/* HEADER RESUMEN & ACCIONES PRINCIPALES */}
          <header className="draft-review__head">
            <div className="draft-review__head-info">
              <span className="draft-review__badge">Pendiente</span>
              <h3 className="draft-review__title">
                {complaintsList.length} reclamo{complaintsList.length !== 1 ? 's' : ''}
              </h3>
              <div className="draft-review__head-stats">
                {summary && (
                  <>
                    <span><strong>{summary.added}</strong> nuevos</span>
                    <span className="draft-review__bullet">&middot;</span>
                    <span><strong>{summary.changed}</strong> mod.</span>
                    <span className="draft-review__bullet">&middot;</span>
                  </>
                )}
                <span>Total: <strong>{formatMoney(totalAmount)}</strong></span>
              </div>
            </div>

            <div className="draft-review__head-actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={disabled || Boolean(editing)}
                onClick={() => act(() => refresh(undefined, true))}
                title="Actualizar coincidencias y fotos con el Historial"
              >
                &#x21BA; Actualizar
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small draft-review__btn-discard"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm('¿Descartar esta lista de reclamos? El Historial no se modificara.')) {
                    void act(async () => {
                      await discardDraft(draft);
                      onResolved?.();
                    });
                  }
                }}
              >
                Descartar
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small draft-review__btn-confirm-head"
                disabled={disabled || Boolean(validation) || Boolean(editing)}
                onClick={() => act(async () => {
                  const result = await confirmDraft(draft);
                  onResolved?.();
                  setNotice('Guardado: ' + result.added + ' nuevos y ' + result.updated + ' existentes. ' + (result.warning || ''));
                })}
              >
                {busy ? 'Guardando...' : 'Guardar en Historial'}
              </button>
            </div>
          </header>

          {/* TOOLBAR: FILTROS + BUSCADOR */}
          <div className="draft-review__toolbar">
            <div className="draft-review__filters-row">
              <label className="draft-review__select-all">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={e => handleSelectAllFiltered(e.target.checked)}
                />
                <span>
                  {selected.size > 0
                    ? `${selected.size} de ${complaintsList.length} sel.`
                    : 'Selec. todo'}
                </span>
              </label>

              <div className="draft-review__pills" role="group" aria-label="Filtrar tipo de reclamo">
                <button
                  type="button"
                  className={`draft-review__pill${filterType === 'all' ? ' draft-review__pill--active' : ''}`}
                  onClick={() => setFilterType('all')}
                >
                  Todos ({complaintsList.length})
                </button>
                <button
                  type="button"
                  className={`draft-review__pill${filterType === 'pedidosya' ? ' draft-review__pill--active' : ''}`}
                  onClick={() => setFilterType('pedidosya')}
                >
                  PedidosYa
                </button>
                <button
                  type="button"
                  className={`draft-review__pill${filterType === 'rappi' ? ' draft-review__pill--active' : ''}`}
                  onClick={() => setFilterType('rappi')}
                >
                  Rappi
                </button>
                <button
                  type="button"
                  className={`draft-review__pill${filterType === 'with_photo' ? ' draft-review__pill--active' : ''}`}
                  onClick={() => setFilterType('with_photo')}
                >
                  Con foto
                </button>
                <button
                  type="button"
                  className={`draft-review__pill${filterType === 'no_photo' ? ' draft-review__pill--active' : ''}`}
                  onClick={() => setFilterType('no_photo')}
                >
                  Sin foto
                </button>
              </div>
            </div>

            <div className="draft-review__search-wrap">
              <span className="draft-review__search-icon" aria-hidden="true">&#x1F50D;</span>
              <input
                type="search"
                className="draft-review__search-input"
                placeholder="Buscar por pedido, motivo, producto..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Buscar reclamos"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="draft-review__search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpiar busqueda"
                >
                  &times;
                </button>
              )}
            </div>

            {/* BARRA DE EDICIÓN MASIVA SI HAY ITEMS SELECCIONADOS */}
            {selected.size > 0 && (
              <div className="draft-review__bulk-active" role="toolbar" aria-label="Acciones masivas">
                <span className="draft-review__bulk-badge">
                  {selected.size} sel. ({formatMoney(selectedAmount)})
                </span>
                <label className="draft-review__bulk-field">
                  <span>Agregador</span>
                  <select
                    value={bulk.aggregator}
                    onChange={e => setBulk({ ...bulk, aggregator: e.target.value })}
                  >
                    <option value="">Sin cambiar</option>
                    {AGGREGATOR_OPTIONS.map(a => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </label>
                <label className="draft-review__bulk-field">
                  <span>Fecha</span>
                  <input
                    type="date"
                    value={bulk.day}
                    onChange={e => setBulk({ ...bulk, day: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  disabled={disabled || (!bulk.day && !bulk.aggregator)}
                  onClick={() => patchRows((c, i) => selected.has(i) ? {
                    ...c,
                    ...(bulk.aggregator ? { aggregator: bulk.aggregator } : {}),
                    ...(bulk.day ? { day: bulk.day, orderAtIso: null, timeOfDay: null, dateAssumed: false } : {}),
                  } : c)}
                >
                  Aplicar cambios
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost draft-review__bulk-remove-btn"
                  disabled={disabled}
                  onClick={() => act(async () => {
                    await updateDraft(draft, {
                      complaints: draft.data.complaints.filter((_, i) => !selected.has(i))
                    });
                    setSelected(new Set());
                  })}
                >
                  Quitar {selected.size} de la lista
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  onClick={() => setSelected(new Set())}
                >
                  Cancelar seleccion
                </button>
              </div>
            )}
          </div>

          {validation && <p className="message message--error" role="alert">{validation}</p>}

          {/* TABLA SCROLLABLE */}
          <div className="draft-review__table-container" tabIndex={0} role="region" aria-label="Tabla de reclamos a revisar">
            {filteredIndices.length === 0 ? (
              <div className="draft-review__empty-search">
                <p>No se encontraron reclamos con los filtros aplicados.</p>
                {searchQuery && (
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => { setSearchQuery(''); setFilterType('all'); }}>
                    Limpiar filtros
                  </button>
                )}
              </div>
            ) : (
              <table className="draft-review__table">
                <thead className="draft-review__thead">
                  <tr>
                    <th className="draft-review__th draft-review__th--check">
                      <span className="sr-only">Seleccionar</span>
                    </th>
                    <th className="draft-review__th draft-review__th--order">Pedido / Fecha</th>
                    <th className="draft-review__th draft-review__th--reason">Motivo y Detalle</th>
                    <th className="draft-review__th draft-review__th--amount">Monto</th>
                    <th className="draft-review__th draft-review__th--photo">Evidencia</th>
                    <th className="draft-review__th draft-review__th--actions">Acciones</th>
                  </tr>
                </thead>
                <tbody className="draft-review__tbody">
                  {filteredIndices.map((index) => {
                    const complaint = complaintsList[index];
                    const row = rows[index];
                    let existing = null;
                    try { existing = findDraftHistory(history, complaint); } catch { /* Sin historial previo. */ }
                    const complaintId = complaint.id || complaintHistoryId(complaint);
                    const hasCandidates = (row?.candidates?.length > 0 || row?.photo);
                    const amountChanged = existing?.amount != null && existing.amount !== complaint.amount && complaint.amount != null;
                    const agg = (complaint.aggregator || '').toLowerCase();
                    const isPeYa = agg.includes('pedidosya');
                    const isRappi = agg.includes('rappi');
                    const isSelected = selected.has(index);

                    return (
                      <tr
                        className={`draft-review__tr${isSelected ? ' draft-review__tr--selected' : ''}`}
                        key={index}
                        data-selected={isSelected || undefined}
                      >
                        {/* Checkbox */}
                        <td className="draft-review__td draft-review__td--check">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => setSelected(old => {
                              const next = new Set(old);
                              if (next.has(index)) next.delete(index);
                              else next.add(index);
                              return next;
                            })}
                            aria-label={`Seleccionar pedido ${complaint.orderCode}`}
                          />
                        </td>

                        {/* Pedido / Fecha */}
                        <td className="draft-review__td draft-review__td--order">
                          <div className="draft-review__order-cell">
                            <span className="draft-review__order-code" title={complaint.orderCode}>
                              {complaint.orderCode}
                            </span>
                            <div className="draft-review__order-meta">
                              <span className={`draft-review__agg-tag ${isPeYa ? 'draft-review__agg-tag--pedidosya' : isRappi ? 'draft-review__agg-tag--rappi' : 'draft-review__agg-tag--default'}`}>
                                {getAggregatorLabel(complaint.aggregator)}
                              </span>
                              <span className="draft-review__date-tag">
                                {complaintDay(complaint) || 'Sin fecha'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Motivo y Detalle */}
                        <td className="draft-review__td draft-review__td--reason">
                          <div className="draft-review__reason-cell">
                            <div className="draft-review__reason-top">
                              {complaint.reason ? (
                                <span className="draft-review__reason-badge" title={complaint.reason}>
                                  {complaint.reason}
                                </span>
                              ) : (
                                <span className="draft-review__reason-badge draft-review__reason-badge--empty">
                                  Sin motivo
                                </span>
                              )}
                              {complaint.combo && (
                                <span className="draft-review__combo-badge" title={complaint.combo}>
                                  &#x1F4E6; {complaint.combo}
                                </span>
                              )}
                            </div>
                            {complaint.comment && (
                              <p className="draft-review__comment-text" title={complaint.comment}>
                                {complaint.comment}
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Monto */}
                        <td className="draft-review__td draft-review__td--amount">
                          <div className="draft-review__amount-cell">
                            {amountChanged && (
                              <s className="draft-review__amount-old" title="Monto anterior">
                                {formatMoney(existing.amount)}
                              </s>
                            )}
                            <strong className="draft-review__amount-val">
                              {complaint.amount == null
                                ? (existing?.amount == null ? '-' : formatMoney(existing.amount))
                                : formatMoney(complaint.amount)}
                            </strong>
                            {complaint.amount == null && existing?.amount != null && (
                              <span className="draft-review__amount-tag">conserva</span>
                            )}
                          </div>
                        </td>

                        {/* Evidencia / Foto */}
                        <td className="draft-review__td draft-review__td--photo">
                          <div className="draft-review__photo-cell">
                            {row?.photo ? (
                              <button
                                type="button"
                                className="draft-review__thumb-btn"
                                title="Click para ver foto ampliada"
                                onClick={() => setPhoto(row.photo)}
                              >
                                <img
                                  src={row.photo.public_url}
                                  alt={'Foto pedido ' + complaint.orderCode}
                                  loading="lazy"
                                  className="draft-review__thumb"
                                />
                              </button>
                            ) : (
                              <span
                                className="draft-review__no-photo-badge"
                                title={row?.status === 'ambiguous' ? 'Hay varias fotos coincidentes' : 'Sin foto cargada'}
                              >
                                {row?.status === 'ambiguous' ? 'Varias fotos' : 'Sin foto'}
                              </span>
                            )}

                            {hasCandidates && (
                              <select
                                aria-label={'Elegir foto para pedido ' + complaint.orderCode}
                                disabled={disabled}
                                className="draft-review__photo-picker"
                                value={draft.data.pickedPhotoIds?.[complaintId] || row?.photo?.id || ''}
                                onChange={e => act(() => updateDraft(draft, {
                                  pickedPhotoIds: {
                                    ...draft.data.pickedPhotoIds,
                                    [complaintId]: e.target.value || null
                                  }
                                }))}
                              >
                                <option value="">Auto</option>
                                {[...new Map(
                                  [...(row?.candidates || []), ...(row?.photo ? [row.photo] : [])].map(p => [p.id, p])
                                ).values()].map(p => (
                                  <option value={p.id} key={p.id}>
                                    {p.name} - {p.created_at?.slice(0, 10)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>

                        {/* Acciones */}
                        <td className="draft-review__td draft-review__td--actions">
                          <div className="draft-review__actions-cell">
                            <button
                              type="button"
                              className="draft-review__action-btn"
                              title="Corregir datos de este reclamo"
                              disabled={disabled}
                              onClick={() => setEditing({
                                index,
                                revision: draft.revision,
                                value: {
                                  ...complaint,
                                  day: complaintDay(complaint),
                                  amount: complaint.amount ?? ''
                                }
                              })}
                            >
                              &#9998;
                            </button>
                            <button
                              type="button"
                              className="draft-review__action-btn draft-review__action-btn--delete"
                              title="Quitar reclamo de la lista"
                              disabled={disabled}
                              onClick={() => act(() => updateDraft(draft, {
                                complaints: draft.data.complaints.filter((_, i) => i !== index)
                              }))}
                            >
                              &#215;
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {draft.data.report && (
            <p className="draft-review__metrics-note">
              Al guardar tambien se actualizaran las Metricas con las cifras del Excel.
            </p>
          )}

          {/* FOOTER BAR DOCKADO */}
          <footer className="draft-review__footer">
            <div className="draft-review__footer-info">
              <span className="draft-review__footer-main">
                {complaintsList.length} reclamo{complaintsList.length !== 1 ? 's' : ''} pendiente{complaintsList.length !== 1 ? 's' : ''} &middot; Total {formatMoney(totalAmount)}
              </span>
              <span className="draft-review__footer-sub">
                Al confirmar, se guardan en el Historial y se aplican las fotos vinculadas.
              </span>
            </div>
            <button
              type="button"
              className="btn btn--primary draft-review__btn-confirm-footer"
              disabled={disabled || Boolean(validation) || Boolean(editing)}
              onClick={() => act(async () => {
                const result = await confirmDraft(draft);
                onResolved?.();
                setNotice('Guardado: ' + result.added + ' nuevos y ' + result.updated + ' existentes. ' + (result.warning || ''));
              })}
            >
              {busy ? 'Guardando...' : 'Guardar en Historial'}
            </button>
          </footer>
        </>
      )}

      {/* MODAL PARA CORREGIR RECLAMO */}
      {editing && (
        <div className="release-modal" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title">
          <form
            className="release-modal__dialog draft-review__editor"
            aria-label="Corregir reclamo"
            onSubmit={e => {
              e.preventDefault();
              const value = editing.value;
              void patchRows((c, i) => i === editing.index ? {
                ...c,
                ...value,
                amount: value.amount === '' ? null : Number(value.amount),
                ...(value.day !== complaintDay(c) ? { orderAtIso: null, timeOfDay: null, dateAssumed: false } : {})
              } : c);
            }}
          >
            <div className="draft-review__editor-header">
              <h3 id="edit-dialog-title">Corregir reclamo</h3>
              <code className="draft-review__editor-code">{editing.value.orderCode}</code>
            </div>
            <div className="draft-review__editor-fields">
              {[
                ['orderCode', 'Codigo de pedido'],
                ['day', 'Fecha'],
                ['reason', 'Motivo'],
                ['comment', 'Comentario del cliente'],
                ['combo', 'Producto / Combo'],
                ['amount', 'Monto ($)']
              ].map(([key, label]) => (
                <label key={key} className="draft-review__editor-field">
                  <span className="draft-review__editor-label">{label}</span>
                  <input
                    required={['orderCode', 'day'].includes(key)}
                    type={key === 'day' ? 'date' : key === 'amount' ? 'number' : 'text'}
                    min={key === 'amount' ? 0 : undefined}
                    step={key === 'amount' ? '0.01' : undefined}
                    value={editing.value[key] || (key === 'amount' && editing.value[key] === 0 ? 0 : '')}
                    onChange={e => setEditing({
                      ...editing,
                      value: { ...editing.value, [key]: e.target.value }
                    })}
                  />
                </label>
              ))}
              <label className="draft-review__editor-field">
                <span className="draft-review__editor-label">Agregador</span>
                <select
                  required
                  value={editing.value.aggregator || ''}
                  onChange={e => setEditing({
                    ...editing,
                    value: { ...editing.value, aggregator: e.target.value }
                  })}
                >
                  <option value="">Elegir</option>
                  {AGGREGATOR_OPTIONS.map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="draft-review__editor-footer">
              <button type="submit" className="btn btn--primary" disabled={disabled}>
                Aplicar correccion
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* LIGHTBOX DE FOTO */}
      {photo && <PhotoLightbox photo={photo} onClose={() => setPhoto(null)} />}
    </section>
  );
}