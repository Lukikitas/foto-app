import { useEffect, useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import {
  AWT_AGGREGATOR,
  METRIC_AGGREGATORS,
  PERIOD_PRESETS,
  addDays,
  aggregatorDailySeries,
  argentinaToday,
  compareSummaries,
  formatDayLabel,
  formatNumber,
  formatPct,
  isOutOfTarget,
  previousPeriod,
  resolvePeriod,
  setTargetAwtPct,
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

function aggregatorStatus(item, complaintTarget, awtTarget) {
  const hasData = item.orders > 0 || item.complaints > 0 || item.awt > 0;
  const complaintBad = hasData && isOutOfTarget(item.complaintPct, complaintTarget);
  const awtBad =
    item.id === AWT_AGGREGATOR && hasData && isOutOfTarget(item.awtPct, awtTarget);
  let label = 'Sin datos';
  if (hasData && complaintBad && awtBad) label = 'Fuera';
  else if (hasData && complaintBad) label = 'Quejas altas';
  else if (hasData && awtBad) label = 'AWT alto';
  else if (hasData) label = 'OK';
  return { hasData, complaintBad, awtBad, bad: complaintBad || awtBad, label };
}

function RateMeter({ rate, target, label }) {
  const max = Math.max(Number(target) * 2 || 1, Number(rate) || 0, 0.1);
  const fill = rate == null ? 0 : Math.min(100, (Number(rate) / max) * 100);
  const mark = Math.min(100, (Number(target) / max) * 100);
  const bad = isOutOfTarget(rate, target);
  return (
    <div className={`metrics-meter${bad ? ' is-bad' : rate == null ? '' : ' is-good'}`}>
      <div className="metrics-meter__wrap">
        <div className="metrics-meter__track" aria-hidden="true">
          <span className="metrics-meter__fill" style={{ width: `${fill}%` }} />
        </div>
        <span
          className="metrics-meter__mark"
          style={{ left: `${mark}%` }}
          title={`Objetivo ${formatPct(target)}`}
        />
      </div>
      {label ? <p className="metrics-meter__label">{label}</p> : null}
    </div>
  );
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

function Kpi({ label, value, hint, tone }) {
  return (
    <article className={`metrics-kpi${tone ? ` metrics-kpi--${tone}` : ''}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {hint ? <span>{hint}</span> : null}
    </article>
  );
}

function DailyChart({ days, valueKey, target, title, legend }) {
  const maxValue = Math.max(target, ...days.map((day) => day[valueKey] || 0), 1);
  return (
    <section className="metrics-chart" aria-label={title}>
      <h3>{title}</h3>
      <div className="metrics-chart__bars">
        {days.map((day) => {
          const value = day[valueKey];
          const has = day.orders > 0;
          const height = has ? Math.max(8, ((value || 0) / maxValue) * 100) : 0;
          const bad = has && isOutOfTarget(value, target);
          return (
            <div key={day.day} className="metrics-chart__col">
              <span className="metrics-chart__value">{has ? formatPct(value) : ''}</span>
              <span
                className={`metrics-chart__bar${bad ? ' metrics-chart__bar--bad' : ''}${has ? '' : ' metrics-chart__bar--empty'}`}
                style={{ height: has ? `${height}%` : '3px' }}
              />
              <span className="metrics-chart__label">{addDays(day.day, 0).slice(8)}</span>
            </div>
          );
        })}
      </div>
      <p className="metrics-chart__legend">{legend}</p>
    </section>
  );
}

export default function MetricsDashboard({ store, hasData, saving, view, onSave, onChangeView }) {
  const savedPeriod = getSavedPeriod();
  const [preset, setPreset] = useState(savedPeriod.preset || 'week');
  const [customFrom, setCustomFrom] = useState(savedPeriod.customFrom || '');
  const [customTo, setCustomTo] = useState(savedPeriod.customTo || '');
  const [complaintDraft, setComplaintDraft] = useState(null);
  const [awtDraft, setAwtDraft] = useState(null);
  const [photoFlags, setPhotoFlags] = useState({});
  const [photoError, setPhotoError] = useState(null);

  const complaintValue = complaintDraft ?? String(store.targetComplaintPct);
  const awtValue = awtDraft ?? String(store.targetAwtPct);
  const aggregator = METRIC_AGGREGATORS.includes(view) ? view : null;
  const showAwtTarget = !aggregator || aggregator === AWT_AGGREGATOR;

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

  const ranked = METRIC_AGGREGATORS.map((id) => current.aggregators.find((row) => row.id === id));
  const withData = ranked.filter(
    (item) => aggregatorStatus(item, store.targetComplaintPct, store.targetAwtPct).hasData,
  );
  const badCount = withData.filter(
    (item) => aggregatorStatus(item, store.targetComplaintPct, store.targetAwtPct).bad,
  ).length;

  function applyPreset(id) {
    setPreset(id);
    if (id === 'custom') {
      const next = resolvePeriod(preset === 'custom' ? 'week' : preset, today, customFrom, customTo);
      setCustomFrom(customFrom || next.from);
      setCustomTo(customTo || next.to);
    }
  }

  function handleSaveTargets(event) {
    event.preventDefault();
    let next = setTargetComplaintPct(store, complaintValue);
    if (showAwtTarget) next = setTargetAwtPct(next, awtValue);
    onSave(next, 'Objetivos actualizados.');
    setComplaintDraft(null);
    setAwtDraft(null);
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
          {showAwtTarget && (
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
          )}
          <button type="submit" className="btn btn--ghost btn--small" disabled={saving}>
            Guardar
          </button>
        </form>
      </div>

      <p className="metrics-period-label">
        {formatDayLabel(period.from)}
        {period.from !== period.to ? ` → ${formatDayLabel(period.to)}` : ''}
        <span>
          {' '}
          vs {formatDayLabel(previous.from)}–{formatDayLabel(previous.to)}
        </span>
      </p>

      {photoError && (
        <p className="message message--error message--compact" role="status">
          {photoError}
        </p>
      )}

      {aggregator ? (
        <AggregatorDetail
          aggregator={aggregator}
          current={current}
          previousSummary={previousSummary}
          store={store}
          hasData={hasData}
          onChangeView={onChangeView}
        />
      ) : (
        <Overview
          ranked={ranked}
          withData={withData}
          badCount={badCount}
          store={store}
          previousSummary={previousSummary}
          hasData={hasData}
          onChangeView={onChangeView}
        />
      )}
    </div>
  );
}

function Overview({ ranked, withData, badCount, store, previousSummary, hasData, onChangeView }) {
  return (
    <>
      {withData.length > 0 && (
        <p className={`metrics-strip${badCount ? ' is-bad' : ' is-good'}`}>
          {badCount === 0
            ? `${withData.length} agregador${withData.length === 1 ? '' : 'es'} dentro del objetivo.`
            : `${badCount} de ${withData.length} agregadores fuera de objetivo.`}
        </p>
      )}

      <div className="metrics-aggs metrics-aggs--hero">
        {ranked.map((item) => {
          const prev = previousSummary.aggregators.find((row) => row.id === item.id);
          const status = aggregatorStatus(item, store.targetComplaintPct, store.targetAwtPct);
          const deltaPct =
            prev && item.complaintPct != null && prev.complaintPct != null
              ? item.complaintPct - prev.complaintPct
              : null;
          return (
            <button
              key={item.id}
              type="button"
              className={`metrics-agg metrics-agg--hero${status.bad ? ' metrics-agg--bad' : ''}${
                !status.hasData ? ' metrics-agg--empty' : ''
              }`}
              onClick={() => onChangeView(item.id)}
              aria-label={`Ver detalle de ${getAggregatorLabel(item.id)}`}
            >
              <header>
                <h3>{getAggregatorLabel(item.id)}</h3>
                <span className={`metrics-chip${status.bad ? ' is-bad' : status.hasData ? ' is-good' : ''}`}>
                  {status.label}
                </span>
              </header>
              <p className={`metrics-agg__pct${status.complaintBad ? ' is-bad' : status.hasData ? ' is-good' : ''}`}>
                {status.hasData ? formatPct(item.complaintPct) : '—'}
              </p>
              <p className="metrics-agg__pct-label">quejas sobre sus pedidos</p>
              <RateMeter
                rate={item.complaintPct}
                target={store.targetComplaintPct}
                label={`objetivo ${formatPct(store.targetComplaintPct)}`}
              />
              <p className="metrics-agg__meta">
                {formatNumber(item.orders)} pedido{item.orders === 1 ? '' : 's'} · {formatNumber(item.complaints)}{' '}
                queja{item.complaints === 1 ? '' : 's'}
                {deltaPct != null ? ` · ${formatDelta(deltaPct, { pct: true })}` : ''}
              </p>
              {item.id === AWT_AGGREGATOR && (
                <div className={`metrics-awt${status.awtBad ? ' is-bad' : ''}`}>
                  <div className="metrics-awt__head">
                    <span>AWT · demorados</span>
                    <strong className={status.awtBad ? 'is-bad' : status.hasData ? 'is-good' : ''}>
                      {status.hasData ? formatPct(item.awtPct) : '—'}
                    </strong>
                  </div>
                  <RateMeter
                    rate={item.awtPct}
                    target={store.targetAwtPct}
                    label={`${formatNumber(item.awt)} pedidos · objetivo ${formatPct(store.targetAwtPct)}`}
                  />
                </div>
              )}
              <span className="metrics-agg__more">Ver detalle</span>
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
    </>
  );
}

function AggregatorDetail({ aggregator, current, previousSummary, store, hasData, onChangeView }) {
  const item = current.aggregators.find((row) => row.id === aggregator);
  const prev = previousSummary.aggregators.find((row) => row.id === aggregator);
  const compared = compareSummaries(item, prev, store.targetComplaintPct, store.targetAwtPct);
  const status = aggregatorStatus(item, store.targetComplaintPct, store.targetAwtPct);
  const series = aggregatorDailySeries(current, aggregator);
  const showAwt = aggregator === AWT_AGGREGATOR;
  const label = getAggregatorLabel(aggregator);

  return (
    <>
      <div className={`metrics-status${status.bad ? ' metrics-status--bad' : status.hasData ? ' metrics-status--good' : ''}`}>
        <div className="metrics-status__top">
          <button type="button" className="metrics-back" onClick={() => onChangeView('overview')}>
            ← Resumen
          </button>
          <span className={`metrics-chip${status.bad ? ' is-bad' : status.hasData ? ' is-good' : ''}`}>
            {status.label}
          </span>
        </div>
        <strong>{label}</strong>
        <p>
          {status.hasData
            ? `${formatPct(item.complaintPct)} de quejas sobre ${formatNumber(item.orders)} pedido${
                item.orders === 1 ? '' : 's'
              }. Tope ${formatPct(store.targetComplaintPct)}.`
            : 'Sin pedidos cargados en este período.'}
          {showAwt && status.hasData
            ? ` AWT ${formatPct(item.awtPct)} (${formatNumber(item.awt)} demorados, tope ${formatPct(
                store.targetAwtPct,
              )}).`
            : ''}
        </p>
      </div>

      {!hasData ? (
        <div className="gallery__state gallery__state--empty">
          <p>Todavía no hay datos para {label}.</p>
          <button type="button" className="btn btn--primary" onClick={() => onChangeView('entry')}>
            Cargar el primer día
          </button>
        </div>
      ) : (
        <>
          <div className="metrics-kpis">
            <Kpi label="Pedidos" value={formatNumber(item.orders)} hint={`${formatDelta(compared.orders)} vs anterior`} />
            <Kpi
              label="Quejas"
              value={formatNumber(item.complaints)}
              hint={`${formatDelta(compared.complaints)} vs anterior`}
            />
            <Kpi
              label="% quejas"
              value={formatPct(item.complaintPct)}
              hint={`objetivo ${formatPct(store.targetComplaintPct)}`}
              tone={compared.outOfTarget ? 'bad' : status.hasData ? 'good' : undefined}
            />
            {showAwt && (
              <>
                <Kpi
                  label="AWT"
                  value={formatNumber(item.awt)}
                  hint={`${formatDelta(compared.awt)} vs anterior`}
                />
                <Kpi
                  label="% AWT"
                  value={formatPct(item.awtPct)}
                  hint={`objetivo ${formatPct(store.targetAwtPct)}`}
                  tone={compared.outOfAwtTarget ? 'bad' : status.hasData ? 'good' : undefined}
                />
              </>
            )}
            <Kpi
              label="Refutados"
              value={formatNumber(item.refuted)}
              hint={`${formatPct(item.refutedPctOfComplaints)} de las quejas`}
            />
            <Kpi
              label="Aceptadas"
              value={formatNumber(item.accepted)}
              hint={`${formatPct(item.acceptedPctOfComplaints)} de las quejas`}
            />
            <Kpi
              label="Pendientes"
              value={formatNumber(item.pending)}
              hint={item.pending ? 'Quejas sin cerrar' : 'Sin pendientes'}
            />
          </div>

          <article className="metrics-agg">
            <header>
              <h3>Resolución de quejas</h3>
            </header>
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

          {series.length > 1 && (
            <DailyChart
              days={series}
              valueKey="complaintPct"
              target={store.targetComplaintPct}
              title="Quejas por día"
              legend={`Línea de objetivo ${formatPct(store.targetComplaintPct)} · cada barra es el % de quejas de ${label}`}
            />
          )}

          {showAwt && series.length > 1 && (
            <DailyChart
              days={series}
              valueKey="awtPct"
              target={store.targetAwtPct}
              title="AWT por día"
              legend={`Objetivo ${formatPct(store.targetAwtPct)} · pedidos demorados sobre pedidos de PedidosYa`}
            />
          )}

          <div className="metrics-table-wrap">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Pedidos</th>
                  <th>Quejas</th>
                  <th>%</th>
                  {showAwt && (
                    <>
                      <th>AWT</th>
                      <th>% AWT</th>
                    </>
                  )}
                  <th>Ref.</th>
                  <th>Acep.</th>
                </tr>
              </thead>
              <tbody>
                {series.map((day) => (
                  <tr key={day.day}>
                    <td>{formatDayLabel(day.day)}</td>
                    <td>{formatNumber(day.orders)}</td>
                    <td>{formatNumber(day.complaints)}</td>
                    <td className={isOutOfTarget(day.complaintPct, store.targetComplaintPct) ? 'is-bad' : ''}>
                      {formatPct(day.complaintPct)}
                    </td>
                    {showAwt && (
                      <>
                        <td>{formatNumber(day.awt)}</td>
                        <td className={isOutOfTarget(day.awtPct, store.targetAwtPct) ? 'is-bad' : ''}>
                          {formatPct(day.awtPct)}
                        </td>
                      </>
                    )}
                    <td>{formatNumber(day.refuted)}</td>
                    <td>{formatNumber(day.accepted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
