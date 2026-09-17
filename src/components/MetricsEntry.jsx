import { useEffect, useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import {
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
import { fetchPhotoFlags } from '../lib/metricsStore';

function toField(value) {
  return value == null || value === 0 ? '' : String(value);
}

function fieldsFromStats(stats = emptyDayStats()) {
  return {
    orders: toField(stats.orders),
    complaints: toField(stats.complaints),
    accepted: stats.accepted == null ? '' : String(stats.accepted),
    refuted: stats.refuted == null ? '' : String(stats.refuted),
  };
}

export default function MetricsEntry({ store, saving, onSave }) {
  const today = argentinaToday();
  const [day, setDay] = useState(today);
  const [drafts, setDrafts] = useState({});
  const [photoFlags, setPhotoFlags] = useState({});
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
        const flags = await fetchPhotoFlags(addDays(day, -6), day);
        if (!cancelled) setPhotoFlags(flags);
      } catch {
        if (!cancelled) setPhotoFlags({});
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
        accepted: row.accepted === '' ? null : row.accepted,
        refuted: row.refuted === '' ? null : row.refuted,
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
          const orders = METRIC_AGGREGATORS.reduce(
            (sum, aggregator) => sum + Number(store.days?.[item]?.[aggregator]?.orders || 0),
            0,
          );
          const complaints = METRIC_AGGREGATORS.reduce(
            (sum, aggregator) => sum + Number(store.days?.[item]?.[aggregator]?.complaints || 0),
            0,
          );
          const rate = complaintRate(orders, complaints);
          const bad = isOutOfTarget(rate, store.targetComplaintPct);
          return (
            <button
              key={item}
              type="button"
              className={`metrics-days__btn${item === day ? ' is-active' : ''}${bad ? ' is-bad' : ''}${loaded ? ' has-data' : ''}`}
              onClick={() => setDay(item)}
            >
              <span>{formatDayLabel(item)}</span>
              <strong>{loaded ? formatPct(rate, 0) : '—'}</strong>
            </button>
          );
        })}
      </div>

      <div className="metrics-entry__grid">
        {METRIC_AGGREGATORS.map((aggregator) => {
          const row = fields[aggregator];
          const rate = complaintRate(row.orders, row.complaints);
          const bad = isOutOfTarget(rate, store.targetComplaintPct);
          const autoRefuted = photoFlags?.[day]?.[aggregator]?.refutedPhotos || 0;
          return (
            <article key={aggregator} className={`metrics-form-card${bad ? ' is-bad' : ''}`}>
              <header>
                <h3>{getAggregatorLabel(aggregator)}</h3>
                <strong className={rate == null ? '' : bad ? 'is-bad' : 'is-good'}>
                  {formatPct(rate)}
                </strong>
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
                      placeholder="auto"
                      value={row.accepted}
                      onChange={(e) => updateField(aggregator, 'accepted', e.target.value)}
                    />
                  </label>
                </>
              )}
              {!showExtra && autoRefuted > 0 && (
                <p className="metrics-form-card__hint">Fotos refutadas ese día: {autoRefuted}</p>
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
          {showExtra ? 'Ocultar aceptadas / refutadas' : 'Cargar aceptadas y refutadas'}
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar día'}
        </button>
      </div>
      <p className="metrics-entry__note">
        Con pedidos y quejas alcanza. Las refutadas se toman de las fotos marcadas, y las aceptadas
        son las quejas que no se refutaron, salvo que las cargues a mano.
      </p>
    </form>
  );
}
