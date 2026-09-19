import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../lib/date';
import {
  AGGREGATOR_OPTIONS,
  aggregatorBadgeClass,
  detectAggregator,
  getAggregatorLabel,
  getComplaintAggregator,
  getPartnerPortal,
  openPartnerPortal,
  PARTNER_PORTALS,
} from '../lib/aggregators';
import {
  attachHistoryToRows,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUSES,
  historyItemToRow,
  listHistoryItems,
} from '../lib/complaintHistory';
import {
  fetchComplaintSheetText,
  parseComplaintSheet,
} from '../lib/complaintSheet';
import {
  clipboardOrderCode,
  complaintPhotoStatus,
  complaintRowStatus,
  matchComplaintsToPhotos,
} from '../lib/complaintMatch';
import { formatMoney } from '../lib/metrics';
import {
  cachedComplaintHistory,
  deleteHistoryItemById,
  importComplaintsToHistory,
  loadComplaintHistory,
  setHistoryPhoto,
  setHistoryResolution,
  setHistoryResolutions,
} from '../lib/complaintHistoryStore';
import {
  applyComplaintToPhoto,
  applyComplaintsToPhotos,
  buildComplaintExport,
  clearComplaintBatch,
  copyText,
  downloadTextFile,
  fetchPhotosForComplaints,
  getEvidenceFilename,
  loadComplaintBatch,
  replacePhotosInRows,
  saveComplaintBatch,
  uploadComplaintPhotoFile,
} from '../lib/complaints';
import { downloadPhoto, isImagePhoto } from '../lib/photos';
import { getSavedSheetUrl, saveSheetUrl } from '../lib/storage';
import ComplaintEvidenceUpload from './ComplaintEvidenceUpload';
import PhotoLightbox from './PhotoLightbox';

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: COMPLAINT_STATUSES.queja, label: 'Queja' },
  { id: COMPLAINT_STATUSES.refutado, label: 'Refutado' },
  { id: COMPLAINT_STATUSES.refutado_aceptado, label: 'Ref. aceptado' },
  { id: COMPLAINT_STATUSES.refutado_rechazado, label: 'Ref. rechazado' },
  { id: 'con_foto', label: 'Con foto' },
  { id: 'sin_foto', label: 'Sin foto' },
  { id: 'ambiguo', label: 'A revisar' },
];

const PORTAL_LINKS = [PARTNER_PORTALS.pedidosya, PARTNER_PORTALS.rappi];
const HISTORY_AGGREGATORS = [{ id: 'all', label: 'Todos' }, ...AGGREGATOR_OPTIONS];

function formatComplaintWhen(complaint) {
  if (complaint.orderAtIso) return formatDateTime(complaint.orderAtIso);
  if (complaint.timeOfDay) {
    return complaint.dateAssumed ? `${complaint.timeOfDay} · sin fecha` : complaint.timeOfDay;
  }
  return '—';
}

function statusLabel(status) {
  if (COMPLAINT_STATUS_LABELS[status]) return COMPLAINT_STATUS_LABELS[status];
  if (status === 'con_foto') return 'Con foto';
  if (status === 'ambiguo') return 'Elegí la foto';
  if (status === 'sin_foto') return 'Sin foto';
  return status;
}

function statusBadgeClass(status) {
  if (status === 'refutado_aceptado') return 'badge badge--refutado-aceptado';
  if (status === 'refutado_rechazado') return 'badge badge--aceptado';
  if (status === 'refutado') return 'badge badge--refutado';
  if (status === 'queja') return 'badge badge--complaint';
  if (status === 'sin_foto') return 'badge badge--file';
  if (status === 'ambiguo') return 'badge badge--missing-code';
  return 'badge';
}

function rowMatchesFilter(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'con_foto' || filter === 'sin_foto' || filter === 'ambiguo') {
    return complaintPhotoStatus(row) === filter;
  }
  return complaintRowStatus(row) === filter;
}

function sourceAmount(rows) {
  return rows.reduce((sum, row) => sum + (Number(row.history?.amount ?? row.complaint?.amount) || 0), 0);
}

