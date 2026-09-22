import { useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { groupHistoryFlags } from '../lib/complaintHistory';
import {
  AWT_AGGREGATOR,
  METRIC_AGGREGATORS,
  PERIOD_PRESETS,
  compareSummaries,
  formatDayLabel,
  formatMoney,
  formatNumber,
  formatPct,
  isOutOfTarget,
  previousPeriod,
  setTargetAwtPct,
  setTargetComplaintPct,
  summarizeRange,
} from '../lib/metrics';
function formatDelta(value, { pct = false, money = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const formatted = money ? formatMoney(Math.abs(value)) : pct ? formatPct(Math.abs(value)) : formatNumber(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function SheetStat({ label, value, hint, tone }) {
  return (
    <div className={`metrics-sheet__row${tone ? ` metrics-sheet__row--${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <em>{hint}</em> : null}
    </div>
  );
}

export function MetricsPeriodBar({
  store,
  saving,
  preset,
  customFrom,
  customTo,
  period,
  focusDay,
  aggregator,
  onPreset,
  onCustomFrom,
  onCustomTo,
  onAggregator,
  onClearDay,
  onSave,
}) {
  const [complaintDraft, setComplaintDraft] = useState(null);
  const [awtDraft, setAwtDraft] = useState(null);
  const complaintValue = complaintDraft ?? String(store.targetComplaintPct);
  const awtValue = awtDraft ?? String(store.targetAwtPct);

  function handleSaveTargets(event) {
    event.preventDefault();
    let next = setTargetComplaintPct(store, complaintValue);
    next = setTargetAwtPct(next, awtValue);
    onSave(next, 'Objetivos actualizados.');
    setComplaintDraft(null);
    setAwtDraft(null);
  }

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
            <input type="date" value={customFrom || period.from} onChange={(e) => onCustomFrom(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={customTo || period.to} onChange={(e) => onCustomTo(e.target.value)} />
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
      <form className="metrics-target" onSubmit={handleSaveTargets}>
        <label>
          Objetivo quejas
          <span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={complaintValue}
              onChange={(e) => setComplaintDraft(e.target.value)}
              inputMode="decimal"
            />
            <span>%</span>
          </span>
        </label>
        <label>
          Objetivo AWT
          <span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={awtValue}
              onChange={(e) => setAwtDraft(e.target.value)}
              inputMode="decimal"
            />
            <span>%</span>
          </span>
        </label>
        <button type="submit" className="btn btn--ghost btn--small" disabled={saving}>
          Guardar
        </button>
      </form>
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
          </>
        )}
      </p>
    </div>
  );
}

export default function MetricsDashboard({
  store,
  history,
  hasData,
  period,
  focusDay,
  aggregator,
  onChangeView,
  onFocusDay,
  onAggregator,
}) {
  const range = useMemo(
    () => (focusDay ? { from: focusDay, to: focusDay } : period),
    [focusDay, period],
  );
  const previous = useMemo(() => previousPeriod(range.from, range.to), [range]);
  const historyFlags = useMemo(
    () => groupHistoryFlags(history, previous.from, range.to),
    [history, previous.from, range.to],
  );
  const current = useMemo(
    () => summarizeRange(store, {}, range.from, range.to, historyFlags),
    [store, historyFlags, range],
  );
  const previousSummary = useMemo(
    () => summarizeRange(store, {}, previous.from, previous.to, historyFlags),
    [store, historyFlags, previous],
  );

  const item =
    aggregator && aggregator !== 'all'
      ? current.aggregators.find((row) => row.id === aggregator)
      : current.overall;
  const prev =
    aggregator && aggregator !== 'all'
      ? previousSummary.aggregators.find((row) => row.id === aggregator)
      : previousSummary.overall;
  const compared = compareSummaries(item, prev, store.targetComplaintPct, store.targetAwtPct);
  const showAwt = !aggregator || aggregator === 'all' || aggregator === AWT_AGGREGATOR;
  const complaintBad = isOutOfTarget(item.complaintPct, store.targetComplaintPct);
  const series = current.daily;

  return (
    <div className="metrics-dash">
      <div className="metrics-sheet">
        <section className="metrics-sheet__group">
          <h3>Operación</h3>
          <SheetStat label="Pedidos" value={formatNumber(item.orders)} hint={`${formatDelta(compared.orders)} vs anterior`} />
          <SheetStat
            label="Quejas"
            value={formatNumber(item.complaints)}
            hint={`${formatDelta(compared.complaints)} vs anterior`}
          />
          <SheetStat
            label="% quejas"
            value={formatPct(item.complaintPct)}
            hint={`objetivo ${formatPct(store.targetComplaintPct)}`}
            tone={complaintBad ? 'bad' : item.orders ? 'good' : undefined}
          />
          {showAwt && (
            <SheetStat
              label="% AWT"
              value={formatPct(item.awtPct)}
              hint={`objetivo ${formatPct(store.targetAwtPct)}`}
              tone={isOutOfTarget(item.awtPct, store.targetAwtPct) ? 'bad' : item.orders ? 'good' : undefined}
            />
          )}
        </section>
        <section className="metrics-sheet__group">
          <h3>Plata</h3>
          <SheetStat
            label="$ quejas"
            value={formatMoney(item.complaintAmount)}
            hint="Dada al cliente"
          />
          <SheetStat
            label="$ recuperado"
            value={formatMoney(item.recoveredAmount)}
            hint="Volvió con Ref. aceptado"
            tone={item.recoveredAmount > 0 ? 'good' : undefined}
          />
          <SheetStat
            label="Dinero en disputa"
            value={formatMoney(item.inProgressAmount)}
            hint="Refutados pendientes"
            tone={item.inProgressAmount > 0 ? 'neutral' : undefined}
          />
          <SheetStat
            label="$ perdido"
            value={formatMoney(item.lostAmount)}
            hint="Rechazados o sin refutar"
            tone={item.lostAmount > 0 ? 'bad' : item.complaintAmount ? 'good' : undefined}
          />
        </section>
      </div>

      <div className="metrics-money-split">
        <p>
          Sin disputar {formatMoney(item.undisputedAmount)} · En trámite {formatMoney(item.inProgressAmount)} ·
          Rechazado {formatMoney(item.confirmedLostAmount)}
        </p>
        <p>
          {formatNumber(item.queja)} quejas · {formatNumber(item.refutado)} refutados ·{' '}
          {formatNumber(item.refutadoAceptado)} aceptados · {formatNumber(item.refutadoRechazado)} rechazados
        </p>
      </div>

      <div className="metrics-aggs metrics-aggs--hero">
        {METRIC_AGGREGATORS.map((id) => {
          const row = current.aggregators.find((itemRow) => itemRow.id === id);
          const statusBad = isOutOfTarget(row.complaintPct, store.targetComplaintPct);
          const has = row.orders > 0 || row.complaints > 0 || row.complaintAmount > 0;
          return (
            <button
              key={id}
              type="button"
              className={`metrics-agg metrics-agg--hero${statusBad ? ' metrics-agg--bad' : ''}${
                !has ? ' metrics-agg--empty' : ''
              }${id === 'pedidosya' && has ? ' metrics-agg--wide' : ''}${aggregator === id ? ' is-selected' : ''}`}
              onClick={() => onAggregator(aggregator === id ? 'all' : id)}
            >
              <header>
                <h3>{getAggregatorLabel(id)}</h3>
              </header>
              <p className={`metrics-agg__pct${statusBad ? ' is-bad' : has ? ' is-good' : ''}`}>
                {has ? formatPct(row.complaintPct) : '—'}
              </p>
              <p className="metrics-agg__pct-label">quejas sobre pedidos</p>
              <p className="metrics-agg__meta">
                {formatNumber(row.orders)} pedidos · {formatNumber(row.complaints)} quejas
              </p>
              <p className="metrics-agg__meta">
                {formatMoney(row.complaintAmount)} quejas · {formatMoney(row.recoveredAmount)} recuperado
              </p>
            </button>
          );
        })}
      </div>

      {!hasData && (
        <div className="gallery__state gallery__state--empty">
          <p>Todavía no hay pedidos ni quejas cargados.</p>
          <button type="button" className="btn btn--primary" onClick={() => onChangeView('entry')}>
            Cargar el primer día
          </button>
        </div>
      )}

      {series.length > 0 && (
        <div className="metrics-table-wrap">
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Día</th>
                <th>Pedidos</th>
                <th>Quejas</th>
                <th>%</th>
                <th>$ quejas</th>
                <th>$ recuperado</th>
                <th>En disputa</th>
                <th>$ perdido</th>
              </tr>
            </thead>
            <tbody>
              {series.map((day) => {
                const row =
                  aggregator && aggregator !== 'all'
                    ? day.aggregators.find((itemRow) => itemRow.aggregator === aggregator)
                    : day;
                return (
                  <tr
                    key={day.day}
                    className={focusDay === day.day ? 'is-active' : ''}
                    onClick={() => onFocusDay(focusDay === day.day ? '' : day.day)}
                  >
                    <td>{formatDayLabel(day.day)}</td>
                    <td>{formatNumber(row.orders)}</td>
                    <td>{formatNumber(row.complaints)}</td>
                    <td className={isOutOfTarget(row.complaintPct, store.targetComplaintPct) ? 'is-bad' : ''}>
                      {formatPct(row.complaintPct)}
                    </td>
                    <td>{formatMoney(row.complaintAmount)}</td>
                    <td>{formatMoney(row.recoveredAmount)}</td>
                    <td>{formatMoney(row.inProgressAmount)}</td>
                    <td>{formatMoney(row.lostAmount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="metrics-period-label">Tocá un día para ver solo esa fecha.</p>
        </div>
      )}
    </div>
  );
}
