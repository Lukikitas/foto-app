import { useRef, useState } from 'react';
import { loadMetricsStore } from '../lib/metricsStore';
import { loadComplaintHistory } from '../lib/complaintHistoryStore';
import { mergeRappiHistory } from '../lib/rappiWorkbook';
import { importRappiReport } from '../lib/rappiImportService';
import { formatMoney } from '../lib/metrics';
import { getAggregatorLabel } from '../lib/aggregators';
import './PeyaExcelImport.css';

export default function RappiExcelImport({ disabled = false, onBusy }) {
  const input = useRef(null);
  const [aggregator, setAggregator] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function working(value) { setBusy(value); onBusy?.(value); }
  async function select(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setNotice(''); setPreview(null); working(true);
    try {
      const { readRappiFile } = await import('../lib/rappiWorkbookReader');
      const report = await readRappiFile(file, aggregator);
      const [metrics, history] = await Promise.all([loadMetricsStore({ strict: true }), loadComplaintHistory({ force: true, strict: true })]);
      const changes = mergeRappiHistory(history, report);
      setPreview({ report, metrics, filename: file.name, added: changes.added, updated: changes.updated });
    } catch (err) { setError(err.message || 'No se pudo leer el Excel.'); }
    finally { working(false); }
  }
  async function confirm() {
    working(true); setError(''); setNotice('');
    try {
      const result = await importRappiReport(preview.report);
      setNotice(getAggregatorLabel(preview.report.aggregator) + ': importación completa. ' + result.history.added + ' reclamos nuevos, ' + result.history.updated + ' existentes. Pedidos totales y AWT conservados. ' + result.warning);
      setPreview(null);
    } catch (err) { setError(err.message || 'No se pudo guardar. Podés reintentar.'); }
    finally { working(false); }
  }
  return (
    <section className="peya-import rappi-import" aria-label="Importar Excel Rappi">
      <div className="peya-import__heading">
        <div><h3>Excel Rappi / Rappi Turbo</h3><p>Solo reclamos de KFC - LA PLATA. Elegí la cuenta antes de cargar.</p></div>
        <label className="rappi-import__account">Cuenta del reporte
          <select aria-label="Cuenta del reporte" value={aggregator} disabled={disabled || busy} onChange={event => { setAggregator(event.target.value); setPreview(null); setError(''); setNotice(''); }}>
            <option value="">Seleccionar cuenta…</option><option value="rappi">Rappi</option><option value="rappi_turbo">Rappi Turbo</option>
          </select>
        </label>
        <button type="button" className="btn btn--ghost" disabled={!aggregator || disabled || busy} onClick={() => input.current?.click()}>Importar Excel Rappi</button>
        <input ref={input} type="file" accept=".xlsx" hidden onChange={select} />
      </div>
      {busy && <p role="status">Procesando el Excel…</p>}
      {error && <p className="message message--error" role="alert">{error}</p>}
      {notice && <p className="message message--success" role="status">{notice}</p>}
      {preview && <div className="peya-import__preview">
        <h4>Vista previa · {getAggregatorLabel(preview.report.aggregator)}</h4>
        <p>{preview.filename} · {preview.report.from.split('-').reverse().join('/')} al {preview.report.to.split('-').reverse().join('/')}</p>
        <p>{preview.report.complaints.length} reclamos: {preview.added} nuevos y {preview.updated} existentes. {preview.report.excluded} filas de otros locales excluidas. {preview.report.duplicates} duplicados omitidos.</p>
        <p>Compensación del restaurante: <strong>{formatMoney(preview.report.complaints.reduce((sum, c) => sum + (c.amount || 0), 0))}</strong>. «$» significa cero. {preview.report.missingAmounts > 0 ? preview.report.missingAmounts + ' reclamos sin monto informado.' : ''}</p>
        <p>Fechas sin hora. Se actualizarán únicamente las quejas de esta cuenta en el período. Se conservan pedidos totales, AWT, refutaciones, fotos y detalles existentes.</p>
        <details><summary>Ver quejas diarias: valores actuales → Excel</summary><div className="peya-import__table"><table><thead><tr><th>Fecha</th><th>Quejas</th></tr></thead>
          <tbody>{preview.report.daily.map(row => <tr key={row.day}><th>{row.day.split('-').reverse().join('/')}</th><td>{preview.metrics.days?.[row.day]?.[preview.report.aggregator]?.complaints ?? 'Sin datos'} → {row.complaints}</td></tr>)}</tbody>
        </table></div></details>
        <details open><summary>Ver los {preview.report.complaints.length} reclamos</summary><div className="peya-import__table"><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Motivo y detalle</th><th>Comentario del cliente</th><th>Compensación del restaurante</th></tr></thead>
          <tbody>{preview.report.complaints.map(c => <tr key={c.id}><td>{c.orderCode.replace(/^(RAPPITURBO|RAPPI)/, '')}</td><td>{c.day.split('-').reverse().join('/')}<br />Sin hora</td><td>{c.reason}<br />{c.fields['Detalle del motivo']}</td><td>{c.comment}</td><td>{c.amount == null ? 'Sin monto' : formatMoney(c.amount)}</td></tr>)}</tbody>
        </table></div></details>
        <div className="peya-import__actions"><button type="button" className="btn btn--primary" disabled={busy || disabled} onClick={confirm}>Importar reclamos</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Cancelar</button></div>
      </div>}
    </section>
  );
}
