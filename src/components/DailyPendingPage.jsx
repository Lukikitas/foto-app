import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGGREGATOR_OPTIONS } from '../lib/aggregators';
import { loadComplaintHistory, complaintHistoryReadStatus, subscribeComplaintHistory } from '../lib/complaintHistoryStore';
import { loadMetricsStore, saveMetricsStore } from '../lib/metricsStore';
import { argentinaToday, formatDayLabel, startOfMonth } from '../lib/metrics';
import { buildDailyPending, buildPendingManualLoad } from '../lib/dailyPending';
import { translatedReason } from '../lib/metricsQuality';
import AggregatorIdentity from './AggregatorIdentity';
import './DailyPendingPage.css';
import { loadPerformanceData } from '../lib/performanceData';
import { rememberMetricsView } from '../lib/metricsStore';

const DATA_SOURCE = { loadMetricsStore, saveMetricsStore, loadComplaintHistory, complaintHistoryReadStatus, subscribeComplaintHistory, loadPerformanceData };
const LOAD_LABELS = { missing: 'Sin cargar', complete: 'Datos guardados', not_applicable: 'Sin plataforma asignada' };
const money = value => value == null ? 'Sin monto' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

function CaseList({ items, analysis = false, onCase }) {
  return <ul className="pending__cases">{items.map(item => <li key={item.id}>
    <div className="pending__case-content"><div className="pending__case-heading"><strong>{item.orderCode}</strong><strong>{money(item.amount)}</strong></div>
    <div className="pending__case-indicators"><span className={`pending__detail-state pending__detail-state--${item.details.state}`}>{item.details.label}</span>
      <span className={item.details.excel ? 'pending__source pending__source--excel' : 'pending__source'}>{item.details.origin}{item.details.edited ? ' · editado' : ''}</span>
    </div>
    <p className="pending__case-reason">{translatedReason(item.reason)}{item.combo ? ` · ${item.combo}` : ''}</p>
    <div className="pending__case-meta">
      <span>{item.details.time}</span>
      {!analysis && <span className={item.daysLeft != null && item.daysLeft <= 3 ? 'pending__urgent' : ''}>
        {item.daysLeft == null ? 'Sin plazo límite' : item.daysLeft < 0 ? 'Queja vencida · revisar' : item.daysLeft === 0 ? 'Vence hoy' : `Vence en ${item.daysLeft} ${item.daysLeft === 1 ? 'día' : 'días'}`}
      </span>}
      {!analysis && !item.photoId && !item.photoUrl && <span>Sin evidencia asociada</span>}
    </div>
    {item.details.comment && <p className="pending__comment" title={item.details.comment}>{item.details.comment}</p>}
    {item.details.state !== 'complete' && <span className="pending__missing-details">Falta: {item.details.missing.join(', ')}.</span>}
    </div><button className="btn btn--ghost btn--small" aria-label={`${analysis ? 'Revisar respuesta' : 'Gestionar queja'} ${item.orderCode}`} onClick={() => onCase(item)}>Ver caso</button>
  </li>)}</ul>;
}

