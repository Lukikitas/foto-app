import { useMemo, useState } from 'react';
import { getAggregatorLabel } from '../lib/aggregators';
import { applyMetricList, parseMetricList } from '../lib/metricList';
import {
  AWT_AGGREGATOR,
  METRIC_AGGREGATORS,
  argentinaToday,
  formatDayLabel,
  formatNumber,
} from '../lib/metrics';

export default function MetricsListPaste({ store, saving, onSave }) {
  const [aggregator, setAggregator] = useState(AWT_AGGREGATOR);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(true);
  const today = argentinaToday();
  const showAwt = aggregator === AWT_AGGREGATOR;

  const parsed = useMemo(
    () => parseMetricList(text, { today }),
    [text, today],
  );

  function handleApply() {
    if (parsed.rows.length === 0) return;
    const next = applyMetricList(store, aggregator, parsed.rows);
    const label = getAggregatorLabel(aggregator);
    onSave(next, `Cargados ${parsed.rows.length} días de ${label}.`);
    setText('');
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
            onChange={(event) => setText(event.target.value)}
            rows={8}
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
          {parsed.errors.length > 0 && (
            <p className="metrics-paste__errors" role="status">
              {parsed.errors[0].message}
              {parsed.errors.length > 1 ? ` (+${parsed.errors.length - 1})` : ''}
            </p>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleApply}
            disabled={saving || parsed.rows.length === 0}
          >
            {saving ? 'Guardando…' : parsed.rows.length
              ? `Cargar ${parsed.rows.length} día${parsed.rows.length === 1 ? '' : 's'}`
              : 'Cargar lista'}
          </button>
        </>
      )}
    </section>
  );
}
