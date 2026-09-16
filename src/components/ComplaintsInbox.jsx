import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../lib/date';
import { detectAggregator, getAggregatorLabel, getComplaintAggregator, getPartnerPortal, openPartnerPortal, PARTNER_PORTALS } from '../lib/aggregators';
import {
  fetchComplaintSheetText,
  parseComplaintSheet,
} from '../lib/complaintSheet';
import { complaintRowStatus, matchComplaintsToPhotos } from '../lib/complaintMatch';
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
} from '../lib/complaints';
import { downloadPhoto, isImagePhoto } from '../lib/photos';
import { getSavedSheetUrl, saveSheetUrl } from '../lib/storage';
import PhotoLightbox from './PhotoLightbox';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'con_foto', label: 'Con foto' },
  { id: 'sin_foto', label: 'Sin foto' },
  { id: 'ambiguo', label: 'A revisar' },
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'refutado', label: 'Refutados' },
];

const PORTAL_LINKS = [PARTNER_PORTALS.pedidosya, PARTNER_PORTALS.rappi];

function formatComplaintWhen(complaint) {
  if (complaint.orderAtIso) return formatDateTime(complaint.orderAtIso);
  if (complaint.timeOfDay) {
    return complaint.dateAssumed ? `${complaint.timeOfDay} · sin fecha` : complaint.timeOfDay;
  }
  return '—';
}

function statusLabel(status) {
  if (status === 'refutado') return 'Refutado';
  if (status === 'con_foto') return 'Con foto';
  if (status === 'ambiguo') return 'Elegí la foto';
  return 'Sin foto';
}

function rowMatchesFilter(row, filter) {
  const status = complaintRowStatus(row);
  if (filter === 'all') return true;
  if (filter === 'pendiente') return status === 'con_foto' && !row.photo?.is_refutado;
  return status === filter;
}

function readStoredBatch() {
  return loadComplaintBatch() || { complaints: [], pickedPhotoIds: {} };
}

