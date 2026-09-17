import { useEffect, useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import {
  METRIC_AGGREGATORS,
  PERIOD_PRESETS,
  addDays,
  argentinaToday,
  compareSummaries,
  formatDayLabel,
  formatNumber,
  formatPct,
  isOutOfTarget,
  previousPeriod,
  resolvePeriod,
  setTargetComplaintPct,
  summarizeRange,
} from '../lib/metrics';
import { fetchPhotoFlags, getSavedPeriod, savePeriod } from '../lib/metricsStore';

function formatDelta(value, { pct = false } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const abs = Math.abs(value);
  const formatted = pct ? formatPct(abs) : formatNumber(abs);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return pct ? formatPct(0) : '0';
}

function StackedBar({ accepted, refuted, pending }) {
  const total = accepted + refuted + pending;
  if (total <= 0) {
    return <div className="metrics-stack metrics-stack--empty" aria-hidden="true" />;
  }
  return (
    <div className="metrics-stack" aria-hidden="true">
      {refuted > 0 && <span className="metrics-stack__refuted" style={{ flexGrow: refuted }} />}
      {accepted > 0 && <span className="metrics-stack__accepted" style={{ flexGrow: accepted }} />}
      {pending > 0 && <span className="metrics-stack__pending" style={{ flexGrow: pending }} />}
    </div>
  );
}

export default function MetricsDashboard({ store, hasData, saving, onSave, onGoToEntry }) {
  const savedPeriod = getSavedPeriod();
  const [preset, setPreset] = useState(savedPeriod.preset || 'week');
  const [customFrom, setCustomFrom] = useState(savedPeriod.customFrom || '');
  const [customTo, setCustomTo] = useState(savedPeriod.customTo || '');
  const [targetDraft, setTargetDraft] = useState(null);
  const [photoFlags, setPhotoFlags] = useState({});
  const [photoError, setPhotoError] = useState(null);
  const targetValue = targetDraft ?? String(store.targetComplaintPct);

  const today = argentinaToday();
  const period = useMemo(
    () => resolvePeriod(preset, today, customFrom, customTo),
    [preset, today, customFrom, customTo],
  );
  const previous = useMemo(() => previousPeriod(period.from, period.to), [period]);

  useEffect(() => {
    savePeriod({ preset, customFrom, customTo });
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    async function loadFlags() {
      try {
        const flags = await fetchPhotoFlags(previous.from, period.to);
        if (!cancelled) {
          setPhotoFlags(flags);
          setPhotoError(null);
        }
      } catch (err) {
        if (!cancelled) setPhotoError(err.message || 'No se pudieron leer las fotos del período.');
      }
    }
    loadFlags();
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to, previous.from]);

  const current = useMemo(
    () => summarizeRange(store, photoFlags, period.from, period.to),
    [store, photoFlags, period],
  );
  const previousSummary = useMemo(
    () => summarizeRange(store, photoFlags, previous.from, previous.to),
    [store, photoFlags, previous],
  );
  const compared = compareSummaries(current.overall, previousSummary.overall, store.targetComplaintPct);
  const maxDailyRate = Math.max(
    store.targetComplaintPct,
    ...current.daily.map((day) => day.complaintPct || 0),
    4,
  );

  function applyPreset(id) {
    setPreset(id);
    if (id === 'custom') {
      const current = resolvePeriod(preset === 'custom' ? 'week' : preset, today, customFrom, customTo);
      setCustomFrom(customFrom || current.from);
      setCustomTo(customTo || current.to);
    }
  }

  function handleSaveTarget(event) {
    event.preventDefault();
    onSave(setTargetComplaintPct(store, targetValue), 'Objetivo actualizado.');
    setTargetDraft(null);
  }

  return (
    <div className="metrics-dash">
      <div className="metrics-toolbar">
        <div className="metrics-presets" role="group" aria-label="Período">
          {PERIOD_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`gallery__view-btn${preset === item.id ? ' gallery__view-btn--active' : ''}`}
              onClick={() => applyPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="metrics-range">
            <label>
              Desde
              <input type="date" value={customFrom || period.from} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label>
              Hasta
              <input type="date" value={customTo || period.to} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}
        <form className="metrics-target" onSubmit={handleSaveTarget}>
          <label>
            Objetivo de quejas
            <span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={targetValue}
                onChange={(e) => setTargetDraft(e.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </span>
          </label>
          <button type="submit" className="btn btn--ghost btn--small" disabled={saving}>
            Guardar
          </button>
        </form>
      </div>

      <p className="metrics-period-label">
        {formatDayLabel(period.from)}
        {period.from !== period.to ? ` → ${formatDayLabel(period.to)}` : ''}
        <span> vs {formatDayLabel(previous.from)}–{formatDayLabel(previous.to)}</span>
      </p>

      {photoError && (
        <p className="message message--error message--compact" role="status">
          {photoError}
        </p>
      )}

      {!hasData ? (
        <div className="gallery__state gallery__state--empty">
          <p>Todavía no hay pedidos ni quejas cargados.</p>
          <button type="button" className="btn btn--primary" onClick={onGoToEntry}>
            Cargar el primer día
          </button>
        </div>
      ) : (
        <>
          <div className={`metrics-status${compared.outOfTarget ? ' metrics-status--bad' : ' metrics-status--good'}`}>
            <strong>{compared.outOfTarget ? 'Fuera de objetivo' : 'Dentro del objetivo'}</strong>
            <p>
              {formatPct(current.overall.complaintPct)} de quejas sobre {formatNumber(current.overall.orders)}{' '}
              pedidos. El tope es {formatPct(store.targetComplaintPct)}.
            </p>
          </div>

          <div className="metrics-kpis">
            <Kpi label="Pedidos" value={formatNumber(current.overall.orders)} hint={`${formatDelta(compared.orders)} vs anterior`} />
            <Kpi label="Quejas" value={formatNumber(current.overall.complaints)} hint={`${formatDelta(compared.complaints)} vs anterior`} />
            <Kpi
              label="% quejas"
              value={formatPct(current.overall.complaintPct)}
              hint={`objetivo ${formatPct(store.targetComplaintPct)}`}
              tone={compared.outOfTarget ? 'bad' : 'good'}
            />
            <Kpi
              label="Refutados"
              value={formatNumber(current.overall.refuted)}
              hint={`${formatPct(current.overall.refutedPctOfComplaints)} de las quejas`}
            />
            <Kpi
              label="Aceptadas"
              value={formatNumber(current.overall.accepted)}
              hint={`${formatPct(current.overall.acceptedPctOfComplaints)} de las quejas`}
            />
            <Kpi
              label="Pendientes"
              value={formatNumber(current.overall.pending)}
              hint={current.overall.pending ? 'Quejas sin cerrar' : 'Sin pendientes'}
            />
          </div>

          <div className="metrics-aggs">
            {METRIC_AGGREGATORS.map((aggregator) => {
              const item = current.aggregators.find((row) => row.id === aggregator);
              const prev = previousSummary.aggregators.find((row) => row.id === aggregator);
              const bad = isOutOfTarget(item.complaintPct, store.targetComplaintPct);
              const hasOrders = item.orders > 0 || item.complaints > 0;
              return (
                <article
                  key={aggregator}
                  className={`metrics-agg${bad && hasOrders ? ' metrics-agg--bad' : ''}${!hasOrders ? ' metrics-agg--empty' : ''}`}
                >
                  <header>
                    <h3>{getAggregatorLabel(aggregator)}</h3>
                    <strong className={bad && hasOrders ? 'is-bad' : 'is-good'}>
                      {hasOrders ? formatPct(item.complaintPct) : '—'}
                    </strong>
                  </header>
                  <p className="metrics-agg__meta">
                    {formatNumber(item.orders)} pedidos · {formatNumber(item.complaints)} quejas
                    {prev ? ` · ${formatDelta(item.complaintPct - (prev.complaintPct || 0), { pct: true })}` : ''}
                  </p>
                  <StackedBar accepted={item.accepted} refuted={item.refuted} pending={item.pending} />
                  <dl>
                    <div>
                      <dt>Refutados</dt>
                      <dd>
                        {formatNumber(item.refuted)}
                        <small>{formatPct(item.refutedPctOfComplaints)}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Aceptadas</dt>
                      <dd>
                        {formatNumber(item.accepted)}
                        <small>{formatPct(item.acceptedPctOfComplaints)}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Pendientes</dt>
                      <dd>{formatNumber(item.pending)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>

          {current.daily.length > 1 && (
            <section className="metrics-chart" aria-label="Quejas por día">
              <h3>Quejas por día</h3>
              <div className="metrics-chart__bars">
                {current.daily.map((day) => {
                  const height = Math.max(6, ((day.complaintPct || 0) / maxDailyRate) * 100);
                  const bad = isOutOfTarget(day.complaintPct, store.targetComplaintPct);
                  return (
                    <div key={day.day} className="metrics-chart__col">
                      <span className="metrics-chart__value">
                        {day.orders ? formatPct(day.complaintPct, 0) : ''}
                      </span>
                      <span
                        className={`metrics-chart__bar${bad ? ' metrics-chart__bar--bad' : ''}`}
                        style={{ height: `${height}%` }}
                      />
                      <span className="metrics-chart__label">{addDays(day.day, 0).slice(8)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="metrics-chart__legend">
                Línea de objetivo {formatPct(store.targetComplaintPct)} · cada barra es el % de quejas del día
              </p>
            </section>
          )}

          <div className="metrics-table-wrap">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Pedidos</th>
                  <th>Quejas</th>
                  <th>%</th>
                  <th>Ref.</th>
                  <th>Acep.</th>
                </tr>
              </thead>
              <tbody>
                {current.daily.map((day) => (
                  <tr key={day.day} className={isOutOfTarget(day.complaintPct, store.targetComplaintPct) ? 'is-bad' : ''}>
                    <td>{formatDayLabel(day.day)}</td>
                    <td>{formatNumber(day.orders)}</td>
                    <td>{formatNumber(day.complaints)}</td>
                    <td>{formatPct(day.complaintPct)}</td>
                    <td>{formatNumber(day.refuted)}</td>
                    <td>{formatNumber(day.accepted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }) {
  return (
    <article className={`metrics-kpi${tone ? ` metrics-kpi--${tone}` : ''}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {hint ? <span>{hint}</span> : null}
    </article>
  );
}
