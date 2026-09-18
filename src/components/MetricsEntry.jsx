import { useEffect, useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import {
  AWT_AGGREGATOR,
  METRIC_AGGREGATORS,
  addDays,
  argentinaToday,
  complaintRate,
  copyDayStats,
  emptyDayStats,
  formatDayLabel,
  formatPct,
  isOutOfTarget,
  upsertDayStats,
} from '../lib/metrics';
import { fetchHistoryFlags, fetchPhotoFlags } from '../lib/metricsStore';
import MetricsListPaste from './MetricsListPaste';

function toField(value) {
  return value == null || value === 0 ? '' : String(value);
}

function fieldsFromStats(stats = emptyDayStats()) {
  return {
    orders: toField(stats.orders),
    complaints: toField(stats.complaints),
    awt: toField(stats.awt),
    accepted: stats.accepted == null ? '' : String(stats.accepted),
    refuted: stats.refuted == null ? '' : String(stats.refuted),
    refutedAccepted: stats.refutedAccepted == null ? '' : String(stats.refutedAccepted),
  };
}

export default function MetricsEntry({ store, saving, onSave }) {
  const today = argentinaToday();
  const [day, setDay] = useState(today);
  const [drafts, setDrafts] = useState({});
  const [photoFlags, setPhotoFlags] = useState({});
  const [historyFlags, setHistoryFlags] = useState({});
  const [showExtra, setShowExtra] = useState(false);

  const fields = drafts[day] || Object.fromEntries(
    METRIC_AGGREGATORS.map((id) => [id, fieldsFromStats(store.days?.[day]?.[id])]),
  );

  const recentDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(today, -index)),
    [today],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadFlags() {
      try {
        const [flags, history] = await Promise.all([
          fetchPhotoFlags(addDays(day, -6), day),
          fetchHistoryFlags(addDays(day, -6), day),
        ]);
        if (!cancelled) {
          setPhotoFlags(flags);
          setHistoryFlags(history);
        }
      } catch {
        if (!cancelled) {
          setPhotoFlags({});
          setHistoryFlags({});
        }
      }
    }
    loadFlags();
    return () => {
      cancelled = true;
    };
  }, [day]);

  function updateField(aggregator, key, value) {
    setDrafts((current) => {
      const row = current[day] || Object.fromEntries(
        METRIC_AGGREGATORS.map((id) => [id, fieldsFromStats(store.days?.[day]?.[id])]),
      );
      return {
        ...current,
        [day]: {
          ...row,
          [aggregator]: { ...row[aggregator], [key]: value },
        },
      };
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    let next = store;
    for (const aggregator of METRIC_AGGREGATORS) {
      const row = fields[aggregator];
      next = upsertDayStats(next, day, aggregator, {
        orders: row.orders,
        complaints: row.complaints,
        awt: aggregator === AWT_AGGREGATOR ? row.awt : 0,
        accepted: row.accepted === '' ? null : row.accepted,
        refuted: row.refuted === '' ? null : row.refuted,
        refutedAccepted: row.refutedAccepted === '' ? null : row.refutedAccepted,
      });
    }
    onSave(next, `Guardado ${formatDayLabel(day)}.`);
    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[day];
      return nextDrafts;
    });
  }

  function handleCopyYesterday() {
    const source = addDays(day, -1);
    if (!store.days?.[source]) return;
    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[day];
      return nextDrafts;
    });
    onSave(copyDayStats(store, source, day), `Copiado ${formatDayLabel(source)} a ${formatDayLabel(day)}.`);
  }

  return (
    <div className="metrics-entry-wrap">
      <MetricsListPaste store={store} saving={saving} onSave={onSave} />
      <form className="metrics-entry" onSubmit={handleSubmit}>
      <div className="metrics-entry__top">
        <label className="metrics-entry__date">
          Día
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={handleCopyYesterday}
          disabled={saving || !store.days?.[addDays(day, -1)]}
        >
          Copiar ayer
        </button>
      </div>

      <div className="metrics-days" role="group" aria-label="Días recientes">
        {recentDays.map((item) => {
          const loaded = Boolean(store.days?.[item]);
          const dots = METRIC_AGGREGATORS.map((aggregator) => {
            const stats = store.days?.[item]?.[aggregator];
            if (!stats) return { aggregator, tone: '' };
            const complaintBad = isOutOfTarget(
              complaintRate(stats.orders, stats.complaints),
              store.targetComplaintPct,
            );
            const awtBad =
              aggregator === AWT_AGGREGATOR &&
              isOutOfTarget(complaintRate(stats.orders, stats.awt), store.targetAwtPct);
            return { aggregator, tone: complaintBad || awtBad ? 'is-bad' : 'is-good' };
          });
          const bad = dots.some((dot) => dot.tone === 'is-bad');
          return (
            <button
              key={item}
              type="button"
              className={`metrics-days__btn${item === day ? ' is-active' : ''}${bad ? ' is-bad' : ''}${
                loaded ? ' has-data' : ''
              }`}
              onClick={() => setDay(item)}
            >
              <span>{formatDayLabel(item)}</span>
              <span className="metrics-days__dots" aria-hidden="true">
                {dots.map((dot) => (
                  <i key={dot.aggregator} className={dot.tone} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="metrics-entry__grid">
        {METRIC_AGGREGATORS.map((aggregator) => {
          const row = fields[aggregator];
          const rate = complaintRate(row.orders, row.complaints);
          const bad = isOutOfTarget(rate, store.targetComplaintPct);
          const showAwt = aggregator === AWT_AGGREGATOR;
          const awtRate = showAwt ? complaintRate(row.orders, row.awt) : null;
          const awtBad = showAwt && isOutOfTarget(awtRate, store.targetAwtPct);
          const autoRefuted = Math.max(
            photoFlags?.[day]?.[aggregator]?.refutedPhotos || 0,
            historyFlags?.[day]?.[aggregator]?.refuted || 0,
          );
          const autoAccepted = historyFlags?.[day]?.[aggregator]?.accepted || 0;
          const autoRefutedAccepted = historyFlags?.[day]?.[aggregator]?.refutedAccepted || 0;
          return (
            <article
              key={aggregator}
              className={`metrics-form-card${bad || awtBad ? ' is-bad' : ''}`}
            >
              <header>
                <h3>{getAggregatorLabel(aggregator)}</h3>
                <div className="metrics-form-card__rates">
                  <strong className={rate == null ? '' : bad ? 'is-bad' : 'is-good'}>
                    {formatPct(rate)}
                  </strong>
                  {showAwt && (
                    <span className={awtRate == null ? '' : awtBad ? 'is-bad' : 'is-good'}>
                      AWT {formatPct(awtRate)}
                    </span>
                  )}
                </div>
              </header>
              <label>
                Pedidos
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={row.orders}
                  onChange={(e) => updateField(aggregator, 'orders', e.target.value)}
                />
              </label>
              <label>
                Quejas
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={row.complaints}
                  onChange={(e) => updateField(aggregator, 'complaints', e.target.value)}
                />
              </label>
              {showAwt && (
                <label>
                  AWT (demorados)
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="0"
                    value={row.awt}
                    onChange={(e) => updateField(aggregator, 'awt', e.target.value)}
                  />
                </label>
              )}
              {showExtra && (
                <>
                  <label>
                    Refutadas
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      placeholder={autoRefuted ? `auto ${autoRefuted}` : 'auto'}
                      value={row.refuted}
                      onChange={(e) => updateField(aggregator, 'refuted', e.target.value)}
                    />
                  </label>
                  <label>
                    Aceptadas
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      placeholder={autoAccepted ? `auto ${autoAccepted}` : 'auto'}
                      value={row.accepted}
                      onChange={(e) => updateField(aggregator, 'accepted', e.target.value)}
                    />
                  </label>
                  <label>
                    Refutados aceptados
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      placeholder={autoRefutedAccepted ? `auto ${autoRefutedAccepted}` : 'auto'}
                      value={row.refutedAccepted}
                      onChange={(e) => updateField(aggregator, 'refutedAccepted', e.target.value)}
                    />
                  </label>
                </>
              )}
              {!showExtra && (autoRefuted > 0 || autoAccepted > 0 || autoRefutedAccepted > 0) && (
                <p className="metrics-form-card__hint">
                  Auto: {autoAccepted} aceptadas · {autoRefuted} refutadas
                  {autoRefutedAccepted ? ` · ${autoRefutedAccepted} ref. aceptados` : ''}
                </p>
              )}
              {showAwt && (
                <p className="metrics-form-card__hint">
                  AWT es el % de pedidos demorados de PedidosYa. Objetivo {formatPct(store.targetAwtPct)}.
                </p>
              )}
            </article>
          );
        })}
      </div>

      <div className="metrics-entry__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setShowExtra((open) => !open)}
        >
          {showExtra ? 'Ocultar resolución' : 'Cargar aceptadas y refutadas'}
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar día'}
        </button>
      </div>
      <p className="metrics-entry__note">
        Cargá cada agregador por separado. Las aceptadas y refutadas salen del historial y de las
        fotos. Un pedido puede ser refutado y aceptado a la vez: eso cuenta en % refutados
        aceptados y también en % aceptados sobre todas las quejas.
      </p>
    </form>
    </div>
  );
}
