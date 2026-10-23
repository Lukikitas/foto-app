import RappiExcelImport from './RappiExcelImport';
import PeyaRefundsImport from './PeyaRefundsImport';
import PeyaExcelImport from './PeyaExcelImport';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import {
  AWT_AGGREGATOR,
  METRIC_AGGREGATORS,
  addDays,
  argentinaToday,
  complaintRate,
  copyDayStats,
  formatDayLabel,
  formatPct,
  isOutOfTarget,
  upsertDayStats,
} from '../lib/metrics';
import { validateMetricFields } from '../lib/metricsQuality';
import MetricsListPaste from './MetricsListPaste';
import { cloneMetricsForEdit } from '../lib/metricsBaseline';

function toField(value) {
  return value == null ? '' : String(value);
}

function fieldsFromStats(stats = {orders:null,complaints:null,awt:null}) {
  return {
    orders: stats.reported?.orders === false ? '' : toField(stats.orders),
    complaints: stats.reported?.complaints === false ? '' : toField(stats.complaints),
    awt: stats.reported?.awt === false ? '' : toField(stats.awt),
  };
}

export default function MetricsEntry({ store, saving, onSave, onImportBusy, onDirty, onManage, entryRequest }) {
  const today = argentinaToday();
  const [day, setDay] = useState(entryRequest?.day || today);
  const draftBases = useRef({});
  const [drafts, setDrafts] = useState({});
  const [pasteDirty, setPasteDirty] = useState(false);
  const [mode, setMode] = useState(entryRequest?.mode || (entryRequest ? 'day' : 'excel'));
  const [validation, setValidation] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => {
    if (!entryRequest) return;
    const timer = window.setTimeout(() => { setDay(entryRequest.day); setMode(entryRequest.mode || 'day'); setValidation(''); }, 0);
    return () => window.clearTimeout(timer);
  }, [entryRequest]);
  useEffect(()=> {onDirty?.(Object.keys(drafts).length>0 || pasteDirty);},[drafts,pasteDirty,onDirty]);
  useEffect(()=>{const handler=event=>{if(Object.keys(drafts).length){event.preventDefault();event.returnValue='';}}; window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[drafts]);

  const fields = drafts[day] || Object.fromEntries(
    METRIC_AGGREGATORS.map((id) => [id, fieldsFromStats(store.days?.[day]?.[id])]),
  );

  const recentDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(today, -index)),
    [today],
  );

  function updateField(aggregator, key, value) {
    draftBases.current[day] ||= cloneMetricsForEdit(store);
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

  async function handleSubmit(event) {
    event.preventDefault();
    const error=validateMetricFields(day,fields,today); setValidation(error); if(error)return;
    let next = draftBases.current[day] || store;
    for (const aggregator of METRIC_AGGREGATORS) {
      const row = fields[aggregator];
      const original = (draftBases.current[day] || store).days?.[day]?.[aggregator];
      const prior = fieldsFromStats(original);
      const reported = Object.fromEntries(['orders','complaints','awt'].map(key=>[key, row[key] === prior[key] && original ? original.reported?.[key] ?? null : row[key] !== '' && (key !== 'awt' || aggregator === AWT_AGGREGATOR)]));
      const sources = Object.fromEntries(['orders','complaints','awt'].map(key=>[key, row[key] === prior[key] && original ? original.sources?.[key] || '' : reported[key] ? 'manual' : '']));
      next = upsertDayStats(next, day, aggregator, {
        orders: row.orders,
        complaints: row.complaints,
        awt: aggregator === AWT_AGGREGATOR ? row.awt : original?.awt ?? 0,
        reported, sources,
      });
    }
    if (!await onSave(next, `Guardado ${formatDayLabel(day)}.`)) return;
    delete draftBases.current[day];
    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[day];
      return nextDrafts;
    });
  }

  function handleCopyYesterday() {
    const source = addDays(day, -1);
    if (!store.days?.[source]) return;
    draftBases.current[day] ||= cloneMetricsForEdit(store);
    const copy=copyDayStats(store,source,day);
    setDrafts(current=>({...current,[day]:Object.fromEntries(METRIC_AGGREGATORS.map(id=>[id,fieldsFromStats(copy.days[day]?.[id])]))}));
    setCopyNotice('Valores de '+formatDayLabel(source)+' copiados al formulario. Revisá los cambios y guardá el día.');
  }

  return (
    <div className="metrics-entry-wrap">
      <div className="metrics-entry-selector" role="group" aria-label="Método de carga">{[['excel','Importar Excel'],['day','Cargar un día'],['paste','Pegar varios días'],['refunds','Importar reintegros']].map(([id,label])=><button key={id} className={'btn btn--ghost'+(mode===id?' is-active':'')} onClick={()=>setMode(id)} disabled={saving} aria-pressed={mode===id}>{label}</button>)}</div>
      {mode==='excel' && <><p className="metrics-entry__note">Seleccionar archivo → revisar cambios → preparar lista → Gestionar → guardar en Historial.</p><PeyaExcelImport disabled={saving} onBusy={onImportBusy} />
      <RappiExcelImport disabled={saving} onBusy={onImportBusy} /><button className="btn btn--primary" onClick={onManage}>Ir a revisar la lista en Gestionar</button></>}
      {mode==='refunds' && <PeyaRefundsImport disabled={saving} onBusy={onImportBusy} />}
      <div hidden={mode!=='paste'}><MetricsListPaste store={store} saving={saving} onSave={onSave} onDirty={setPasteDirty} /></div>
      <div hidden={mode!=='day'}><form className="metrics-entry" onSubmit={handleSubmit}>
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
            return (
              <article
                key={aggregator}
                className={`metrics-form-card${bad || awtBad ? ' is-bad' : ''}`}
                style={entryRequest?.day === day && entryRequest?.aggregator === aggregator ? { outline: '2px solid var(--info)', outlineOffset: '3px' } : undefined}
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
                {showAwt && (
                  <p className="metrics-form-card__hint">
                    AWT es el % de pedidos demorados de PedidosYa. Objetivo {formatPct(store.targetAwtPct)}.
                  </p>
                )}
              </article>
            );
          })}
        </div>

        {validation && <p className="message message--error" role="alert">{validation}</p>}
        {copyNotice && <p className="message message--success" role="status">{copyNotice}</p>}
        <div className="metrics-entry__actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar día'}
          </button>
        </div>
        <p className="metrics-entry__note">
          Acá se cargan pedidos, quejas y AWT del día. Los montos y el estado de cada queja salen
          del Excel de reclamos, en la pestaña Quejas.
        </p>
      </form></div>
    </div>
  );
}
