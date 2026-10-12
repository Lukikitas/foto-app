import MetricsQualityPanel from './MetricsQualityPanel';
import { buildMetricsQuality } from '../lib/metricsQuality';
import { useMemo } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { groupHistoryFlags } from '../lib/complaintHistory';
import TrendCard from './TrendCard';
import {
  argentinaToday,
  AWT_AGGREGATOR,
  METRIC_AGGREGATORS,
  PERIOD_PRESETS,
  compareSummaries,
  formatDayLabel,
  formatKnownMoney,
  formatMoney,
  formatNumber,
  formatPct,
  isOutOfTarget,
  previousPeriod,
  summarizeRange,
} from '../lib/metrics';
function formatDelta(value, { pct = false, money = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const formatted = money ? formatMoney(Math.abs(value)) : pct ? formatPct(Math.abs(value)) : formatNumber(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function SheetStat({ label, value, hint, tone, onClick }) {
  return (
    <div className={`metrics-sheet__row${tone ? ` metrics-sheet__row--${tone}` : ''}${onClick ? ' metrics-sheet__row--link' : ''}`} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={event => { if (onClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <em>{hint}</em> : null}
    </div>
  );
}

export function MetricsPeriodBar({
  preset,
  customFrom,
  customTo,
  period,
  endsAtLastLoadedDay = false,
  focusDay,
  aggregator,
  onPreset,
  onCustomFrom,
  onCustomTo,
  onAggregator,
  onClearDay,
}) {
  return (
    <div className="metrics-toolbar">
      <div className="filter-cluster">
        <span className="filter-cluster__label">Período</span>
        <div className="filter-row filter-row--joined" role="group" aria-label="Período">
          {PERIOD_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`filter-row__btn${preset === item.id && !focusDay ? ' filter-row__btn--active' : ''}`}
              onClick={() => onPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {preset === 'custom' && (
        <div className="metrics-range">
          <label>
            Desde
            <input type="date" max={argentinaToday()} value={customFrom || period.from} onChange={(e) => onCustomFrom(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" max={argentinaToday()} value={customTo || period.to} onChange={(e) => onCustomTo(e.target.value)} />
          </label>
        </div>
      )}
      <div className="filter-cluster">
        <span className="filter-cluster__label">Agregador</span>
        <div className="filter-row" role="group" aria-label="Agregador">
          <button
            type="button"
            className={`filter-row__btn${aggregator === 'all' ? ' filter-row__btn--active' : ''}`}
            onClick={() => onAggregator('all')}
          >
            Todos
          </button>
          {METRIC_AGGREGATORS.map((id) => (
            <button
              key={id}
              type="button"
              className={`filter-row__btn${aggregator === id ? ' filter-row__btn--active' : ''}`}
              data-agg={id}
              onClick={() => onAggregator(id)}
            >
              {getAggregatorLabel(id)}
            </button>
          ))}
        </div>
      </div>
      {preset==="custom" && customFrom>customTo && <p className="message message--error" role="alert">Desde es posterior a Hasta; el rango se muestra en orden cronológico. Revisá las fechas.</p>}
      <p className="metrics-period-label">
        {focusDay ? (
          <>
            {formatDayLabel(focusDay)}
            <button type="button" className="btn btn--ghost btn--small" onClick={onClearDay}>
              Ver período
            </button>
          </>
        ) : (
          <>
            {formatDayLabel(period.from)}
            {period.from !== period.to ? ` → ${formatDayLabel(period.to)}` : ''}
            {endsAtLastLoadedDay && ' · Hasta el último día con datos'}
          </>
        )}
      </p>
    </div>
  );
}


export default function MetricsDashboard({ store, history, period, focusDay, aggregator, onChangeView, onFocusDay, onAggregator, onCases, preset }) {
  const range = focusDay ? {from:focusDay,to:focusDay} : period;
  const previous = previousPeriod(range.from, range.to, focusDay ? '' : preset);
  const flags = useMemo(() => groupHistoryFlags(history, previous.from, range.to, {refutadoDays:store.refutadoDays}), [history,previous.from,range.to,store.refutadoDays]);
  const current = summarizeRange(store, {}, range.from, range.to, flags);
  const before = summarizeRange(store, {}, previous.from, previous.to, flags);
  const item = aggregator === 'all' ? current.overall : current.aggregators.find(row=>row.id===aggregator);
  const prev = aggregator === 'all' ? before.overall : before.aggregators.find(row=>row.id===aggregator);
  const compared = compareSummaries(item, prev, store.targetComplaintPct, store.targetAwtPct);
  const quality = buildMetricsQuality(store, history, range, aggregator);
  const prevQuality = buildMetricsQuality(store, history, previous, aggregator);
  const comparisonWarning = quality.missing || quality.partial || prevQuality.missing || prevQuality.partial ||
    current.days.length !== before.days.length;
  const showAwt = aggregator === 'all' || aggregator === AWT_AGGREGATOR;
  const hasData = item.orders > 0 || item.historyCount > 0 || quality.rows.some(row=>row.state!=='missing');
  const pctHint = item.complaintPct == null ? 'Faltan pedidos para calcular la tasa' :
    'Objetivo ' + formatPct(store.targetComplaintPct) + ' · ' + formatDelta(item.complaintPct-store.targetComplaintPct,{pct:true}).replace('%',' pp');
  return <div className="metrics-dash">
    <div className="metrics-sheet">
      <section className="metrics-sheet__group"><h3>Operación</h3>
        <SheetStat label="Pedidos informados" value={formatNumber(item.orders)} hint="Totales diarios cargados"/>
        <SheetStat label="Quejas informadas" value={formatNumber(item.complaints)} hint="Totales diarios; pueden diferir del historial" onClick={()=>onCases('all')}/>
        <SheetStat label="Casos en historial" value={formatNumber(item.historyCount)} hint="Reclamos con registro individual" onClick={()=>onCases('all')}/>
        <SheetStat label="% quejas" value={formatPct(item.complaintPct)} hint={pctHint} tone={isOutOfTarget(item.complaintPct,store.targetComplaintPct)?'bad':item.orders?'good':undefined}/>
        {showAwt && <SheetStat label="AWT PedidosYa" value={formatPct(item.awtPct)} hint={'Solo pedidos de PedidosYa · objetivo '+formatPct(store.targetAwtPct)} tone={isOutOfTarget(item.awtPct,store.targetAwtPct)?'bad':undefined}/>}
      </section>
      <section className="metrics-sheet__group"><h3>Dinero · importes conocidos</h3>
        <SheetStat label="Reclamado" value={formatKnownMoney(item.complaintAmount,item.missingMoney?.complaintAmount)} hint={item.missingAmountCount ? item.missingAmountCount+' casos sin monto; total parcial':'Importes del historial'}/>
        <SheetStat label="Recuperado" value={formatKnownMoney(item.recoveredAmount,item.missingMoney?.recoveredAmount)} hint="Según estado Ref. aceptado" tone="good" onClick={()=>onCases('refutado_aceptado')}/>
        <SheetStat label="En disputa" value={formatKnownMoney(item.inProgressAmount,item.missingMoney?.inProgressAmount)} hint="Refutaciones pendientes" onClick={()=>onCases('refutado')}/>
        <SheetStat label="Pendiente de refutar" value={formatKnownMoney(item.pendingAmount,item.missingMoney?.pendingAmount)} hint="Quejas abiertas dentro del plazo" onClick={()=>onCases('pending')}/>
        <SheetStat label="Pérdida confirmada" value={formatKnownMoney(item.finalLostAmount,item.missingMoney?.finalLostAmount)} hint="Rechazados, no refutables y vencidos" tone={item.finalLostAmount>0?'bad':undefined} onClick={()=>onCases('lost')}/>
        <SheetStat label="Total no recuperado" value={formatKnownMoney(item.lostAmount,item.missingMoney?.lostAmount)} hint="Cálculo anterior: pérdida confirmada + pendiente de refutar"/>
      </section>
    </div>
    <div className="metrics-comparison">
      <strong>Comparación: {formatDayLabel(range.from)} → {formatDayLabel(range.to)} contra {formatDayLabel(previous.from)} → {formatDayLabel(previous.to)}</strong>
      <p>{formatDelta(compared.orders)} pedidos · {formatDelta(compared.complaints)} quejas informadas · {formatDelta(compared.complaintPct,{pct:true}).replace('%',' pp')}</p>
      {comparisonWarning && <p>⚠ Hay diferencias de duración o cargas incompletas: la variación no representa una comparación completa.</p>}
      {quality.legacy>0 || prevQuality.legacy>0 ? <p>Las cargas anteriores no permiten comprobar la completitud por campo.</p>:null}
    </div>
    {hasData && <TrendCard store={store} history={history} range={range} aggregator={aggregator} preset={focusDay?'':preset} showSummary={false}/>}
    <div className="metrics-aggs metrics-aggs--hero">{current.aggregators.map(row=><button key={row.id} className={'metrics-agg metrics-agg--hero'+(aggregator===row.id?' is-selected':'')} aria-pressed={aggregator===row.id} onClick={()=>onAggregator(aggregator===row.id?'all':row.id)}>
      <h3>{getAggregatorLabel(row.id)}</h3><p className={'metrics-agg__pct'+(isOutOfTarget(row.complaintPct,store.targetComplaintPct)?' is-bad':'')}>{formatPct(row.complaintPct)}</p>
      <p className="metrics-agg__pct-label">Quejas informadas sobre pedidos</p><p className="metrics-agg__meta">{formatNumber(row.orders)} pedidos · {formatNumber(row.complaints)} quejas informadas</p>
      <p className="metrics-agg__meta">{formatNumber(row.historyCount)} casos · {formatKnownMoney(row.recoveredAmount,row.missingMoney?.recoveredAmount)} recuperado</p>
    </button>)}</div>
    {!hasData && <div className="gallery__state"><p>No hay datos cargados para este filtro.</p><button className="btn btn--primary" onClick={()=>onChangeView('entry')}>Cargar datos</button></div>}
    <section className="metrics-daily" aria-label="Detalle diario"><div className="metrics-daily__header"><h3>Detalle diario</h3><p>{current.daily.length} días · {formatDayLabel(range.from)} → {formatDayLabel(range.to)}</p></div><div className="metrics-table-wrap"><table className="metrics-table"><thead><tr><th>Día</th><th>Pedidos</th><th>Quejas informadas</th><th>Casos</th><th>% quejas</th><th>Recuperado</th><th>Pendiente</th><th>Pérdida confirmada</th><th>Totales del día</th></tr></thead><tbody>
      {current.daily.map(day=>{const row=aggregator==='all'?day:day.aggregators.find(r=>r.aggregator===aggregator); const states=quality.rows.filter(r=>r.day===day.day).map(r=>r.state);return <tr key={day.day}>
        <td><button type="button" className="metrics-table-link" title="Ver métricas de este día" onClick={()=>onFocusDay(focusDay===day.day?'':day.day)}>{formatDayLabel(day.day)}</button></td>
        <td>{states.every(s=>s==='missing')?'Sin cargar':formatNumber(row.orders)}</td><td>{states.every(s=>s==='missing')?'Sin cargar':formatNumber(row.complaints)}</td><td>{row.historyCount}</td><td>{formatPct(row.complaintPct)}</td>
        <td>{formatKnownMoney(row.recoveredAmount,row.missingMoney?.recoveredAmount)}</td><td>{formatKnownMoney(row.pendingAmount,row.missingMoney?.pendingAmount)}</td><td>{formatKnownMoney(row.finalLostAmount,row.missingMoney?.finalLostAmount)}</td>
        <td>{states.every(s=>s==='missing')?'Sin cargar':states.includes('legacy')?'Datos anteriores':states.some(s=>s!=='complete')?'Parcial':'Completa'}</td>
      </tr>;})}
    </tbody></table></div></section>
    <MetricsQualityPanel store={store} history={history} range={range} aggregator={aggregator}/>
  </div>;
}