function readStoredBatch() {
  return loadComplaintBatch() || { complaints: [], pickedPhotoIds: {} };
}

function historyFromResult(result) {
  return result?.store || result;
}

export default function ComplaintsInbox() {
  const [storedBatch] = useState(readStoredBatch);
  const [pasteText, setPasteText] = useState('');
  const [sheetUrl, setSheetUrl] = useState(getSavedSheetUrl);
  const [complaints, setComplaints] = useState(storedBatch.complaints);
  const [photos, setPhotos] = useState([]);
  const [rows, setRows] = useState([]);
  const [historyStore, setHistoryStore] = useState(cachedComplaintHistory);
  const [pickedPhotoIds, setPickedPhotoIds] = useState(storedBatch.pickedPhotoIds);
  const [skipped, setSkipped] = useState(0);
  const [filter, setFilter] = useState('all');
  const [inboxView, setInboxView] = useState('cruzar');
  const [historyAggregator, setHistoryAggregator] = useState('all');
  const [historySearch, setHistorySearch] = useState('');
  const [loading, setLoading] = useState(storedBatch.complaints.length > 0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [importOpen, setImportOpen] = useState(storedBatch.complaints.length === 0);

  const rematch = useCallback((nextComplaints, nextPicks, nextPhotos) => {
    const matched = matchComplaintsToPhotos(nextComplaints, nextPhotos, nextPicks);
    setRows(matched);
    return matched;
  }, []);

  const loadAndMatch = useCallback(
    async (nextComplaints, nextPicks = {}) => {
      const data = await fetchPhotosForComplaints(nextComplaints);
      setPhotos(data);
      return rematch(nextComplaints, nextPicks, data);
    },
    [rematch],
  );

  useEffect(() => {
    let cancelled = false;
    loadComplaintHistory()
      .then((store) => {
        if (!cancelled) setHistoryStore(store);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'No se pudo leer el historial de reclamos.');
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storedBatch.complaints.length) return undefined;
    let cancelled = false;

    fetchPhotosForComplaints(storedBatch.complaints)
      .then((data) => {
        if (cancelled) return;
        setPhotos(data);
        rematch(storedBatch.complaints, storedBatch.pickedPhotoIds || {}, data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'No se pudieron cruzar los reclamos.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rematch, storedBatch]);

  const rowsWithHistory = useMemo(
    () => attachHistoryToRows(rows, historyStore),
    [rows, historyStore],
  );

  const visibleRows = useMemo(
    () => rowsWithHistory.filter((row) => rowMatchesFilter(row, filter)),
    [rowsWithHistory, filter],
  );

  const historyBaseRows = useMemo(() => {
    return listHistoryItems(historyStore, {
      aggregator: historyAggregator,
      search: historySearch,
    }).map((item) => historyItemToRow(item, photos));
  }, [historyStore, historyAggregator, historySearch, photos]);

  const historyRows = useMemo(
    () => historyBaseRows.filter((row) => rowMatchesFilter(row, filter)),
    [historyBaseRows, filter],
  );

  const activeRows = inboxView === 'historial' ? historyRows : visibleRows;

  const stats = useMemo(() => {
    const source = inboxView === 'historial' ? historyBaseRows : rowsWithHistory;
    const counts = {
      all: source.length,
      con_foto: 0,
      sin_foto: 0,
      ambiguo: 0,
      queja: 0,
      refutado: 0,
      refutado_aceptado: 0,
      refutado_rechazado: 0,
    };
    source.forEach((row) => {
      const status = complaintRowStatus(row);
      if (counts[status] != null) counts[status] += 1;
      const photoStatus = complaintPhotoStatus(row);
      if (counts[photoStatus] != null) counts[photoStatus] += 1;
    });
    return counts;
  }, [inboxView, historyBaseRows, rowsWithHistory]);

  const quejasAbiertas = useMemo(
    () => rowsWithHistory.filter((row) => complaintRowStatus(row) === COMPLAINT_STATUSES.queja),
    [rowsWithHistory],
  );
  const rowsWithPhotos = useMemo(
    () => rowsWithHistory.filter((row) => row.photo),
    [rowsWithHistory],
  );

  async function importText(text) {
    const parsed = parseComplaintSheet(text);
    if (parsed.complaints.length === 0) {
      throw new Error('No encontré códigos de pedido. Copiá las columnas de código, hora y motivo.');
    }
    setComplaints(parsed.complaints);
    setPickedPhotoIds({});
    setSkipped(parsed.skipped);
    setFilter('all');
    const matched = await loadAndMatch(parsed.complaints, {});
    saveComplaintBatch(parsed.complaints, {});
    const result = await importComplaintsToHistory(parsed.complaints, matched);
    setHistoryStore(historyFromResult(result));
    if (sheetUrl.trim()) saveSheetUrl(sheetUrl);
    setImportOpen(false);
    setNotice(
      `${parsed.complaints.length} reclamos cruzados · ${result.added} nuevos en historial · ${result.updated} ya estaban (sin duplicar).`,
    );
  }

  async function runImport(reader) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await importText(await reader());
    } catch (err) {
      setError(err.message || 'No se pudo leer el Sheet.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (pasteText.trim()) {
      await runImport(() => pasteText);
      return;
    }
    if (sheetUrl.trim()) {
      await runImport(() => fetchComplaintSheetText(sheetUrl));
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await runImport(() => file.text());
  }

  async function handleUrl() {
    if (!sheetUrl.trim()) return;
    await runImport(() => fetchComplaintSheetText(sheetUrl));
  }

  function applyUpdatedPhotos(updatedList) {
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    updatedList.forEach((photo) => {
      if (photo?.id) byId.set(photo.id, photo);
    });
    const nextPhotos = [...byId.values()];
    setPhotos(nextPhotos);
    setRows(replacePhotosInRows(rows, updatedList));
    return nextPhotos;
  }

  function pickPhoto(complaintId, photoId) {
    const nextPicks = { ...pickedPhotoIds, [complaintId]: photoId };
    setPickedPhotoIds(nextPicks);
    rematch(complaints, nextPicks, photos);
    saveComplaintBatch(complaints, nextPicks);
  }

  async function markRow(row, { status } = {}) {
    setLoading(true);
    setError(null);
    try {
      const disputed = status && status !== COMPLAINT_STATUSES.queja;
      const jobs = [];
      if (row.photo?.id && disputed) {
        jobs.push(
          applyComplaintToPhoto(row.photo, row.complaint, { refutado: true }).then((updated) => {
            applyUpdatedPhotos([updated]);
            return updated;
          }),
        );
      } else {
        jobs.push(Promise.resolve(row.photo));
      }
      jobs.push(setHistoryResolution(row.complaint, row.photo, { status }));
      const [, history] = await Promise.all(jobs);
      setHistoryStore(historyFromResult(history));
      setNotice(`Pedido ${row.complaint.orderCode} marcado como ${statusLabel(status)}.`);
    } catch (err) {
      setError(err.message || 'No se pudo actualizar el reclamo.');
    } finally {
      setLoading(false);
    }
  }

  async function uploadRowPhoto(row, file) {
    setLoading(true);
    setError(null);
    try {
      const photo = await uploadComplaintPhotoFile(
        file,
        row.complaint,
        getComplaintAggregator(row.complaint, row.photo),
      );
      const nextPhotos = applyUpdatedPhotos([photo]);
      const nextPicks = row.complaint.id ? { ...pickedPhotoIds, [row.complaint.id]: photo.id } : pickedPhotoIds;
      setPickedPhotoIds(nextPicks);
      rematch(complaints, nextPicks, nextPhotos);
      saveComplaintBatch(complaints, nextPicks);
      const history = await setHistoryPhoto(row.complaint, photo);
      setHistoryStore(historyFromResult(history));
      setNotice(`Foto cargada en ${row.complaint.orderCode}.`);
    } catch (err) {
      setError(err.message || 'No se pudo subir la foto.');
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(row) {
    const id = row.history?.id;
    if (!id) return;
    if (!window.confirm(`¿Borrar la queja ${row.complaint.orderCode}?`)) return;
    setLoading(true);
    setError(null);
    try {
      const history = await deleteHistoryItemById(id);
      setHistoryStore(historyFromResult(history));
      setNotice(`Se borró ${row.complaint.orderCode}.`);
    } catch (err) {
      setError(err.message || 'No se pudo borrar la queja.');
    } finally {
      setLoading(false);
    }
  }

  async function downloadEvidence(row) {
    if (!row.photo) return;
    setError(null);
    try {
      await downloadPhoto(row.photo, new Set(), getEvidenceFilename(row.complaint, row.photo));
    } catch (err) {
      setError(err.message || 'No se pudo descargar la evidencia.');
    }
  }

  function rowClipboardCode(row) {
    return clipboardOrderCode(row.photo?.name || row.complaint.orderCode);
  }

  async function copyCode(row) {
    const code = rowClipboardCode(row);
    try {
      await copyText(code);
      setNotice(`Código ${code} copiado.`);
    } catch {
      setError('No se pudo copiar el código.');
    }
  }

  function portalFor(row) {
    return getPartnerPortal(getComplaintAggregator(row.complaint, row.photo));
  }

  async function openPortal(row) {
    const code = rowClipboardCode(row);
    const portal = openPartnerPortal(getComplaintAggregator(row.complaint, row.photo));
    if (!portal) {
      setError('Este agregador no tiene portal web para abrir desde la app.');
      return;
    }
    try {
      await copyText(code);
      setNotice(`Se abrió ${portal.label}. Código ${code} copiado para buscarlo ahí.`);
    } catch {
      setNotice(`Se abrió ${portal.label}.`);
    }
  }

  async function copyLink(row) {
    if (!row.photo) return;
    try {
      await copyText(row.photo.public_url);
      setNotice('Link de la foto copiado.');
    } catch {
      setError('No se pudo copiar el link.');
    }
  }

  async function prepareEvidence(row) {
    if (!row.photo) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await applyComplaintToPhoto(row.photo, row.complaint, { refutado: false });
      applyUpdatedPhotos([updated]);
      const history = await setHistoryResolution(row.complaint, updated, {});
      setHistoryStore(historyFromResult(history));
      const code = clipboardOrderCode(updated.name || row.complaint.orderCode);
      await downloadPhoto(updated, new Set(), getEvidenceFilename(row.complaint, updated));
      await copyText(code);
      const portal = openPartnerPortal(getComplaintAggregator(row.complaint, updated));
      setNotice(
        portal
          ? `Se abrió ${portal.label}. Buscá ${code} y adjuntá la foto descargada.`
          : `Código ${code} copiado y foto descargada.`,
      );
    } catch (err) {
      setError(err.message || 'No se pudo preparar la evidencia.');
    } finally {
      setLoading(false);
    }
  }

  async function markMany(targetRows, { status } = {}) {
    if (targetRows.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const disputed = status && status !== COMPLAINT_STATUSES.queja;
      const photoRows = targetRows.filter((row) => row.photo?.id);
      const updated = photoRows.length
        ? await applyComplaintsToPhotos(photoRows, { refutado: Boolean(disputed) })
        : [];
      if (updated.length) applyUpdatedPhotos(updated);
      const history = await setHistoryResolutions(targetRows, { status });
      setHistoryStore(historyFromResult(history));
      setNotice(`${targetRows.length} pedidos marcados como ${statusLabel(status)}.`);
    } catch (err) {
      setError(err.message || 'No se pudieron actualizar los reclamos.');
    } finally {
      setLoading(false);
    }
  }

  async function downloadMatchedEvidence() {
    if (rowsWithPhotos.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const usedNames = new Set();
      for (const row of rowsWithPhotos) {
        await downloadPhoto(
          row.photo,
          usedNames,
          getEvidenceFilename(row.complaint, row.photo),
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      setNotice(`${rowsWithPhotos.length} evidencias descargadas.`);
    } catch (err) {
      setError(err.message || 'No se pudieron descargar las evidencias.');
    } finally {
      setLoading(false);
    }
  }

  function exportSheet() {
    const csv = buildComplaintExport(inboxView === 'historial' ? historyRows : rowsWithHistory);
    downloadTextFile(inboxView === 'historial' ? 'historial-reclamos.csv' : 'reclamos-con-fotos.csv', csv);
    setNotice('CSV listo para pegar de vuelta en el Google Sheet.');
  }

  function handleClear() {
    clearComplaintBatch();
    setComplaints([]);
    setPhotos([]);
    setRows([]);
    setPickedPhotoIds({});
    setSkipped(0);
    setNotice(null);
    setError(null);
    setImportOpen(true);
  }

  const historyCount = Object.keys(historyStore.items || {}).length;
  const showCruzarList = inboxView === 'cruzar' && rowsWithHistory.length > 0;
  const showHistoryList = inboxView === 'historial';

  return (
    <section className="complaints">
      <h2 className="gallery__title">Reclamos</h2>
      <p className="complaints__lead">
        Pegá el Excel del día (código, monto, combo y el resto de columnas). Cruzamos las
        fotos, guardamos todas las quejas y después marcás Queja → Refutado → Ref. aceptado
        o Ref. rechazado. La plata recuperada se ve en Métricas.
      </p>

      <div className="complaints__portals">
        {PORTAL_LINKS.map((portal) => (
          <a
            key={portal.url}
            className="btn btn--ghost btn--small"
            href={portal.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir {portal.label}
          </a>
        ))}
      </div>

      <div className="gallery__view-toggle complaints__views" role="tablist" aria-label="Vista de reclamos">
        <button
          type="button"
          className={`gallery__view-btn${inboxView === 'cruzar' ? ' gallery__view-btn--active' : ''}`}
          onClick={() => setInboxView('cruzar')}
          role="tab"
          aria-selected={inboxView === 'cruzar'}
        >
          Cruzar
        </button>
        <button
          type="button"
          className={`gallery__view-btn${inboxView === 'historial' ? ' gallery__view-btn--active' : ''}`}
          onClick={() => setInboxView('historial')}
          role="tab"
          aria-selected={inboxView === 'historial'}
        >
          Historial{historyCount ? ` ${historyCount}` : ''}
        </button>
      </div>

      {inboxView === 'cruzar' && rowsWithHistory.length > 0 && (
        <button
          type="button"
          className={`gallery__filters-toggle${importOpen ? ' gallery__filters-toggle--open' : ''}`}
          onClick={() => setImportOpen((open) => !open)}
          aria-expanded={importOpen}
        >
          {importOpen ? 'Cerrar carga' : 'Cargar otro Sheet'}
        </button>
      )}

      {inboxView === 'cruzar' && importOpen && (
        <form className="complaints__import" onSubmit={handleSubmit}>
          <label className="complaints__field">
            <span>Pegar celdas del Google Sheet</span>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              placeholder="Código, hora, monto, combo, motivo…"
              disabled={loading}
            />
          </label>

          <div className="complaints__import-actions">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || (!pasteText.trim() && !sheetUrl.trim())}
            >
              {loading ? 'Cruzando…' : 'Cruzar con fotos'}
            </button>
            <label className="btn btn--ghost complaints__file-btn">
              Subir CSV
              <input type="file" accept=".csv,text/csv,text/tab-separated-values,.tsv,text/plain" onChange={handleFile} hidden />
            </label>
          </div>

          <label className="complaints__field">
            <span>O link del Google Sheet (compartido con enlace)</span>
            <div className="complaints__url-row">
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/…"
                disabled={loading}
              />
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleUrl}
                disabled={loading || !sheetUrl.trim()}
              >
                Leer link
              </button>
            </div>
          </label>
        </form>
      )}

      {error && (
        <p className="message message--error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message message--success" role="status">
          {notice}
        </p>
      )}

      {showHistoryList && (
        <div className="complaints__history-tools">
          <div className="gallery__view-toggle complaints__filters" role="group" aria-label="Agregador">
            {HISTORY_AGGREGATORS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`gallery__view-btn${historyAggregator === item.id ? ' gallery__view-btn--active' : ''}`}
                onClick={() => setHistoryAggregator(item.id)}
                aria-pressed={historyAggregator === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="complaints__field complaints__search">
            <span>Buscar en el historial</span>
            <input
              type="search"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Código, motivo o comentario"
            />
          </label>
        </div>
      )}

      {(showCruzarList || showHistoryList) && (
        <>
          <div className="complaints__summary">
            <p className="gallery__count">
              {stats.all} reclamo{stats.all !== 1 ? 's' : ''}
              {inboxView === 'cruzar' && skipped ? ` · ${skipped} filas sin código` : ''}
              {` · ${formatMoney(sourceAmount(inboxView === 'historial' ? historyBaseRows : rowsWithHistory))} en quejas`}
            </p>
            {inboxView === 'cruzar' && (
              <button type="button" className="btn btn--ghost btn--small" onClick={handleClear}>
                Limpiar
              </button>
            )}
          </div>

          <div className="gallery__view-toggle complaints__filters" role="group" aria-label="Filtrar reclamos">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`gallery__view-btn${filter === item.id ? ' gallery__view-btn--active' : ''}`}
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
              >
                {item.label}
                {stats[item.id] ? ` ${stats[item.id]}` : ''}
              </button>
            ))}
          </div>

          {inboxView === 'cruzar' && (quejasAbiertas.length > 0 || rowsWithPhotos.length > 0) && (
            <div className="complaints__batch">
              {quejasAbiertas.length > 0 && (
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => markMany(quejasAbiertas, { status: COMPLAINT_STATUSES.refutado })}
                  disabled={loading}
                >
                  Marcar refutados
                </button>
              )}
              {rowsWithPhotos.length > 0 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={downloadMatchedEvidence}
                  disabled={loading}
                >
                  Descargar evidencias
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={exportSheet}
                disabled={loading}
              >
                Exportar CSV
              </button>
            </div>
          )}

          {inboxView === 'historial' && activeRows.length > 0 && (
            <div className="complaints__batch">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={exportSheet}
                disabled={loading}
              >
                Exportar CSV
              </button>
            </div>
          )}

          {((loading && inboxView === 'cruzar') || (historyLoading && inboxView === 'historial')) && activeRows.length === 0 && (
            <div className="gallery__state">
              <div className="spinner" aria-hidden="true" />
              <p>{inboxView === 'historial' ? 'Leyendo historial…' : 'Cruzando reclamos con las fotos…'}</p>
            </div>
          )}

          {activeRows.length === 0 && !loading && !historyLoading && (
            <div className="gallery__state gallery__state--empty">
              <p>
                {inboxView === 'historial'
                  ? 'Todavía no hay reclamos en el historial. Cruzá un Sheet para empezar a cargarlo.'
                  : 'No hay reclamos en este filtro.'}
              </p>
            </div>
          )}

          <div className="complaints__list">
            {activeRows.map((row) => (
              <ComplaintCard
                key={row.complaint.id}
                row={row}
                disabled={loading}
                onPick={pickPhoto}
                onPrepare={prepareEvidence}
                onDownload={downloadEvidence}
                onCopy={copyLink}
                onCopyCode={copyCode}
                onOpenPortal={openPortal}
                portal={portalFor(row)}
                onMarkStatus={(item, status) => markRow(item, { status })}
                onUploadPhoto={uploadRowPhoto}
                onDelete={deleteRow}
                onOpenPhoto={(photo) => setLightboxPhoto(photo)}
              />
            ))}
          </div>
        </>
      )}

      {lightboxPhoto && isImagePhoto(lightboxPhoto) && (
        <PhotoLightbox
          photo={lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
          onDownload={() => downloadPhoto(lightboxPhoto)}
        />
      )}
    </section>
  );
}

function ComplaintCard({
  row,
  disabled,
  onPick,
  onPrepare,
  onDownload,
  onCopy,
  onCopyCode,
  onOpenPortal,
  portal,
  onMarkStatus,
  onUploadPhoto,
  onDelete,
  onOpenPhoto,
}) {
  const status = complaintRowStatus(row);
  const aggregator = detectAggregator(row.complaint.orderCode) || row.history?.aggregator;
  const photo = row.photo;
  const amount = row.history?.amount ?? row.complaint.amount;
  const combo = row.history?.combo || row.complaint.combo;
  const extraFields = Object.entries(row.history?.fields || row.complaint.fields || {});

  return (
    <article className={`complaint-card complaint-card--${status}`}>
      <div className="complaint-card__top">
        {photo?.public_url ? (
          <button
            type="button"
            className="complaint-card__thumb"
            onClick={() => onOpenPhoto(photo)}
            aria-label={`Ver foto de ${row.complaint.orderCode}`}
          >
            <img src={photo.public_url} alt="" />
          </button>
        ) : (
          <div className="complaint-card__thumb complaint-card__thumb--empty" aria-hidden="true">
            Sin foto
          </div>
        )}

        <div className="complaint-card__heading">
          <h3>{photo?.name || row.complaint.orderCode}</h3>
          <p>{formatComplaintWhen(row.complaint)}</p>
          <div className="complaint-card__badges">
            {aggregator && (
              <span className={aggregatorBadgeClass(aggregator)}>{getAggregatorLabel(aggregator)}</span>
            )}
            <span className={statusBadgeClass(status)}>{statusLabel(status)}</span>
            {amount != null && <span className="badge badge--amount">{formatMoney(amount)}</span>}
          </div>
        </div>
      </div>

      {combo && <p className="complaint-card__reason">Combo: {combo}</p>}
      {row.complaint.reason && (
        <p className="complaint-card__reason">{row.complaint.reason}</p>
      )}
      {row.complaint.comment && (
        <p className="complaint-card__comment">{row.complaint.comment}</p>
      )}
      {extraFields.length > 0 && (
        <p className="complaint-card__comment">
          {extraFields.map(([key, value]) => `${key}: ${value}`).join(' · ')}
        </p>
      )}
      {photo && (
        <p className="complaint-card__photo-meta">
          Foto {formatDateTime(photo.created_at)}
          {photo.taken_by ? ` · ${photo.taken_by}` : ''}
        </p>
      )}

      {row.status === 'ambiguous' && (
        <div className="complaint-card__candidates">
          <p>Hay más de una foto posible. Elegí la correcta:</p>
          <div className="complaint-card__candidate-list">
            {row.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="complaint-card__candidate"
                onClick={() => onPick(row.complaint.id, candidate.id)}
                disabled={disabled}
              >
                <img src={candidate.public_url} alt="" />
                <span>{candidate.name}</span>
                <small>{formatDateTime(candidate.created_at)}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="complaint-card__actions">
        {status === COMPLAINT_STATUSES.queja && (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => onMarkStatus(row, COMPLAINT_STATUSES.refutado)}
            disabled={disabled}
          >
            Marcar refutado
          </button>
        )}
        {status === COMPLAINT_STATUSES.refutado && (
          <>
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onMarkStatus(row, COMPLAINT_STATUSES.refutado_aceptado)}
              disabled={disabled}
            >
              Ref. aceptado
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => onMarkStatus(row, COMPLAINT_STATUSES.refutado_rechazado)}
              disabled={disabled}
            >
              Ref. rechazado
            </button>
          </>
        )}
        {!photo?.public_url && (
          <ComplaintEvidenceUpload disabled={disabled} onFile={(file) => onUploadPhoto(row, file)} />
        )}
        {photo?.id && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => onPrepare(row)}
            disabled={disabled}
          >
            {portal ? `Preparar y abrir ${portal.label}` : 'Preparar evidencia'}
          </button>
        )}
        {portal && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => onOpenPortal(row)}
            disabled={disabled}
          >
            Abrir portal
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => onCopyCode(row)}
          disabled={disabled}
        >
          Copiar código
        </button>
        {photo?.public_url && (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => onDownload(row)}
              disabled={disabled}
            >
              Descargar
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => onCopy(row)}
              disabled={disabled}
            >
              Copiar link
            </button>
          </>
        )}
        {row.history?.id && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => onDelete(row)}
            disabled={disabled}
          >
            Borrar
          </button>
        )}
      </div>
    </article>
  );
}
