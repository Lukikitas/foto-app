import PeyaExcelImport from './PeyaExcelImport';
import { subscribePeyaImport } from '../lib/peyaImportService';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../lib/date';
import {
  AGGREGATOR_OPTIONS,
  aggregatorBadgeClass,
  assignComplaintsAggregator,
  getAggregatorLabel,
  getComplaintAggregator,
  getPartnerPortal,
  openPartnerPortal,
  PARTNER_PORTALS,
} from '../lib/aggregators';
import { EVIDENCE_IMAGE_OPTIONS } from '../lib/compressImage';
import { compressImageInWorker } from '../lib/compressImageInWorker';
import {
  attachHistoryToRows,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUSES,
  complaintDay,
  historyItemToRow,
  editHistoryItemInStore,
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
import { argentinaToday, formatMoney, PERIOD_PRESETS, resolvePeriod } from '../lib/metrics';
import {
  cachedComplaintHistory,
  deleteHistoryItemById,
  deleteHistoryItemsByIds,
  editHistoryItemById,
  importComplaintsToHistory,
  loadComplaintHistory,
  patchHistoryItemsByIds,
  setHistoryPhoto,
  setHistoryResolution,
  setHistoryResolutions,
  subscribeComplaintHistory,
  syncGalleryComplaintToHistory,
} from '../lib/complaintHistoryStore';
import { downloadRegistryXlsx } from '../lib/complaintReport';
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
import { maybeRunDailyImport, subscribeDailyImport } from '../lib/complaintDailyImport';
import { dailyImportStatusMessage } from '../lib/complaintSync';
import {
  cachedComplaintSync,
  loadComplaintSync,
  recordManualCruzar,
  saveSharedSheetUrl,
} from '../lib/complaintSyncStore';
import {
  cachedPhotoBlob,
  cleanupReplacedPhoto,
  downloadPhoto,
  fetchPhotosByIds,
  isImagePhoto,
  isValidOrderDigits,
  prefetchPhotoBlob,
  startPhotoDownload,
  updatePhotoDetails,
  uploadPhoto,
} from '../lib/photos';
import { getImportAggregator, getSavedSheetUrl, saveImportAggregator } from '../lib/storage';
import ComplaintEvidenceUpload from './ComplaintEvidenceUpload';
import PhotoLightbox from './PhotoLightbox';
import ComplaintBatchEditModal from './ComplaintBatchEditModal';
import ComplaintsBulkBar from './ComplaintsBulkBar';

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
const IMPORT_AGGREGATORS = [{ id: '', label: 'Por código' }, ...AGGREGATOR_OPTIONS];

const SORT_OPTIONS = [
  { id: 'date_desc', label: 'Más recientes' },
  { id: 'date_asc', label: 'Más antiguos' },
  { id: 'amount_desc', label: 'Mayor monto ($)' },
  { id: 'amount_asc', label: 'Menor monto ($)' },
  { id: 'code_asc', label: 'Código A-Z' },
];

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

export default function ComplaintsInbox({ view = 'cruzar', onRequestCruzar, onRequestHistory } = {}) {
  const [storedBatch] = useState(readStoredBatch);
  const [pasteText, setPasteText] = useState('');
  const [sync, setSync] = useState(cachedComplaintSync);
  const [sheetUrl, setSheetUrl] = useState(() => cachedComplaintSync().sheetUrl || getSavedSheetUrl());
  const [complaints, setComplaints] = useState(storedBatch.complaints);
  const [photos, setPhotos] = useState([]);
  const [rows, setRows] = useState([]);
  const [historyStore, setHistoryStore] = useState(cachedComplaintHistory);
  const [pickedPhotoIds, setPickedPhotoIds] = useState(storedBatch.pickedPhotoIds);
  const [skipped, setSkipped] = useState(0);
  const [filter, setFilter] = useState('all');
  const inboxView = view === 'historial' ? 'historial' : 'cruzar';
  const [historyAggregator, setHistoryAggregator] = useState('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPreset, setHistoryPreset] = useState('month');
  const [historyCustomFrom, setHistoryCustomFrom] = useState('');
  const [historyCustomTo, setHistoryCustomTo] = useState('');
  const [loading, setLoading] = useState(storedBatch.complaints.length > 0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [importAggregator, setImportAggregator] = useState(() => {
    const saved = getImportAggregator();
    return AGGREGATOR_OPTIONS.some((item) => item.id === saved) ? saved : '';
  });
  const [historySort, setHistorySort] = useState('date_desc');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const masterCheckboxRef = useRef(null);

  useEffect(() => {
    setSelectedIds(new Set());
    setLastClickedIndex(null);
  }, [inboxView, filter, historyPreset, historyAggregator, historySort]);

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

  useEffect(() => subscribeComplaintHistory(setHistoryStore), []);
  useEffect(() => subscribePeyaImport((result) => {
    if (!result.historySaved) return;
    const incoming = result.history.complaints;
    setComplaints(incoming);
    setPickedPhotoIds({});
    setSkipped(0);
    setFilter('all');
    loadAndMatch(incoming, {}).catch(() => setError('Los reclamos se guardaron, pero no se pudieron cargar las fotos.'));
  }), [loadAndMatch]);

  const historyPeriod = useMemo(
    () => resolvePeriod(historyPreset, argentinaToday(), historyCustomFrom, historyCustomTo),
    [historyPreset, historyCustomFrom, historyCustomTo],
  );

  function openCruzar() {
    onRequestCruzar?.();
  }

  function openHistorial() {
    onRequestHistory?.();
  }

  useEffect(() => {
    let cancelled = false;
    loadComplaintSync()
      .then((loaded) => {
        if (cancelled) return;
        setSync(loaded);
        setSheetUrl(loaded.sheetUrl || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      subscribeDailyImport((result) => {
        if (result?.sync) {
          setSync(result.sync);
          setSheetUrl(result.sync.sheetUrl || '');
        }
        if (result?.replay) return;
        if (result?.status === 'error' && result.error) {
          setError(result.error);
          return;
        }
        if (result?.status === 'imported' && result.complaints?.length) {
          setError(null);
          setComplaints(result.complaints);
          setPickedPhotoIds({});
          setSkipped(result.skipped || 0);
          setFilter('all');
          saveComplaintBatch(result.complaints, {});
          loadAndMatch(result.complaints, {}).catch(() => {});
          setNotice(
            `Cruce automático: ${result.complaints.length} reclamos · ${result.added} nuevos · ${result.updated} ya estaban.`,
          );
        }
      }),
    [loadAndMatch],
  );

  useEffect(() => {
    let cancelled = false;
    loadComplaintHistory()
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
      from: historyPeriod.from,
      to: historyPeriod.to,
    }).map((item) => historyItemToRow(item, photos));
  }, [historyStore, historyAggregator, historySearch, photos, historyPeriod]);

  const historyRows = useMemo(
    () => historyBaseRows.filter((row) => rowMatchesFilter(row, filter)),
    [historyBaseRows, filter],
  );

  const sortedHistoryRows = useMemo(() => {
    const list = [...historyRows];
    switch (historySort) {
      case 'date_asc':
        return list.sort((a, b) =>
          (a.complaint.orderAtIso || a.complaint.day || '').localeCompare(
            b.complaint.orderAtIso || b.complaint.day || '',
          ),
        );
      case 'amount_desc':
        return list.sort((a, b) => {
          const amtA = Number(a.history?.amount ?? a.complaint?.amount) || 0;
          const amtB = Number(b.history?.amount ?? b.complaint?.amount) || 0;
          return amtB - amtA;
        });
      case 'amount_asc':
        return list.sort((a, b) => {
          const amtA = Number(a.history?.amount ?? a.complaint?.amount) || 0;
          const amtB = Number(b.history?.amount ?? b.complaint?.amount) || 0;
          return amtA - amtB;
        });
      case 'code_asc':
        return list.sort((a, b) =>
          String(a.complaint.orderCode || '').localeCompare(String(b.complaint.orderCode || '')),
        );
      case 'date_desc':
      default:
        return list.sort((a, b) =>
          (b.complaint.orderAtIso || b.complaint.day || '').localeCompare(
            a.complaint.orderAtIso || a.complaint.day || '',
          ),
        );
    }
  }, [historyRows, historySort]);

  useEffect(() => {
    if (inboxView !== 'historial') return undefined;
    const ids = listHistoryItems(historyStore, {
      from: historyPeriod.from,
      to: historyPeriod.to,
    })
      .map((item) => item.photoId)
      .filter(Boolean);
    if (ids.length === 0) return undefined;

    let cancelled = false;
    fetchPhotosByIds(ids)
      .then((data) => {
        if (cancelled || !data.length) return;
        setPhotos((current) => {
          const map = new Map(current.map((photo) => [photo.id, photo]));
          data.forEach((photo) => map.set(photo.id, photo));
          return [...map.values()];
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inboxView, historyStore, historyPeriod.from, historyPeriod.to]);

  useEffect(() => {
    historyBaseRows.forEach((row) => {
      if (row.photo?.public_url) prefetchPhotoBlob(row.photo.public_url);
    });
  }, [historyBaseRows]);

  const activeRows = inboxView === 'historial' ? sortedHistoryRows : visibleRows;

  const selectedRows = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const source = inboxView === 'historial' ? historyBaseRows : rowsWithHistory;
    return source.filter((r) => selectedIds.has(r.history?.id || r.complaint.id));
  }, [selectedIds, inboxView, historyBaseRows, rowsWithHistory]);

  const totalSelectedAmount = useMemo(() => {
    return selectedRows.reduce(
      (sum, r) => sum + (Number(r.history?.amount ?? r.complaint?.amount) || 0),
      0,
    );
  }, [selectedRows]);

  const hasSelectedPhotos = useMemo(() => {
    return selectedRows.some((r) => r.photo?.public_url || r.photo?.id);
  }, [selectedRows]);

  const isAllVisibleSelected = useMemo(() => {
    if (activeRows.length === 0) return false;
    return activeRows.every((r) => selectedIds.has(r.history?.id || r.complaint.id));
  }, [activeRows, selectedIds]);

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate =
        selectedIds.size > 0 && !isAllVisibleSelected;
    }
  }, [selectedIds.size, isAllVisibleSelected]);

  const toggleSelectAllVisible = useCallback(() => {
    if (isAllVisibleSelected) {
      setSelectedIds(new Set());
      setLastClickedIndex(null);
    } else {
      const next = new Set(selectedIds);
      activeRows.forEach((r) => {
        const id = r.history?.id || r.complaint.id;
        if (id) next.add(id);
      });
      setSelectedIds(next);
    }
  }, [isAllVisibleSelected, activeRows, selectedIds]);

  const selectAllPeriod = useCallback(() => {
    const next = new Set();
    historyBaseRows.forEach((r) => {
      const id = r.history?.id || r.complaint.id;
      if (id) next.add(id);
    });
    setSelectedIds(next);
  }, [historyBaseRows]);

  const handleToggleSelect = useCallback(
    (row, event, index) => {
      const id = row.history?.id || row.complaint.id;
      if (!id) return;

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (event?.shiftKey && lastClickedIndex !== null && typeof index === 'number') {
          const start = Math.min(lastClickedIndex, index);
          const end = Math.max(lastClickedIndex, index);
          const shouldSelect = !prev.has(id);
          for (let i = start; i <= end; i++) {
            const targetRow = activeRows[i];
            if (targetRow) {
              const targetId = targetRow.history?.id || targetRow.complaint.id;
              if (targetId) {
                if (shouldSelect) next.add(targetId);
                else next.delete(targetId);
              }
            }
          }
        } else {
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
        }
        return next;
      });
      setLastClickedIndex(index);
    },
    [activeRows, lastClickedIndex],
  );

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

  function changeImportAggregator(id) {
    setImportAggregator(id);
    saveImportAggregator(id);
  }

  async function importText(text, { fromSheetUrl = false } = {}) {
    const parsed = parseComplaintSheet(text);
    if (parsed.complaints.length === 0) {
      throw new Error('No encontré códigos de pedido. Copiá las columnas de código, hora y motivo.');
    }
    const nextComplaints = assignComplaintsAggregator(parsed.complaints, importAggregator);
    setComplaints(nextComplaints);
    setPickedPhotoIds({});
    setSkipped(parsed.skipped);
    setFilter('all');
    const matched = await loadAndMatch(nextComplaints, {});
    saveComplaintBatch(nextComplaints, {});
    const result = await importComplaintsToHistory(nextComplaints, matched);
    setHistoryStore(historyFromResult(result));
    if (fromSheetUrl && sheetUrl.trim()) {
      setSync(await recordManualCruzar(sheetUrl));
    } else if (sheetUrl.trim()) {
      setSync(await saveSharedSheetUrl(sheetUrl));
    }
    setPasteText('');
    setNotice(
      `${nextComplaints.length} reclamos cruzados · ${result.added} nuevos en historial · ${result.updated} ya estaban (sin duplicar).`,
    );
  }

  async function runImport(reader, options = {}) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await importText(await reader(), options);
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
      await runImport(() => fetchComplaintSheetText(sheetUrl), { fromSheetUrl: true });
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
    await runImport(() => fetchComplaintSheetText(sheetUrl), { fromSheetUrl: true });
  }

  async function handleSaveUrl() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveSharedSheetUrl(sheetUrl);
      setSync(saved);
      setNotice(
        saved.sheetUrl
          ? 'Link guardado. El cruce automático se comparte entre todos los dispositivos, después de las 13:30.'
          : 'Se borró el link compartido.',
      );
      if (saved.sheetUrl) {
        await maybeRunDailyImport();
      }
    } catch (err) {
      setError(err.message || 'No se pudo guardar el link.');
    } finally {
      setLoading(false);
    }
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
        getComplaintAggregator(row.complaint, row.photo) || row.history?.aggregator,
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

  async function editRow(row, changes) {
    const id = row.history?.id;
    if (!id) return;
    const orderCode = String(changes.orderCode || '').trim().toUpperCase();
    if (!isValidOrderDigits(orderCode)) {
      throw new Error('Ingresá un código de pedido válido.');
    }
    editHistoryItemInStore(historyStore, id, { orderCode, aggregator: changes.aggregator });
    setLoading(true);
    setError(null);
    try {
      let photo = row.photo?.file_path ? row.photo : null;
      if (!photo && row.photo?.id) {
        [photo] = await fetchPhotosByIds([row.photo.id]);
      }
      const previousPhoto = photo;
      if (photo) {
        photo = await updatePhotoDetails(photo, {
          name: orderCode,
          aggregator: changes.aggregator,
          file: changes.file,
          notes: photo.notes,
          taken_by: photo.taken_by,
          has_complaint: photo.has_complaint,
          is_refutado: photo.is_refutado,
        });
      } else if (changes.file) {
        if (!changes.file.type?.startsWith('image/')) throw new Error('Elegí una imagen.');
        const prepared = await compressImageInWorker(changes.file, EVIDENCE_IMAGE_OPTIONS);
        photo = await uploadPhoto(prepared, orderCode, { has_complaint: true }, changes.aggregator || 'sin_agregador');
      }
      const updated = await editHistoryItemById(id, {
        orderCode,
        aggregator: changes.aggregator,
        photo,
      });
      if (photo) applyUpdatedPhotos([photo]);
      setHistoryStore(historyFromResult(updated));
      if (photo) {
        try {
          await syncGalleryComplaintToHistory(photo);
          await cleanupReplacedPhoto(previousPhoto, photo);
        } catch (syncError) {
          setError('El pedido se guardó, pero no se pudieron actualizar todos los vínculos del historial.');
          console.error('No se pudieron sincronizar las otras referencias de la foto.', syncError);
        }
      }
      setNotice(`Pedido ${orderCode} actualizado en el historial.`);
    } catch (err) {
      setError(err.message || 'No se pudo editar el reclamo.');
      throw err;
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
    return getPartnerPortal(
      getComplaintAggregator(row.complaint, row.photo) || row.history?.aggregator,
    );
  }

  async function openPortal(row) {
    const code = rowClipboardCode(row);
    const portal = openPartnerPortal(
      getComplaintAggregator(row.complaint, row.photo) || row.history?.aggregator,
    );
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
    const code = rowClipboardCode(row);
    const aggregator =
      getComplaintAggregator(row.complaint, row.photo) || row.history?.aggregator;
    let photo = row.photo;
    const filename = photo ? getEvidenceFilename(row.complaint, photo) : '';
    const startedDownload = photo?.public_url
      ? startPhotoDownload(photo, new Set(), filename)
      : false;
    const portal = openPartnerPortal(aggregator);
    setLoading(true);
    setError(null);
    try {
      if (photo && !photo.public_url && photo.id) {
        const [loaded] = await fetchPhotosByIds([photo.id]);
        if (loaded?.public_url) photo = loaded;
      }
      if (photo?.public_url && !startedDownload && !cachedPhotoBlob(photo.public_url)) {
        await downloadPhoto(photo, new Set(), filename || getEvidenceFilename(row.complaint, photo));
      }
      let copied = false;
      if (code) {
        try {
          await copyText(code);
          copied = true;
        } catch {
          copied = false;
        }
      }
      if (portal && code) {
        setNotice(
          [
            portal.opened ? `Se abrió ${portal.label}.` : `${portal.label} ya estaba abierto.`,
            copied ? `Código ${code} copiado.` : `Copiá el código ${code}.`,
            photo?.public_url ? 'Adjuntá la foto descargada.' : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      } else if (code) {
        setNotice(
          [
            copied ? `Código ${code} copiado.` : `Copiá el código ${code}.`,
            photo?.public_url ? 'Foto descargada.' : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
    } catch (err) {
      setError(err.message || 'No se pudo preparar para refutar.');
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
    setSelectedIds(new Set());
  }

  async function handleBatchMarkStatus(status) {
    if (selectedIds.size === 0) return;
    const targetIds = [...selectedIds];
    setLoading(true);
    setError(null);
    try {
      const disputed = status && status !== COMPLAINT_STATUSES.queja;
      const photoRows = selectedRows.filter((row) => row.photo?.id);
      if (photoRows.length) {
        const updatedPhotos = await applyComplaintsToPhotos(photoRows, { refutado: Boolean(disputed) });
        if (updatedPhotos.length) applyUpdatedPhotos(updatedPhotos);
      }
      if (inboxView === 'historial') {
        const updated = await patchHistoryItemsByIds(targetIds, { status });
        setHistoryStore(historyFromResult(updated));
      } else {
        const history = await setHistoryResolutions(selectedRows, { status });
        setHistoryStore(historyFromResult(history));
      }
      setNotice(`${targetIds.length} reclamos marcados como ${statusLabel(status)}.`);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || 'No se pudieron actualizar los reclamos seleccionados.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchSetAggregator(aggregator) {
    if (selectedIds.size === 0) return;
    const targetIds = [...selectedIds];
    setLoading(true);
    setError(null);
    try {
      const updated = await patchHistoryItemsByIds(targetIds, { aggregator });
      setHistoryStore(historyFromResult(updated));
      const label = aggregator ? getAggregatorLabel(aggregator) : 'Sin agregador';
      setNotice(`Agregador cambiado a "${label}" en ${targetIds.length} reclamos.`);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || 'No se pudo cambiar el agregador en los reclamos.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchEditApply(changes) {
    if (selectedIds.size === 0) return;
    const targetIds = [...selectedIds];
    setLoading(true);
    setError(null);
    try {
      if (changes.status) {
        const disputed = changes.status !== COMPLAINT_STATUSES.queja;
        const photoRows = selectedRows.filter((row) => row.photo?.id);
        if (photoRows.length) {
          const updatedPhotos = await applyComplaintsToPhotos(photoRows, { refutado: Boolean(disputed) });
          if (updatedPhotos.length) applyUpdatedPhotos(updatedPhotos);
        }
      }
      const updated = await patchHistoryItemsByIds(targetIds, changes);
      setHistoryStore(historyFromResult(updated));
      setNotice(`Se actualizaron datos en ${targetIds.length} reclamos del historial.`);
      setBatchModalOpen(false);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || 'No se pudieron aplicar los cambios en lote.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`¿Seguro que querés eliminar ${count} reclamos del historial? Las fotos no se borran.`)) {
      return;
    }
    const targetIds = [...selectedIds];
    setLoading(true);
    setError(null);
    try {
      const updated = await deleteHistoryItemsByIds(targetIds);
      setHistoryStore(historyFromResult(updated));
      setNotice(`Se eliminaron ${count} reclamos del historial.`);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || 'No se pudieron eliminar los reclamos seleccionados.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBatchDownloadEvidence() {
    const photoRows = selectedRows.filter((r) => r.photo?.public_url);
    if (photoRows.length === 0) {
      setError('Ninguno de los reclamos seleccionados tiene foto cargada.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const usedNames = new Set();
      for (const row of photoRows) {
        await downloadPhoto(
          row.photo,
          usedNames,
          getEvidenceFilename(row.complaint, row.photo),
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      setNotice(`${photoRows.length} evidencias descargadas.`);
    } catch (err) {
      setError(err.message || 'No se pudieron descargar las evidencias.');
    } finally {
      setLoading(false);
    }
  }

  function handleBatchExportExcel() {
    if (selectedRows.length === 0) return;
    const items = selectedRows.map((r) => r.history || {
      id: r.complaint.id,
      orderCode: r.complaint.orderCode,
      aggregator: getComplaintAggregator(r.complaint, r.photo),
      day: r.complaint.day || complaintDay(r.complaint),
      combo: r.complaint.combo,
      reason: r.complaint.reason,
      amount: r.complaint.amount,
      status: complaintRowStatus(r),
      photoUrl: r.photo?.public_url || null,
      comment: r.complaint.comment,
    });
    downloadRegistryXlsx(items, `reclamos-seleccionados-${items.length}.xlsx`);
    setNotice(`Descargando Excel con ${items.length} reclamos.`);
  }

  const historyCount = Object.keys(historyStore.items || {}).length;
  const showCruzarList = inboxView === 'cruzar' && rowsWithHistory.length > 0;
  const showHistoryList = inboxView === 'historial';

  return (
    <section className={`complaints complaints--${inboxView}`}>
      <header className="complaints__toolbar">
        <h2 className="gallery__title">{inboxView === 'historial' ? 'Historial' : 'Reclamos'}</h2>
        <div className="tab-bar complaints__views" role="tablist" aria-label="Vista de reclamos">
          <button
            type="button"
            className={`tab-bar__btn${inboxView === 'cruzar' ? ' tab-bar__btn--active' : ''}`}
            onClick={openCruzar}
            role="tab"
            aria-selected={inboxView === 'cruzar'}
          >
            Cruzar
          </button>
          <button
            type="button"
            className={`tab-bar__btn${inboxView === 'historial' ? ' tab-bar__btn--active' : ''}`}
            onClick={openHistorial}
            role="tab"
            aria-selected={inboxView === 'historial'}
          >
            Historial
            {historyCount ? <span className="filter-row__count">{historyCount}</span> : null}
          </button>
        </div>
        <div className="complaints__portals">
          {PORTAL_LINKS.map((portal) => (
            <a
              key={portal.url}
              className="btn btn--ghost btn--small"
              href={portal.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {portal.label.replace(' Portal', '').replace(' Partners', '')}
            </a>
          ))}
        </div>
      </header>

      {inboxView === 'cruzar' && (
        <>
        <PeyaExcelImport disabled={loading} onBusy={setLoading} />
        <form className="complaints__import" onSubmit={handleSubmit}>
          <div className="complaints__import-meta">
            <div className="filter-row" role="group" aria-label="Agregador de esta lista">
              {IMPORT_AGGREGATORS.map((item) => (
                <button
                  key={item.id || 'auto'}
                  type="button"
                  className={`filter-row__btn${importAggregator === item.id ? ' filter-row__btn--active' : ''}`}
                  data-agg={item.id || undefined}
                  onClick={() => changeImportAggregator(item.id)}
                  aria-pressed={importAggregator === item.id}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="complaints__hint">{dailyImportStatusMessage(sync)}</p>
          </div>
          <label className="complaints__field">
            <span className="visually-hidden">Pegar celdas del Excel</span>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={2}
              placeholder="Pegá las celdas: código, hora, monto, combo, motivo…"
              disabled={loading}
            />
          </label>
          <div className="complaints__import-bottom">
            <div className="complaints__import-actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={loading || (!pasteText.trim() && !sheetUrl.trim())}
              >
                {loading ? 'Cruzando…' : 'Cruzar con fotos'}
              </button>
              <label className="btn btn--ghost complaints__file-btn">
                CSV
                <input type="file" accept=".csv,text/csv,text/tab-separated-values,.tsv,text/plain" onChange={handleFile} hidden />
              </label>
            </div>
            <div className="complaints__url-row">
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="Link del Sheet"
                disabled={loading}
                aria-label="Link del Sheet"
              />
              <button type="button" className="btn btn--ghost" onClick={handleSaveUrl} disabled={loading}>
                Guardar
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleUrl}
                disabled={loading || !sheetUrl.trim()}
              >
                Leer
              </button>
            </div>
          </div>
        </form>
        </>
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

      {inboxView === 'cruzar' && !showCruzarList && !loading && (
        <div className="gallery__state gallery__state--empty complaints__empty">
          <p>Pegá las celdas o leé el Sheet. Si la lista no trae el prefijo en el código, elegí el agregador arriba.</p>
        </div>
      )}

      {showHistoryList && (
        <div className="complaints__history-tools">
          <div className="complaints__history-row">
            <div className="filter-cluster">
              <span className="filter-cluster__label">Período</span>
              <div className="filter-row filter-row--joined" role="group" aria-label="Período">
                {PERIOD_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-row__btn${historyPreset === item.id ? ' filter-row__btn--active' : ''}`}
                    onClick={() => setHistoryPreset(item.id)}
                    aria-pressed={historyPreset === item.id}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {historyPreset === 'custom' && (
              <div className="metrics-range complaints__range">
                <label>
                  Desde
                  <input
                    type="date"
                    value={historyCustomFrom || historyPeriod.from}
                    onChange={(e) => setHistoryCustomFrom(e.target.value)}
                  />
                </label>
                <label>
                  Hasta
                  <input
                    type="date"
                    value={historyCustomTo || historyPeriod.to}
                    onChange={(e) => setHistoryCustomTo(e.target.value)}
                  />
                </label>
              </div>
            )}
            <div className="filter-cluster">
              <span className="filter-cluster__label">Agregador</span>
              <div className="filter-row" role="group" aria-label="Agregador">
                {HISTORY_AGGREGATORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`filter-row__btn${historyAggregator === item.id ? ' filter-row__btn--active' : ''}`}
                    data-agg={item.id === 'all' ? undefined : item.id}
                    onClick={() => setHistoryAggregator(item.id)}
                    aria-pressed={historyAggregator === item.id}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-cluster complaints__sort-cluster">
              <span className="filter-cluster__label">Ordenar por</span>
              <select
                className="complaints__sort-select"
                value={historySort}
                onChange={(e) => setHistorySort(e.target.value)}
                aria-label="Ordenar reclamos"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="complaints__field complaints__search">
              <span className="visually-hidden">Buscar en el historial</span>
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Código, motivo o comentario"
              />
            </label>
          </div>
        </div>
      )}

      {(showCruzarList || showHistoryList) && (
        <div className={inboxView === 'cruzar' ? 'complaints__cruzar-result' : 'complaints__history-result'}>
          <div className="complaints__list-bar">
            <label
              className="complaints__select-all-box"
              title={isAllVisibleSelected ? 'Deseleccionar todos' : 'Seleccionar visibles'}
            >
              <input
                type="checkbox"
                ref={masterCheckboxRef}
                checked={isAllVisibleSelected}
                onChange={toggleSelectAllVisible}
                aria-label="Seleccionar todos los reclamos visibles"
              />
              <span className="complaints__select-all-label">
                {selectedIds.size > 0 ? <strong>{selectedIds.size} sel.</strong> : 'Todos'}
              </span>
            </label>
            <p className="gallery__count">
              {stats.all} reclamo{stats.all !== 1 ? 's' : ''}
              {inboxView === 'cruzar' && skipped ? ` · ${skipped} sin código` : ''}
              {` · ${formatMoney(sourceAmount(inboxView === 'historial' ? historyBaseRows : rowsWithHistory))}`}
            </p>
            <div className="filter-row complaints__filters" role="group" aria-label="Filtrar reclamos">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`filter-row__btn${filter === item.id ? ' filter-row__btn--active' : ''}`}
                  onClick={() => setFilter(item.id)}
                  aria-pressed={filter === item.id}
                  aria-label={stats[item.id] ? `${item.label}, ${stats[item.id]}` : item.label}
                >
                  {item.label}
                  {stats[item.id] ? <span className="filter-row__count">{stats[item.id]}</span> : null}
                </button>
              ))}
            </div>
            <div className="complaints__batch">
              {inboxView === 'cruzar' && (
                <button type="button" className="btn btn--ghost btn--small" onClick={handleClear}>
                  Limpiar
                </button>
              )}
              {inboxView === 'cruzar' && quejasAbiertas.length > 0 && (
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => markMany(quejasAbiertas, { status: COMPLAINT_STATUSES.refutado })}
                  disabled={loading}
                >
                  Marcar refutados
                </button>
              )}
              {inboxView === 'cruzar' && rowsWithPhotos.length > 0 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={downloadMatchedEvidence}
                  disabled={loading}
                >
                  Descargar evidencias
                </button>
              )}
              {(inboxView === 'cruzar' || activeRows.length > 0) && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={exportSheet}
                  disabled={loading}
                >
                  CSV
                </button>
              )}
            </div>
          </div>

          {inboxView === 'historial' && selectedIds.size > 0 && selectedIds.size < historyBaseRows.length && (
            <div className="complaints__period-select-banner">
              <span>
                Seleccionaste <strong>{selectedIds.size}</strong> reclamo{selectedIds.size !== 1 ? 's' : ''} de esta vista filtrada.
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--small complaints__period-select-btn"
                onClick={selectAllPeriod}
              >
                Seleccionar todos los {historyBaseRows.length} del período
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
            {activeRows.map((row, index) => {
              const rowId = row.history?.id || row.complaint.id;
              return (
                <ComplaintCard
                  key={row.complaint.id}
                  row={row}
                  index={index}
                  selected={selectedIds.has(rowId)}
                  onToggleSelect={handleToggleSelect}
                  layout={inboxView === 'historial' ? 'row' : 'card'}
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
                  onEdit={inboxView === 'historial' ? editRow : undefined}
                  onOpenPhoto={(photo) => setLightboxPhoto(photo)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      <ComplaintsBulkBar
        selectedCount={selectedIds.size}
        totalSelectedAmount={totalSelectedAmount}
        hasPhotos={hasSelectedPhotos}
        onClearSelection={() => setSelectedIds(new Set())}
        onSelectAllVisible={toggleSelectAllVisible}
        isAllVisibleSelected={isAllVisibleSelected}
        visibleCount={activeRows.length}
        onMarkStatus={handleBatchMarkStatus}
        onSetAggregator={handleBatchSetAggregator}
        onOpenBatchEdit={() => setBatchModalOpen(true)}
        onDownloadEvidence={hasSelectedPhotos ? handleBatchDownloadEvidence : undefined}
        onExportExcel={handleBatchExportExcel}
        onDeleteSelected={inboxView === 'historial' ? handleBatchDelete : undefined}
        disabled={loading}
      />

      {/* Batch Edit Modal */}
      {batchModalOpen && (
        <ComplaintBatchEditModal
          selectedCount={selectedIds.size}
          onApply={handleBatchEditApply}
          onClose={() => setBatchModalOpen(false)}
          disabled={loading}
        />
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
  index,
  selected = false,
  onToggleSelect,
  layout = 'card',
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
  onEdit,
  onOpenPhoto,
}) {
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editCode, setEditCode] = useState(row.history?.orderCode || '');
  const [editAggregator, setEditAggregator] = useState(row.history?.aggregator || '');
  const [editFile, setEditFile] = useState(null);
  const status = complaintRowStatus(row);
  const isRefutedOrResolved = status !== COMPLAINT_STATUSES.queja;
  const photo = row.photo;
  const aggregator = getComplaintAggregator(row.complaint, photo) || row.history?.aggregator;
  const amount = row.history?.amount ?? row.complaint.amount;
  const combo = row.history?.combo || row.complaint.combo;
  const extraFields = Object.entries(row.history?.fields || row.complaint.fields || {});
  const code = clipboardOrderCode(photo?.name || row.complaint.orderCode);

  return (
    <article
      className={`complaint-card complaint-card--${status}${layout === 'row' ? ' complaint-card--row' : ''}${
        selected ? ' is-selected' : ''
      }`}
    >
      <div className="complaint-card__top">
        {onToggleSelect && (
          <label
            className="complaint-card__select-label"
            onClick={(e) => e.stopPropagation()}
            title={selected ? 'Deseleccionar' : 'Seleccionar'}
          >
            <input
              type="checkbox"
              className="complaint-card__checkbox"
              checked={Boolean(selected)}
              onChange={(e) => onToggleSelect(row, e, index)}
              disabled={disabled}
              aria-label={`Seleccionar pedido ${code || row.complaint.orderCode}`}
            />
          </label>
        )}
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
            {amount != null && (
              <span className={`badge badge--amount${isRefutedOrResolved ? ' badge--amount-green' : ''}`}>
                {formatMoney(amount)}
              </span>
            )}
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
        {onEdit && !editing && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => {
            setEditCode(row.history?.orderCode || '');
            setEditAggregator(row.history?.aggregator || '');
            setEditFile(null);
            setEditError(null);
            setEditing(true);
          }} disabled={disabled}>
            Editar
          </button>
        )}
        {!isRefutedOrResolved && (photo?.public_url || portal || code) && (
          <button
            type="button"
            className={`btn btn--small ${status === COMPLAINT_STATUSES.queja ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => onPrepare(row)}
            disabled={disabled}
          >
            Preparar para refutar
          </button>
        )}
        {status === COMPLAINT_STATUSES.queja && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
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
        {!isRefutedOrResolved && !photo?.public_url && (
          <ComplaintEvidenceUpload disabled={disabled} onFile={(file) => onUploadPhoto(row, file)} />
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
      {editing && (
        <form className="complaint-card__edit-form" onSubmit={async (event) => {
          event.preventDefault();
          setEditError(null);
          try {
            await onEdit(row, { orderCode: editCode, aggregator: editAggregator, file: editFile });
            setEditing(false);
          } catch (err) {
            setEditError(err.message || 'No se pudieron guardar los cambios.');
          }
        }}>
          <label>Código del pedido
            <input value={editCode} onChange={(event) => setEditCode(event.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 32))} disabled={disabled} maxLength={32} />
          </label>
          <label>Agregador
            <select value={editAggregator} onChange={(event) => setEditAggregator(event.target.value)} disabled={disabled}>
              <option value="">Sin agregador</option>
              {AGGREGATOR_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label>{photo?.public_url ? 'Reemplazar foto' : 'Agregar foto'}
            <input type="file" accept="image/*" onChange={(event) => setEditFile(event.target.files?.[0] || null)} disabled={disabled} />
            {editFile && <small>Nueva foto: {editFile.name}</small>}
          </label>
          {editError && <p className="message message--error message--compact" role="alert">{editError}</p>}
          <div className="photo-card__rename-actions">
            <button type="submit" className="btn btn--primary btn--small" disabled={disabled || !isValidOrderDigits(editCode)}>Guardar</button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(false)} disabled={disabled}>Cancelar</button>
          </div>
        </form>
      )}
    </article>
  );
}
