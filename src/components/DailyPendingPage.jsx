import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGGREGATOR_OPTIONS } from '../lib/aggregators';
import { loadComplaintHistory, complaintHistoryReadStatus, subscribeComplaintHistory } from '../lib/complaintHistoryStore';
import { loadMetricsStore } from '../lib/metricsStore';
import { argentinaToday, formatDayLabel, startOfMonth } from '../lib/metrics';
import { buildDailyPending } from '../lib/dailyPending';
import { translatedReason } from '../lib/metricsQuality';
import './DailyPendingPage.css';

const DATA_SOURCE = { loadMetricsStore, loadComplaintHistory, complaintHistoryReadStatus, subscribeComplaintHistory };
const LOAD_LABELS = { missing: 'Sin cargar', complete: 'Datos guardados', not_applicable: 'Sin plataforma asignada' };
const money = value => value == null ? 'Sin monto' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);

function CaseList({ items, analysis = false, onCase }) {
  return <ul className="pending__cases">{items.map(item => <li key={item.id}>
    <div><strong>{item.orderCode}</strong><span>{translatedReason(item.reason)}</span></div>
    <div className="pending__case-meta"><strong>{money(item.amount)}</strong>
      {!analysis && <span className={item.daysLeft != null && item.daysLeft <= 3 ? 'pending__urgent' : ''}>
        {item.daysLeft == null ? 'Sin plazo límite' : item.daysLeft < 0 ? 'Queja vencida · revisar' : item.daysLeft === 0 ? 'Vence hoy' : `Vence en ${item.daysLeft} ${item.daysLeft === 1 ? 'día' : 'días'}`}
      </span>}
      {!analysis && !item.photoId && !item.photoUrl && <span>Sin evidencia asociada</span>}
    </div>
    <button className="btn btn--ghost btn--small" onClick={() => onCase(item)}>
      {analysis ? 'Revisar respuesta' : item.daysLeft != null && item.daysLeft < 0 ? 'Revisar caso' : 'Gestionar queja'}
    </button>
  </li>)}</ul>;
}

