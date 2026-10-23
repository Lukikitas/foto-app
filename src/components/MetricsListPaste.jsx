import { useEffect, useMemo, useRef, useState } from 'react';
import { validateMetricFields } from '../lib/metricsQuality';
import { getAggregatorLabel } from '../lib/aggregators';
import { applyMetricList, parseMetricList } from '../lib/metricList';
import {
  AWT_AGGREGATOR,
  METRIC_AGGREGATORS,
  argentinaToday,
  formatDayLabel,
  formatNumber,
} from '../lib/metrics';

export default function MetricsListPaste({ store, saving, onSave, onDirty }) {
  const [aggregator, setAggregator] = useState(AWT_AGGREGATOR);
  const base = useRef(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(true);
  const today = argentinaToday();
  const showAwt = aggregator === AWT_AGGREGATOR;

  const parsed = useMemo(
    () => parseMetricList(text, { today }),
    [text, today],
  );

  useEffect(() => { onDirty?.(Boolean(text.trim())); }, [text, onDirty]);
  useEffect(() => { function warn(event) { if (text.trim()) { event.preventDefault(); event.returnValue = ''; } } window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [text]);
  const validation = parsed.rows.map(row => validateMetricFields(row.day, { [aggregator]: { orders: row.orders, complaints: row.complaints, ...(showAwt && row.hasAwt ? { awt: row.awt } : {}) } }, today)).filter(Boolean);
  async function handleApply() {
    if (parsed.rows.length === 0) return;
    const next = applyMetricList(base.current || store, aggregator, parsed.rows);
    const label = getAggregatorLabel(aggregator);
    const saved = await onSave(next, `Cargados ${parsed.rows.length} días de ${label}.`);
    if (saved) {setText('');base.current = null;}
  }

  return (
    <section className="metrics-paste">
      <div className="metrics-paste__top">
        <div>
          <h3>Pegar lista</h3>
          <p>
            Copiá desde Excel: fecha, pedidos, quejas
            {showAwt ? ' y AWT' : ''}. Un renglón por día.
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpen((value) => !value)}>
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>

      {open && (
        <>
          <label className="metrics-paste__aggregator">
            Agregador
            <select value={aggregator} onChange={(event) => setAggregator(event.target.value)}>
              {METRIC_AGGREGATORS.map((id) => (
                <option key={id} value={id}>
                  {getAggregatorLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="metrics-paste__input"
            value={text}
            onChange={(event) => { base.current ||= cloneMetricsForEdit(store); setText(event.target.value); }}
            rows={6}
            spellCheck={false}
            placeholder={
              showAwt
                ? 'Martes\t1-sept\t174\t5\t14\nMiércoles\t2-sept\t173\t3\t19'
                : '1-sept\t174\t5\n2-sept\t173\t3'
            }
            aria-label={`Lista de ${getAggregatorLabel(aggregator)}`}
          />
          {text.trim() && (
            <p className="metrics-paste__summary">
              {parsed.rows.length} día{parsed.rows.length === 1 ? '' : 's'} listos
              {parsed.errors.length > 0 ? ` · ${parsed.errors.length} renglón(es) sin leer` : ''}
            </p>
          )}
          {validation.length > 0 && <p className="message message--error">{validation.join(" · ")}</p>}
          {parsed.errors.length > 0 && (
            <p className="metrics-paste__errors" role="status">
              {parsed.errors[0].message}
              {parsed.errors.length > 1 ? ` (+${parsed.errors.length - 1})` : ''}
            </p>
          )}
          <button
            type="button"
            className="btn btn--primary metrics-paste__apply"
            onClick={handleApply}
            disabled={saving || parsed.rows.length === 0 || parsed.errors.length > 0 || validation.length > 0}
          >
            {saving ? 'Guardando…' : parsed.rows.length
              ? `Cargar ${parsed.rows.length} día${parsed.rows.length === 1 ? '' : 's'}`
              : 'Cargar lista'}
          </button>
          {parsed.rows.length > 0 && (
            <div className="metrics-table-wrap metrics-paste__preview">
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Pedidos</th>
                    <th>Quejas</th>
                    {showAwt && <th>AWT</th>}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row) => (
                    <tr key={row.day}>
                      <td>{formatDayLabel(row.day)}</td>
                      <td>{formatNumber(row.orders)}</td>
                      <td>{formatNumber(row.complaints)}</td>
                      {showAwt && <td>{formatNumber(row.awt)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
import { cloneMetricsForEdit } from '../lib/metricsBaseline';