function PlatformDetail({ group, day, onLoadDay, onLoadComplaints, onCase, form, onField, onSave, saving, formError }) {
  return <section className="pending__platform" aria-label={`${group.label} · ${day}`}>
    <header><AggregatorIdentity aggregator={group.id} label={group.label}><span className={`pending__load pending__load--${group.load.state}`}>{LOAD_LABELS[group.load.state]}</span></AggregatorIdentity>
      {group.details.total > 0 && <span className="pending__detail-overview">{group.details.complete}/{group.details.total} quejas con detalles cargados{group.details.marked > 0 && ` · ${group.details.marked} solo marcadas`}</span>}
    </header>
    {group.load.state === 'complete' && <div className="pending__saved-values">{group.origin.entries.map(entry => <span key={entry.key}><span>{entry.label}</span><strong>{group.stats.reported?.[entry.key] === false ? 'Sin dato' : group.stats[entry.key]?.toLocaleString('es-AR') ?? 'Sin dato'}</strong></span>)}
      <button className="btn btn--ghost btn--small" onClick={() => onLoadDay(day, group.id)}>Editar datos</button>
    </div>}
    {group.load.state === 'missing' && <form className="pending__inline-form" onSubmit={event => { event.preventDefault(); void onSave(day, group.id); }} aria-label={`Cargar ${group.label} del ${day}`}>
      <p>No hay datos guardados. Cargá solo {group.label} para este día.</p><div className="pending__inline-fields">
        {['orders', 'complaints', ...(group.id === 'pedidosya' ? ['awt'] : [])].map(key => <label key={key}>{({ orders: 'Pedidos', complaints: 'Quejas', awt: 'AWT (demorados)' })[key]}
          <input type="number" min="0" step="1" required disabled={saving} value={form?.fields[key] ?? ''} placeholder="0" onInput={event => onField(day, group.id, key, event.target.value)} onChange={event => onField(day, group.id, key, event.target.value)} />
        </label>)}
        <button className="btn btn--primary btn--small" disabled={saving}>{saving ? 'Guardando…' : 'Guardar carga'}</button>
        {['pedidosya', 'rappi', 'rappi_turbo'].includes(group.id) && <button type="button" className="btn btn--ghost btn--small" disabled={saving} onClick={() => onLoadDay(day, group.id, 'excel')}>Importar Excel</button>}
      </div>{formError && <p role="alert" className="message message--error">{formError}</p>}
    </form>}
    {group.missingHistory > 0 ? <div className="pending__history-gap" role="status"><p><strong>{group.missingHistory} {group.missingHistory === 1 ? 'reclamo por cargar en historial' : 'reclamos por cargar en historial'}.</strong> {group.reportedComplaints} quejas informadas y {group.historyCases} casos registrados para este día y agregador.</p>
      <button className="btn btn--ghost btn--small" onClick={() => ['pedidosya', 'rappi', 'rappi_turbo'].includes(group.id) ? onLoadDay(day, group.id, 'excel') : onLoadComplaints?.(day, group.id)}>{['pedidosya', 'rappi', 'rappi_turbo'].includes(group.id) ? 'Importar reclamos de Excel' : 'Cargar reclamos'}</button>
    </div> : group.discrepancy && <p className="pending__data-difference">{group.reportedComplaints} quejas informadas y {group.historyCases} casos en historial. No faltan casos por registrar.</p>}
    {group.load.state === 'complete' && <div className="pending__origin-fields" aria-label={`Origen de los datos de ${group.label}`}>
      {group.origin.entries.map(entry => <span key={entry.key}><strong>{entry.label}</strong><span className={entry.source.startsWith('excel_') ? 'pending__source pending__source--excel' : 'pending__source'}>{entry.origin}</span></span>)}
    </div>}
    <div className="pending__work-columns">
      <section><h4>Quejas sin refutar <span>{group.unrefuted.length}</span></h4>
        {group.unrefuted.length ? <CaseList items={group.unrefuted} onCase={onCase} /> : <p className="pending__empty-group">Sin quejas abiertas registradas.</p>}
      </section>
      <section><h4>Refutados en análisis <span>{group.inAnalysis.length}</span></h4>
        {group.inAnalysis.length ? <CaseList items={group.inAnalysis} analysis onCase={onCase} /> : <p className="pending__empty-group">Sin respuestas pendientes registradas.</p>}
      </section>
    </div>
  </section>;
}

function PlatformCounts({ groups, field }) {
  const pending = groups.filter(group => group[field].length);
  return <span className="pending__platform-counts">{pending.length ? pending.map(group => <span key={group.id}>{group.label}: <strong>{group[field].length}</strong></span>) : <span className="pending__quiet">Ninguno</span>}</span>;
}

