import { useMemo, useState } from 'react';
import { AGGREGATOR_OPTIONS, getAggregatorLabel, getPhotoAggregator } from '../lib/aggregators.js';
import {
  applyCodeListDefaults,
  codeListItem,
  complaintFromCodeItem,
  parseComplaintCodeList,
} from '../lib/complaintCodeList.js';
import { matchComplaintsToPhotos } from '../lib/complaintMatch.js';
import { importComplaintsSynchronized } from '../lib/complaintSynchronization.js';
import { fetchPhotosForComplaints } from '../lib/complaints.js';
import { toArgentinaDate } from '../lib/metrics.js';

export default function ComplaintCodeListImport({ disabled = false, onBusy, onImported }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [invalid, setInvalid] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [bulkDay, setBulkDay] = useState('');
  const [bulkAggregator, setBulkAggregator] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const unresolved = useMemo(() => items.filter((item) => !item.photo), [items]);

  function working(value) {
    setBusy(value);
    onBusy?.(value);
  }

  async function analyze(event) {
    event.preventDefault();
    setError(''); setNotice('');
    const parsed = parseComplaintCodeList(text);
    setInvalid(parsed.invalid);
    setDuplicates(parsed.duplicates);
    if (!parsed.valid.length) {
      setItems([]);
      setError('No encontré códigos válidos para buscar.');
      return;
    }
    working(true);
    try {
      const complaints = parsed.valid.map((orderCode) => ({ orderCode }));
      const photos = await fetchPhotosForComplaints(complaints);
      const matches = matchComplaintsToPhotos(complaints, photos);
      const next = parsed.valid.map((code, index) => codeListItem(code, matches[index]));
      setItems(next);
      setSelected(new Set(next.filter((item) => !item.photo).map((item) => item.key)));
    } catch (failure) {
      setError(failure.message || 'No se pudieron buscar los códigos en la galería.');
    } finally {
      working(false);
    }
  }

  function updateItem(key, patch) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function choosePhoto(item, photoId) {
    const photo = item.candidates.find((candidate) => candidate.id === photoId) || null;
    updateItem(item.key, {
      photo,
      status: photo ? 'matched' : 'ambiguous',
      day: photo?.created_at ? toArgentinaDate(photo.created_at) : '',
      aggregator: getPhotoAggregator(photo) || '',
    });
  }

  function toggleSelected(key) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function applyBulk() {
    if (!bulkDay && !bulkAggregator) return;
    setItems((current) => applyCodeListDefaults(current, selected, {
      day: bulkDay,
      aggregator: bulkAggregator,
    }));
  }

  async function confirm() {
    setError(''); setNotice('');
    let complaints;
    try {
      complaints = items.map(complaintFromCodeItem);
    } catch (failure) {
      setError(failure.message);
      return;
    }
    working(true);
    try {
      const rows = items.map((item, index) => ({
        complaint: complaints[index],
        photo: item.photo,
        status: item.photo ? 'matched' : 'unmatched',
        candidates: item.candidates,
      }));
      const result = await importComplaintsSynchronized(complaints, rows);
      setNotice(`${complaints.length} reclamos cargados: ${result.added} nuevos y ${result.updated} existentes.`);
      onImported?.({ complaints, rows, result });
      setText('');
      setItems([]);
      setSelected(new Set());
    } catch (failure) {
      setError(failure.message || 'No se pudieron cargar los reclamos. Podés reintentar sin duplicarlos.');
    } finally {
      working(false);
    }
  }

  return (
    <section className="code-list-import" aria-label="Cargar lista de códigos con reclamo">
      <h3>Lista de códigos con reclamo</h3>
      <p>Pegá una columna o lista. La fecha y el agregador se toman de la foto; si no existe, completalos abajo.</p>
      <form onSubmit={analyze}>
        <label>Códigos
          <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)}
            placeholder={'PEYA-2277060160\n478947179\nMPD48024738630'} disabled={disabled || busy} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={disabled || busy || !text.trim()}>
          {busy ? 'Buscando…' : 'Buscar en la galería'}
        </button>
      </form>
      {invalid.length > 0 && <p className="message message--error" role="alert">No válidos: {invalid.join(', ')}</p>}
      {duplicates.length > 0 && <p className="complaints__hint">Duplicados omitidos: {duplicates.join(', ')}</p>}
      {error && <p className="message message--error" role="alert">{error}</p>}
      {notice && <p className="message message--success" role="status">{notice}</p>}
      {items.length > 0 && <div className="code-list-import__preview">
        <p><strong>{items.length} códigos</strong> · {items.length - unresolved.length} con foto · {unresolved.length} sin foto</p>
        <div className="code-list-import__bulk">
          <label>Fecha para seleccionados<input type="date" value={bulkDay} onChange={(event) => setBulkDay(event.target.value)} /></label>
          <label>Agregador para seleccionados<select value={bulkAggregator} onChange={(event) => setBulkAggregator(event.target.value)}>
            <option value="">Sin cambiar</option>{AGGREGATOR_OPTIONS.map((agg) => <option key={agg.id} value={agg.id}>{agg.label}</option>)}
          </select></label>
          <button type="button" className="btn btn--ghost" onClick={applyBulk} disabled={!selected.size}>Aplicar a {selected.size} seleccionados</button>
        </div>
        <div className="code-list-import__rows">
          {items.map((item) => <article key={item.key} className="code-list-import__row">
            <label className="checkbox-label"><input type="checkbox" checked={selected.has(item.key)} onChange={() => toggleSelected(item.key)} /><span>{item.code}</span></label>
            {item.status === 'ambiguous' && <label>Elegir foto<select value={item.photo?.id || ''} onChange={(event) => choosePhoto(item, event.target.value)}>
              <option value="">Seleccionar…</option>{item.candidates.map((photo) => <option key={photo.id} value={photo.id}>{photo.name} · {toArgentinaDate(photo.created_at)} · {getAggregatorLabel(getPhotoAggregator(photo))}</option>)}
            </select></label>}
            {item.photo && <p className="code-list-import__match">Foto encontrada · {item.day || 'sin fecha'} · {item.aggregator ? getAggregatorLabel(item.aggregator) : 'sin agregador'}</p>}
            {(!item.photo || !item.day || !item.aggregator) && <div className="code-list-import__missing">
              <label>Fecha<input type="date" value={item.day} onChange={(event) => updateItem(item.key, { day: event.target.value })} /></label>
              <label>Agregador<select value={item.aggregator} onChange={(event) => updateItem(item.key, { aggregator: event.target.value })}>
                <option value="">Elegir…</option>{AGGREGATOR_OPTIONS.map((agg) => <option key={agg.id} value={agg.id}>{agg.label}</option>)}
              </select></label>
            </div>}
          </article>)}
        </div>
        <div className="peya-import__actions"><button type="button" className="btn btn--primary" onClick={confirm} disabled={busy || disabled}>Cargar reclamos</button>
          <button type="button" className="btn btn--ghost" onClick={() => { setItems([]); setError(''); }} disabled={busy}>Cancelar</button></div>
      </div>}
    </section>
  );
}