function PlatformDetail({ group, day, onLoadDay, onCase }) {
  return <section className="pending__platform" aria-label={`${group.label} · ${day}`}>
    <header><h3>{group.label}</h3><span className={`pending__load pending__load--${group.load.state}`}>{LOAD_LABELS[group.load.state]}</span></header>
    {group.id !== 'unknown' && <div className="pending__data-action">
      <div>{group.load.state === 'missing' && <p>No hay datos guardados para este día y agregador.</p>}
        {group.discrepancy && <p className="pending__warning">{group.reportedComplaints} quejas informadas y {group.historyCases} casos en historial. Son fuentes distintas; revisá la diferencia.</p>}
      </div><button className="btn btn--ghost btn--small" onClick={() => onLoadDay(day, group.id)}>
        {group.load.state === 'complete' ? 'Ver datos del día' : 'Completar datos'}
      </button>
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

export default function DailyPendingPage({ active = true, onLoadDay, onCase, dataSource = DATA_SOURCE, now }) {
  const [today, setToday] = useState(() => argentinaToday(now));
  const [from, setFrom] = useState(() => startOfMonth(argentinaToday(now)));
  const [to, setTo] = useState(() => argentinaToday(now));
  const [aggregator, setAggregator] = useState('all');
  const [onlyPending, setOnlyPending] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [readAt, setReadAt] = useState(null);
  const [openDays, setOpenDays] = useState(() => new Set());
  const busy = useRef(false);
  const alive = useRef(true);
  const scrollPosition = useRef(0);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const [metrics, history] = await Promise.all([
        dataSource.loadMetricsStore({ strict: true }), dataSource.loadComplaintHistory({ force: true, strict: true }),
      ]);
      if (dataSource.complaintHistoryReadStatus?.().cached) throw new Error('No se pudo verificar el historial en el servidor.');
      if (alive.current) { setSnapshot({ metrics, history }); setError(''); setReadAt(new Date()); }
    } catch (err) {
      if (alive.current) setError(err.message || 'No se pudieron verificar los pendientes.');
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }, [dataSource]);

  useEffect(() => {
    alive.current = true;
    const off = dataSource.subscribeComplaintHistory?.(history => setSnapshot(current => current ? { ...current, history } : current));
    return () => { alive.current = false; off?.(); };
  }, [dataSource]);

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

  const report = useMemo(() => snapshot ? buildDailyPending({ ...snapshot, from, to, aggregator, today }) : null,
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
    {error ? <div className="message message--error" role="alert"><strong>No se pudo verificar</strong><p>{error} Volvé a actualizar. No se puede confirmar que el trabajo esté completo.</p></div> : !report ? <p role="status">Verificando datos compartidos…</p> : !report.validRange ? <p className="message message--error" role="alert">Elegí un rango válido, hasta hoy inclusive.</p> : <>
      <div className="pending__totals" aria-label="Resumen del período">
        <article><strong>{report.totals.missingDays}</strong><span>Días con datos por cargar</span><small>Incluye hoy, todavía en curso</small></article>
        <article><strong>{report.totals.unrefuted}</strong><span>Quejas sin refutar</span><small>Incluye vencidas para revisión</small></article>
        <article><strong>{report.totals.inAnalysis}</strong><span>Refutados en análisis</span><small>Esperan aceptación o rechazo</small></article>
      </div>
      {report.outside.length > 0 && <aside className="pending__outside" role="status"><div><strong>Hay {report.outside.length} {report.outside.length === 1 ? 'día pendiente' : 'días pendientes'} fuera de este período.</strong>
        <p>{report.outsideTotals.missingDays} con datos sin cargar · {report.outsideTotals.unrefuted} quejas sin refutar · {report.outsideTotals.inAnalysis} refutados en análisis.</p>
      </div><button className="btn btn--ghost btn--small" onClick={showAllPending}>Ver todos los pendientes</button></aside>}
      {report.undated.length > 0 && <details className="pending__undated"><summary><strong>{report.undated.length} {report.undated.length === 1 ? 'caso pendiente' : 'casos pendientes'} sin fecha válida.</strong><span> Ver casos ▾</span></summary><p>Completá la fecha para incluirlos en el control diario.</p><div>
        {report.undated.map(item => <button key={item.id} className="btn btn--ghost btn--small" onClick={() => onCase(item)}>Revisar {item.orderCode}</button>)}
      </div></details>}
      <p className="pending__explanation">Ordenados del más antiguo al más reciente · Fecha del pedido, en Argentina. Si el agregador tiene datos guardados, su carga no está pendiente. El día de hoy sigue en curso.</p>
      {days.length ? <div className="pending__days"><div className="pending__columns" aria-hidden="true"><span>Día y situación</span><span>Datos cargados</span><span>Quejas sin refutar</span><span>Refutados en análisis</span></div>
        {days.map(day => <details className="pending__day" key={day.day} open={openDays.has(day.day)} onToggle={event => {
          const open = event.currentTarget.open;
          setOpenDays(current => { if (current.has(day.day) === open) return current; const next = new Set(current); if (open) next.add(day.day); else next.delete(day.day); return next; });
        }}>
          <summary><span className="pending__date"><strong>{formatDayLabel(day.day)}</strong>
            <span className={day.inProgress ? 'pending__info' : day.hasPending ? 'pending__urgent' : 'pending__success'}>{day.inProgress ? 'Hoy · en curso' : day.hasPending ? 'Requiere atención' : 'Sin pendientes registrados'}</span><small>Desplegar día</small>
          </span><span className="pending__load-summary">{day.groups.filter(group => group.id !== 'unknown').map(group => <span key={group.id} className={`pending__load pending__load--${group.load.state}`}>{group.label} · {LOAD_LABELS[group.load.state]}</span>)}</span>
            <PlatformCounts groups={day.groups} field="unrefuted" /><PlatformCounts groups={day.groups} field="inAnalysis" />
          </summary>
          <div className="pending__day-detail">{day.groups.map(group => <PlatformDetail key={group.id} group={group} day={day.day} onLoadDay={onLoadDay} onCase={onCase} />)}</div>
        </details>)}
      </div> : <div className="pending__empty"><strong>{report.start ? 'Sin pendientes registrados en este período' : 'Todavía no hay actividad registrada'}</strong><p>{report.start ? 'Podés desactivar el filtro para revisar todos los días.' : 'Los días se controlarán desde la primera carga o reclamo registrado.'}</p></div>}
      <footer className="pending__footer">{readAt && `Verificado ${readAt.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}. `}Actualización automática mientras esta vista está abierta. Las refutaciones aceptadas, rechazadas y no refutables no son tareas abiertas.</footer>
    </>}
  </section>;
}