export default function DailyPendingPage({ active = true, onLoadDay, onLoadComplaints, onCase, onDirtyChange, dataSource = DATA_SOURCE, now }) {
  const [today, setToday] = useState(() => argentinaToday(now));
  const [from, setFrom] = useState(() => startOfMonth(argentinaToday(now)));
  const [to, setTo] = useState(() => argentinaToday(now));
  const [aggregator, setAggregator] = useState('all');
  const [onlyPending, setOnlyPending] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readAt, setReadAt] = useState(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState({});
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [saveNotice, setSaveNotice] = useState('');
  const busy = useRef(false);
  const saving = useRef(false);
  const readSequence = useRef(0);
  const alive = useRef(true);
  const scrollPosition = useRef(0);
  const requestController = useRef(null);

  useEffect(() => { onDirtyChange?.(Object.keys(drafts).length > 0); return () => onDirtyChange?.(false); }, [drafts, onDirtyChange]);
  useEffect(() => {
    const warn = event => { if (Object.keys(drafts).length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);

  function changeField(day, id, field, value) {
    const key = `${day}|${id}`;
    setDrafts(current => ({ ...current, [key]: { base: current[key]?.base || snapshot.metrics,
      fields: { ...current[key]?.fields, [field]: value } } }));
    setSaveNotice('');
  }
  async function saveDay(day, id) {
    const key = `${day}|${id}`;
    const draft = drafts[key];
    if (!draft || saving.current) return;
    saving.current = true;
    setSavingKey(key); setFormErrors(current => ({ ...current, [key]: '' }));
    try {
      const next = buildPendingManualLoad(draft.base, day, id, draft.fields, today);
      const saved = await dataSource.saveMetricsStore(next);
      if (alive.current) {
        readSequence.current += 1;
        setSnapshot(current => ({ ...current, metrics: saved, report: null }));
        setDrafts(current => { const copy = { ...current }; delete copy[key]; return copy; });
        setSaveNotice(`Carga guardada · ${AGGREGATOR_OPTIONS.find(option => option.id === id)?.label} · ${formatDayLabel(day)}.`);
      }
    } catch (err) { if (alive.current) setFormErrors(current => ({ ...current, [key]: err.message || 'No se pudo guardar. Se conserva la carga para reintentar.' })); }
    finally { saving.current = false; if (alive.current) { setSavingKey(''); if (dataSource.loadPerformanceData) void refresh(); } }
  }

  const refresh = useCallback(async () => {
    if (saving.current || !active) return;
    const key = `${from}|${to}|${aggregator}`;
    if (busy.current === key) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const sequence = ++readSequence.current;
    busy.current = key;
    setLoading(true);
    try {
      if (dataSource.loadPerformanceData) {
        const result = await dataSource.loadPerformanceData({ view: 'pending', from, to, aggregator }, { signal: controller.signal });
        if (alive.current && sequence === readSequence.current) { setSnapshot({ ...result, metrics: rememberMetricsView(result.metrics), key }); setError(''); setReadAt(new Date()); }
        return;
      }
      const [metrics, history] = await Promise.all([
        dataSource.loadMetricsStore({ strict: true }), dataSource.loadComplaintHistory({ force: true, strict: true }),
      ]);
      if (dataSource.complaintHistoryReadStatus?.().cached) throw new Error('No se pudo verificar el historial en el servidor.');
      if (alive.current && sequence === readSequence.current) { setSnapshot({ metrics, history }); setError(''); setReadAt(new Date()); }
    } catch (err) {
      if (!controller.signal.aborted && alive.current && sequence === readSequence.current) setError(err.message || 'No se pudieron verificar los pendientes.');
    } finally {
      if (sequence === readSequence.current) { busy.current = false; if (alive.current) setLoading(false); }
    }
  }, [dataSource, from, to, aggregator, active]);

  useEffect(() => {
    alive.current = true;
    const off = active ? dataSource.subscribeComplaintHistory?.(history => {
      if (dataSource.loadPerformanceData) { void refresh(); return; }
      setSnapshot(current => current ? { ...current, history } : current);
    }) : undefined;
    return () => { alive.current = false; requestController.current?.abort(); off?.(); };
  }, [dataSource, active, refresh]);

  useEffect(() => {
    if (!active) return;
    function update() {
      if (document.visibilityState === 'hidden') return;
      const nextToday = argentinaToday(now);
      if (today !== nextToday) { setToday(nextToday); setTo(current => current === today ? nextToday : current); }
      void refresh();
    }
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: scrollPosition.current, behavior: 'instant' });
      update();
    }, 0);
    const interval = window.setInterval(update, 30_000);
    const rememberScroll = () => { scrollPosition.current = window.scrollY; };
    window.addEventListener('scroll', rememberScroll);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearTimeout(timer); window.clearInterval(interval);
      window.removeEventListener('scroll', rememberScroll);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [active, refresh, now, today]);

  const report = useMemo(() => snapshot?.report && snapshot.key === `${from}|${to}|${aggregator}` ? snapshot.report : snapshot?.history ? buildDailyPending({ ...snapshot, from, to, aggregator, today }) : null,
    [snapshot, from, to, aggregator, today]);
  const days = report?.days.filter(day => !onlyPending || day.hasPending || day.inProgress) || [];

  function showAllPending() {
    setFrom(report.start || startOfMonth(today)); setTo(today); setOnlyPending(true);
  }
  function changeRange(setter, value) { setter(value); }

  return <section className="pending" aria-label="Pendientes por día">
    <header className="pending__header"><div><span className="pending__eyebrow">Control diario del local</span>
      <h2>Pendientes de hoy</h2><p>Revisá cada día: datos cargados, quejas sin refutar y refutados en análisis.</p>
    </div><button className="btn btn--ghost" disabled={loading} onClick={refresh}>{loading ? 'Verificando…' : 'Actualizar'}</button></header>
    <div className="pending__filters">
      <label>Desde<input type="date" value={from} max={today} onInput={event => changeRange(setFrom, event.target.value)} onChange={event => changeRange(setFrom, event.target.value)} /></label>
      <label>Hasta<input type="date" value={to} max={today} onInput={event => changeRange(setTo, event.target.value)} onChange={event => changeRange(setTo, event.target.value)} /></label>
      <label>Agregador<select value={aggregator} onChange={event => setAggregator(event.target.value)}><option value="all">Todos</option>{AGGREGATOR_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label className="pending__toggle"><input type="checkbox" checked={onlyPending} onChange={event => setOnlyPending(event.target.checked)} />Solo días con pendientes</label>
      <button className="btn btn--ghost btn--small" onClick={showAllPending} disabled={!report?.start}>Todo el historial</button>
    </div>
    {saveNotice && <p role="status" className="message message--success">{saveNotice}</p>}
    {error ? <div className="message message--error" role="alert"><strong>No se pudo verificar</strong><p>{error} Volvé a actualizar. No se puede confirmar que el trabajo esté completo.</p></div> : !report ? <p role="status">Verificando datos compartidos…</p> : !report.validRange ? <p className="message message--error" role="alert">Elegí un rango válido, hasta hoy inclusive.</p> : <>
      <div className="pending__totals" aria-label="Resumen del período">
        <article><strong>{report.totals.missingDays}</strong><span>Días con datos por cargar</span><small>Incluye hoy, todavía en curso</small></article>
        <article><strong>{report.totals.unrefuted}</strong><span>Quejas sin refutar</span><small>Incluye vencidas para revisión</small></article>
        <article><strong>{report.totals.inAnalysis}</strong><span>Refutados en análisis</span><small>Esperan aceptación o rechazo</small></article>
        <article><strong>{report.totals.missingHistory}</strong><span>Reclamos sin historial</span><small>Informados, pendientes de registrar</small></article>
      </div>
      {report.outside.length > 0 && <aside className="pending__outside" role="status"><div><strong>Hay {report.outside.length} {report.outside.length === 1 ? 'día pendiente' : 'días pendientes'} fuera de este período.</strong>
        <p>{report.outsideTotals.missingDays} con datos sin cargar · {report.outsideTotals.unrefuted} quejas sin refutar · {report.outsideTotals.inAnalysis} refutados en análisis · {report.outsideTotals.missingHistory} reclamos sin historial.</p>
      </div><button className="btn btn--ghost btn--small" onClick={showAllPending}>Ver todos los pendientes</button></aside>}
      {report.undated.length > 0 && <details className="pending__undated"><summary><strong>{report.undated.length} {report.undated.length === 1 ? 'caso pendiente' : 'casos pendientes'} sin fecha válida.</strong><span> Ver casos ▾</span></summary><p>Completá la fecha para incluirlos en el control diario.</p><div>
        {report.undated.map(item => <button key={item.id} className="btn btn--ghost btn--small" onClick={() => onCase(item)}>Revisar {item.orderCode}</button>)}
      </div></details>}
      <p className="pending__explanation">Ordenados del más antiguo al más reciente · Fecha del pedido, en Argentina. Si el agregador tiene datos guardados, su carga no está pendiente. El día de hoy sigue en curso.</p>
      {days.length ? <div className="pending__days"><div className="pending__columns" aria-hidden="true"><span>Día y situación</span><span>Carga por plataforma</span><span>Trabajo pendiente</span></div>
        {days.map(day => <article className={`pending__day pending__day--${day.inProgress ? 'today' : day.unrefuted ? 'attention' : day.hasPending ? 'waiting' : 'complete'}${selectedPlatforms[day.day] ? ' pending__day--open' : ''}`} key={day.day}>
          <header className="pending__day-header"><span className="pending__date"><strong>{formatDayLabel(day.day)}</strong>
            <span className={day.inProgress ? 'pending__info' : day.hasPending ? 'pending__urgent' : 'pending__success'}>{day.inProgress ? 'Hoy · en curso' : day.hasPending ? 'Requiere atención' : 'Sin pendientes registrados'}</span>
            <button className="pending__day-toggle" aria-expanded={Boolean(selectedPlatforms[day.day])} aria-controls={`pending-day-${day.day}`} onClick={() => setSelectedPlatforms(current => ({ ...current,
              [day.day]: current[day.day] ? null : (day.groups.find(group => group.missingHistory || group.unrefuted.length || group.inAnalysis.length || group.load.state === 'missing') || day.groups[0]).id,
            }))}>{selectedPlatforms[day.day] ? 'Cerrar detalle' : 'Desplegar día'}</button>
          </span><span className="pending__load-summary">{day.groups.map(group => <button type="button" key={group.id} className={`pending__platform-tile pending__platform-tile--${group.load.state}${selectedPlatforms[day.day] === group.id ? ' is-selected' : ''}`}
            aria-label={`${group.label} · ${formatDayLabel(day.day)} · ${LOAD_LABELS[group.load.state]}`} aria-expanded={selectedPlatforms[day.day] === group.id} aria-controls={`pending-day-${day.day}`}
            onClick={() => setSelectedPlatforms(current => ({ ...current, [day.day]: current[day.day] === group.id ? null : group.id }))}>
            <AggregatorIdentity aggregator={group.id} label={group.label} compact><span className={`pending__load pending__load--${group.load.state}`}>{LOAD_LABELS[group.load.state]}</span>
              {group.load.state === 'complete' && <span className={`pending__source pending__source--${group.origin.kind}`} title={group.origin.label}>{group.origin.shortLabel}</span>}
              {group.missingHistory > 0 && <span className="pending__draft-badge">{group.missingHistory} sin historial</span>}
              {drafts[`${day.day}|${group.id}`] && <span className="pending__draft-badge">Borrador sin guardar</span>}
            </AggregatorIdentity>
          </button>)}</span>
            <span className="pending__work-summary"><span><strong>Sin refutar <b>{day.unrefuted}</b></strong><PlatformCounts groups={day.groups} field="unrefuted" /></span>
              <span><strong>En análisis <b>{day.inAnalysis}</b></strong><PlatformCounts groups={day.groups} field="inAnalysis" /></span>
              {day.missingHistory > 0 && <span className="pending__missing-details">{day.missingHistory} {day.missingHistory === 1 ? 'reclamo sin historial' : 'reclamos sin historial'}</span>}
              {day.details.total > 0 && <span className="pending__details-count" title="Información de todos los reclamos registrados en este día"><span>Detalles: {day.details.complete}/{day.details.total} cargados</span>{day.details.marked > 0 && <span>{day.details.marked} solo {day.details.marked === 1 ? 'marcada' : 'marcadas'}</span>}</span>}
            </span>
          </header>
          <div id={`pending-day-${day.day}`} hidden={!selectedPlatforms[day.day]} className="pending__day-detail">{day.groups.filter(group => selectedPlatforms[day.day] === group.id).map(group => <PlatformDetail key={group.id} group={group} day={day.day} onLoadDay={onLoadDay} onLoadComplaints={onLoadComplaints} onCase={onCase}
            form={drafts[`${day.day}|${group.id}`]} onField={changeField} onSave={saveDay} saving={Boolean(savingKey)} formError={formErrors[`${day.day}|${group.id}`]} />)}</div>
        </article>)}
      </div> : <div className="pending__empty"><strong>{report.start ? 'Sin pendientes registrados en este período' : 'Todavía no hay actividad registrada'}</strong><p>{report.start ? 'Podés desactivar el filtro para revisar todos los días.' : 'Los días se controlarán desde la primera carga o reclamo registrado.'}</p></div>}
      <footer className="pending__footer">{readAt && `Verificado ${readAt.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}. `}Actualización automática mientras esta vista está abierta. Las refutaciones aceptadas, rechazadas y no refutables no son tareas abiertas.</footer>
    </>}
  </section>;
}