export default function ComplaintsInbox() {
  const [storedBatch] = useState(readStoredBatch);
  const [pasteText, setPasteText] = useState('');
  const [sheetUrl, setSheetUrl] = useState(getSavedSheetUrl);
  const [complaints, setComplaints] = useState(storedBatch.complaints);
  const [photos, setPhotos] = useState([]);
  const [rows, setRows] = useState([]);
  const [pickedPhotoIds, setPickedPhotoIds] = useState(storedBatch.pickedPhotoIds);
  const [skipped, setSkipped] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(storedBatch.complaints.length > 0);
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
      rematch(nextComplaints, nextPicks, data);
      saveComplaintBatch(nextComplaints, nextPicks);
    },
    [rematch],
  );

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

  const visibleRows = useMemo(
    () => rows.filter((row) => rowMatchesFilter(row, filter)),
    [rows, filter],
  );

  const stats = useMemo(() => {
    const counts = { all: rows.length, con_foto: 0, sin_foto: 0, ambiguo: 0, refutado: 0, pendiente: 0 };
    rows.forEach((row) => {
      const status = complaintRowStatus(row);
      counts[status] += 1;
      if (status === 'con_foto') counts.pendiente += 1;
    });
    return counts;
  }, [rows]);

  const matchedPending = useMemo(
    () => rows.filter((row) => row.photo && !row.photo.is_refutado),
    [rows],
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
    await loadAndMatch(parsed.complaints, {});
    if (sheetUrl.trim()) saveSheetUrl(sheetUrl);
    setImportOpen(false);
    setNotice(`${parsed.complaints.length} reclamos cruzados con las fotos.`);
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
    const nextPhotos = photos.map((photo) => {
      const next = updatedList.find((item) => item.id === photo.id);
      return next || photo;
    });
    setPhotos(nextPhotos);
    setRows(replacePhotosInRows(rows, updatedList));
  }

  function pickPhoto(complaintId, photoId) {
    const nextPicks = { ...pickedPhotoIds, [complaintId]: photoId };
    setPickedPhotoIds(nextPicks);
    rematch(complaints, nextPicks, photos);
    saveComplaintBatch(complaints, nextPicks);
  }

  async function markRow(row, { refutado = false } = {}) {
    if (!row.photo) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await applyComplaintToPhoto(row.photo, row.complaint, { refutado });
      applyUpdatedPhotos([updated]);
      setNotice(
        refutado
          ? `Pedido ${row.complaint.orderCode} marcado como refutado.`
          : `Reclamo marcado en ${row.complaint.orderCode}.`,
      );
    } catch (err) {
      setError(err.message || 'No se pudo actualizar la foto.');
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

  async function copyCode(row) {
    const code = row.photo?.name || row.complaint.orderCode;
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
    const code = row.photo?.name || row.complaint.orderCode;
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
      const code = updated.name || row.complaint.orderCode;
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

  async function markMany(targetRows, { refutado = false } = {}) {
    if (targetRows.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await applyComplaintsToPhotos(targetRows, { refutado });
      applyUpdatedPhotos(updated);
      setNotice(
        refutado
          ? `${updated.length} pedidos marcados como refutados.`
          : `${updated.length} reclamos marcados en las fotos.`,
      );
    } catch (err) {
      setError(err.message || 'No se pudieron actualizar las fotos.');
    } finally {
      setLoading(false);
    }
  }

  async function downloadMatchedEvidence() {
    if (matchedPending.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const usedNames = new Set();
      for (const row of matchedPending) {
        await downloadPhoto(
          row.photo,
          usedNames,
          getEvidenceFilename(row.complaint, row.photo),
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      setNotice(`${matchedPending.length} evidencias descargadas.`);
    } catch (err) {
      setError(err.message || 'No se pudieron descargar las evidencias.');
    } finally {
      setLoading(false);
    }
  }

  function exportSheet() {
    const csv = buildComplaintExport(rows);
    downloadTextFile('reclamos-con-fotos.csv', csv);
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

  return (
    <section className="complaints">
      <h2 className="gallery__title">Reclamos</h2>
      <p className="complaints__lead">
        No podemos entrar a tu usuario de PedidosYa o Rappi: el navegador no deja manejar
        otro sitio. Sí podemos abrir el portal, copiar el código y dejarte la foto lista
        para adjuntar. El Google Sheet se lee de la web si está compartido con enlace.
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

      {rows.length > 0 && (
        <button
          type="button"
          className={`gallery__filters-toggle${importOpen ? ' gallery__filters-toggle--open' : ''}`}
          onClick={() => setImportOpen((open) => !open)}
          aria-expanded={importOpen}
        >
          {importOpen ? 'Cerrar carga' : 'Cargar otro Sheet'}
        </button>
      )}

      {importOpen && (
        <form className="complaints__import" onSubmit={handleSubmit}>
          <label className="complaints__field">
            <span>Pegar celdas del Google Sheet</span>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              placeholder="Código, hora del pedido, motivo y comentario…"
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

      {rows.length > 0 && (
        <>
          <div className="complaints__summary">
            <p className="gallery__count">
              {stats.all} reclamo{stats.all !== 1 ? 's' : ''}
              {skipped ? ` · ${skipped} filas sin código` : ''}
              {` · ${stats.con_foto + stats.refutado} con foto`}
              {` · ${stats.sin_foto} sin foto`}
            </p>
            <button type="button" className="btn btn--ghost btn--small" onClick={handleClear}>
              Limpiar
            </button>
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

          {matchedPending.length > 0 && (
            <div className="complaints__batch">
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => markMany(matchedPending)}
                disabled={loading}
              >
                Marcar reclamos
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={downloadMatchedEvidence}
                disabled={loading}
              >
                Descargar evidencias
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={exportSheet}
                disabled={loading}
              >
                Exportar CSV
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => markMany(matchedPending, { refutado: true })}
                disabled={loading}
              >
                Marcar refutados
              </button>
            </div>
          )}

          {loading && visibleRows.length === 0 && (
            <div className="gallery__state">
              <div className="spinner" aria-hidden="true" />
              <p>Cruzando reclamos con las fotos…</p>
            </div>
          )}

          {visibleRows.length === 0 && !loading && (
            <div className="gallery__state gallery__state--empty">
              <p>No hay reclamos en este filtro.</p>
            </div>
          )}

          <div className="complaints__list">
            {visibleRows.map((row) => (
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
                onMarkReclamo={(item) => markRow(item)}
                onMarkRefutado={(item) => markRow(item, { refutado: true })}
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
  onMarkReclamo,
  onMarkRefutado,
  onOpenPhoto,
}) {
  const status = complaintRowStatus(row);
  const aggregator = detectAggregator(row.complaint.orderCode);
  const photo = row.photo;

  return (
    <article className={`complaint-card complaint-card--${status}`}>
      <div className="complaint-card__top">
        {photo ? (
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
              <span className="badge badge--aggregator">{getAggregatorLabel(aggregator)}</span>
            )}
            <span className={`badge badge--${status === 'sin_foto' ? 'file' : status === 'refutado' ? 'refutado' : status === 'con_foto' ? 'complaint' : 'missing-code'}`}>
              {statusLabel(status)}
            </span>
          </div>
        </div>
      </div>

      {row.complaint.reason && (
        <p className="complaint-card__reason">{row.complaint.reason}</p>
      )}
      {row.complaint.comment && (
        <p className="complaint-card__comment">{row.complaint.comment}</p>
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

      {(photo || portal) && (
        <div className="complaint-card__actions">
          {photo && (
            <button
              type="button"
              className="btn btn--primary btn--small"
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
          {photo && (
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
              {!photo.has_complaint && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onMarkReclamo(row)}
                  disabled={disabled}
                >
                  Marcar reclamo
                </button>
              )}
              {!photo.is_refutado && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onMarkRefutado(row)}
                  disabled={disabled}
                >
                  Marcar refutado
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
