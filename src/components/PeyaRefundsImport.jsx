import { useRef, useState } from 'react';
import { loadComplaintHistory } from '../lib/complaintHistoryStore';
import { previewPeyaRefunds } from '../lib/peyaRefunds';
import { importPeyaRefunds } from '../lib/peyaRefundsService';
import { COMPLAINT_STATUS_LABELS } from '../lib/complaintHistory';
import './PeyaExcelImport.css';

export default function PeyaRefundsImport({ disabled = false, onBusy }) {
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
      const { readPeyaRefundsFile } = await import('../lib/peyaRefundsReader');
      const report = await readPeyaRefundsFile(file);
      const history = await loadComplaintHistory({ force: true, strict: true });
      setPreview({ report, filename: file.name, summary: previewPeyaRefunds(history, report), saved: false });
    } catch (err) { setError(err.message || 'No se pudo leer el Excel.'); }
    finally { working(false); }
  }
  async function confirm() {
    working(true); setError(''); setNotice('');
    try {
      const result = await importPeyaRefunds(preview.report);
      setNotice(result.updated + ' quejas actualizadas como refutado aceptado.');
      setPreview({ ...preview, summary: result.summary, saved: true });
    } catch (err) { setError((err.message || 'No se pudo guardar.') + ' Podés reintentar: los pedidos ya aceptados no se duplican.'); }
    finally { working(false); }
  }
  const summary = preview?.summary;
  return <section className="peya-import refunds-import" aria-label="Importar refutados aceptados">
    <div className="peya-import__heading">
      <div><h3>Refutados aceptados · PedidosYa</h3><p>Hoja Reintegros: solo KFC - La Plata y pedidos con DS.</p></div>
      <button type="button" className="btn btn--ghost" disabled={disabled || busy} onClick={() => input.current?.click()}>Importar refutados aceptados</button>
      <input ref={input} type="file" accept=".xls,.xlsx" hidden onChange={select} />
    </div>
    {busy && <p role="status">Procesando reintegros…</p>}
    {error && <p className="message message--error" role="alert">{error}</p>}
    {notice && <p className="message message--success" role="status">{notice}</p>}
    {preview && <div className="peya-import__preview">
      <h4>{preview.saved ? 'Resultado' : 'Vista previa'} · Refutados aceptados</h4>
      <p>{preview.filename}</p>
      <p>{preview.report.orders.length} pedidos DS de La Plata. {preview.report.ignored} filas del local sin DS ignoradas; {preview.report.excluded} filas de otros locales excluidas; {preview.report.duplicates} duplicados omitidos.</p>
      <p>{summary.toUpdate.length} {preview.saved ? 'actualizados' : 'a actualizar'}; {summary.alreadyAccepted.length} ya aceptados.</p>
      {summary.missing.length > 0 && <div role="alert" className="message message--error"><strong>{summary.missing.length} pedidos DS no encontrados en el historial de PedidosYa. No se crearán quejas.</strong><ul>{summary.missing.map(order => <li key={order.code}>Pedido {order.code} · fila {order.row}</li>)}</ul></div>}
      {summary.ambiguous.length > 0 && <div role="alert" className="message message--error"><strong>Estos pedidos tienen varias quejas en el historial y no se modificarán. Revisalos manualmente.</strong><ul>{summary.ambiguous.map(order => <li key={order.code}>Pedido {order.code} · fila {order.row}</li>)}</ul></div>}
      {summary.toUpdate.length > 0 && <div className="peya-import__table"><table><thead><tr><th>Pedido</th><th>Estado anterior</th><th>Nuevo estado</th></tr></thead><tbody>{summary.toUpdate.map(order => <tr key={order.code}><td>{order.code}</td><td>{COMPLAINT_STATUS_LABELS[order.previousStatus] || order.previousStatus}</td><td>Refutado aceptado</td></tr>)}</tbody></table></div>}
      <p>Se conserva toda la información de las quejas. Este archivo solo actualiza su estado.</p>
      <div className="peya-import__actions">
        {!preview.saved && <button type="button" className="btn btn--primary" disabled={busy || disabled || !summary.toUpdate.length} onClick={confirm}>Actualizar refutados aceptados</button>}
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>{preview.saved ? 'Cerrar' : 'Cancelar'}</button>
      </div>
    </div>}
  </section>;
}
