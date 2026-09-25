import { useRef, useState } from 'react';
import { loadMetricsStore } from '../lib/metricsStore';
import { loadComplaintHistory } from '../lib/complaintHistoryStore';
import { mergePeyaHistory } from '../lib/peyaWorkbook';
import { importPeyaReport } from '../lib/peyaImportService';
import { formatMoney } from '../lib/metrics';
import './PeyaExcelImport.css';

export default function PeyaExcelImport({ disabled = false, onBusy }) {
  const input = useRef(null);
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
      const { readPeyaFile } = await import('../lib/peyaWorkbookReader');
      const report = await readPeyaFile(file);
      const [metrics, history] = await Promise.all([loadMetricsStore({ strict: true }), loadComplaintHistory({ force: true, strict: true })]);
      const changes = mergePeyaHistory(history, report);
      setPreview({ report, metrics, filename: file.name, added: changes.added, updated: changes.updated });
    } catch (err) { setError(err.message || 'No se pudo leer el Excel.'); }
    finally { working(false); }
  }
  async function confirm() {
    working(true); setError(''); setNotice('');
    try {
      const result = await importPeyaReport(preview.report);
      setNotice('Importación completa: ' + result.history.added + ' reclamos nuevos, ' + result.history.updated + ' existentes y ' + preview.report.daily.length + ' días actualizados. ' + result.warning);
      setPreview(null);
    } catch (err) { setError(err.message || 'No se pudo guardar. Podés reintentar.'); }
    finally { working(false); }
  }
  return (
    <section className="peya-import" aria-label="Importar Excel PedidosYa">
      <div className="peya-import__heading">
        <div><h3>Excel PedidosYa</h3><p>Reclamos, pedidos y AWT · Solo KFC - LA PLATA</p></div>
        <button type="button" className="btn btn--ghost" disabled={disabled || busy} onClick={() => input.current?.click()}>Importar Excel PedidosYa</button>
        <input ref={input} type="file" accept=".xlsx" hidden onChange={select} />
      </div>
      {busy && <p role="status">Procesando… El archivo puede tardar unos segundos.</p>}
      {error && <p className="message message--error" role="alert">{error}</p>}
      {notice && <p className="message message--success" role="status">{notice}</p>}
      {preview && <div className="peya-import__preview">
        <h4>Vista previa · {preview.filename}</h4>
        <p>{preview.report.complaints.length} reclamos de La Plata: {preview.added} nuevos y {preview.updated} existentes. {preview.report.excluded} filas de otros locales excluidas. {preview.report.duplicates} duplicados idénticos omitidos.</p>
        <p>Se reemplazarán los valores diarios de PedidosYa. Los detalles ya cargados, estados de refutación y fotos se conservan; se completan los campos faltantes.</p>
        <div className="peya-import__table"><table>
          <caption>Valores actuales → valores del Excel</caption>
          <thead><tr><th>Fecha</th><th>Pedidos</th><th>Quejas</th><th>AWT</th></tr></thead>
          <tbody>{preview.report.daily.map(row => <tr key={row.day}><th>{row.day.split('-').reverse().join('/')}</th>{['orders','complaints','awt'].map(key => <td key={key}>{preview.metrics.days?.[row.day]?.pedidosya?.[key] ?? 'Sin datos'} → <strong>{row[key]}</strong></td>)}</tr>)}</tbody>
        </table></div>
        <details><summary>Ver los {preview.report.complaints.length} reclamos</summary>
          <div className="peya-import__table"><table><thead><tr><th>Pedido</th><th>Fecha / hora</th><th>Motivo / comentario</th><th>Producto / nombre opcional</th><th>Monto</th></tr></thead>
            <tbody>{preview.report.complaints.map(c => <tr key={c.id}><td>{c.orderCode}</td><td>{c.id.split('|')[1]} {c.timeOfDay}</td><td>{c.reason}<br />{c.comment}</td><td>{c.combo}<br />{c.fields['Nombre opcional']}</td><td>{c.amount == null ? 'Sin monto' : formatMoney(c.amount)}</td></tr>)}</tbody>
          </table></div>
        </details>
        <div className="peya-import__actions">
          <button type="button" className="btn btn--primary" disabled={busy || disabled} onClick={confirm}>Importar</button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Cancelar</button>
        </div>
      </div>}
    </section>
  );
}
