import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readPage } from '../lib/pagedReads';
import { todayDateInput, yesterdayDateInput } from '../lib/date';
import { AGGREGATOR_OPTIONS } from '../lib/aggregators';
import { GALLERY_PAGE_SIZE, clampPage, pageNumbers } from '../lib/galleryPagination';
import { isPhoneViewport, PHONE_MEDIA_QUERY } from '../lib/viewport';
import { getPhotoTitle, photoMatchesFilters } from '../lib/photos';
import { supabase } from '../lib/supabase';
import {
  getFiltersOpen,
  getGalleryViewMode,
  saveFiltersOpen,
  saveGalleryViewMode,
} from '../lib/storage';
import BulkActionBar from './BulkActionBar';
import CodeRecoveryPanel from './CodeRecoveryPanel';
import FileUploadCard from './FileUploadCard';
import PhotoCard from './PhotoCard';
import PhotoListRow from './PhotoListRow';
import PhotoCleanupModal from './PhotoCleanupModal';

const EMPTY_FILTERS = {
  kind: '',
  search: '',
  dateFrom: '',
  dateTo: '',
  timeFrom: '',
  timeTo: '',
  aggregator: '',
  codeNotFound: false,
  hasComplaint: false,
  isRefutado: false,
  takenBy: '',
  notes: '',
};

// Only the requested server page and selected rows are retained locally.
const SEARCH_DEBOUNCE_MS = 400;

function sortPhotosNewestFirst(items) {
  return [...items].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export default function PhotoGallery({
  refreshKey,
  kind = '',
  title = 'Galeria',
  itemLabel = 'archivo',
  emptyMessage = 'Todavia no hay archivos registrados. Subi el primero.',
  searchLabel = 'Pedido/archivo',
  searchPlaceholder = '4821, remito...',
}) {
  const baseFilters = useMemo(() => ({ ...EMPTY_FILTERS, kind }), [kind]);
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [cachedPhotos, setCachedPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(baseFilters);
  const [appliedFilters, setAppliedFilters] = useState(baseFilters);
  const [viewMode, setViewMode] = useState(getGalleryViewMode);
  const [filtersOpen, setFiltersOpen] = useState(getFiltersOpen);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showUploader, setShowUploader] = useState(false);
  const [liveStatus, setLiveStatus] = useState('connecting');
  const [liveNotice, setLiveNotice] = useState(null);
  const [pendingNewPhoto, setPendingNewPhoto] = useState(null);
  const [page, setPage] = useState(1);
  const [phoneViewport,setPhoneViewport]=useState(isPhoneViewport);
  const pageSize=phoneViewport ? 30 : GALLERY_PAGE_SIZE;
  useEffect(()=>{
    const media=window.matchMedia(PHONE_MEDIA_QUERY);
    const changed=()=>{setPhoneViewport(media.matches);setPage(1);};
    media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);
  },[]);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const appliedFiltersRef = useRef(appliedFilters);
  const filtersRef = useRef(filters);
  const selectedIdsRef = useRef(selectedIds);
  const pageRef = useRef(page);
  const noticeTimerRef = useRef(null);
  const galleryRef = useRef(null);
  // Cada carga invalida a la anterior: una respuesta vieja (p. ej. la de una
  // búsqueda que ya no interesa) no pinta encima de la nueva.
  const loadIdRef = useRef(0);
  const requestRef = useRef(null);
  const asOfRef = useRef(null);
  const selectedCache = useRef(new Map());

  useEffect(() => {
    appliedFiltersRef.current = appliedFilters;
    selectedIdsRef.current = selectedIds;
    pageRef.current = page;
  }, [appliedFilters, selectedIds, page]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const clearLiveNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const showLiveNotice = useCallback(
    (message) => {
      clearLiveNoticeTimer();
      setLiveNotice(message);
      noticeTimerRef.current = window.setTimeout(() => {
        setLiveNotice(null);
        noticeTimerRef.current = null;
      }, 3500);
    },
    [clearLiveNoticeTimer],
  );

  const loadPhotos = useCallback(
    async (nextFilters, { silent = false, keepSelection = true, targetPage, resetSnapshot = true } = {}) => {
      const filtersToLoad = nextFilters ?? appliedFiltersRef.current;
      const requestId = ++loadIdRef.current;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const changedFilters = JSON.stringify(filtersToLoad) !== JSON.stringify(appliedFiltersRef.current);
      const requestedPage = targetPage ?? (changedFilters ? 1 : pageRef.current);
      if (resetSnapshot || changedFilters) asOfRef.current = null;

      // Aplicar filtros distintos siempre vuelve a la página 1; un refresco
      // (visibilidad, ↻, subida) pasa los filtros ya aplicados y conserva la
      // página en la que estabas.
      if (filtersToLoad !== appliedFiltersRef.current) setPage(1);

      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await readPage('foto_gallery_page', { ...filtersToLoad, kind }, {
          page: requestedPage, pageSize, asOf: asOfRef.current, signal: controller.signal,
        });
        if (loadIdRef.current !== requestId) return;
        setPhotos(data.items);
        setTotal(data.total);
        asOfRef.current = data.asOf;
        setPage(data.page);
        pageRef.current = data.page;
        const retained = changedFilters || !keepSelection ? new Map() : new Map([...selectedCache.current].filter(([id]) => selectedIdsRef.current.has(id)));
        data.items.forEach(photo => retained.set(photo.id, photo));
        selectedCache.current = retained;
        setCachedPhotos([...retained.values()]);
        setAppliedFilters(filtersToLoad);
        if (!keepSelection || changedFilters) {
          setSelectedIds(new Set());
        }
      } catch (err) {
        if (loadIdRef.current !== requestId || controller.signal.aborted) return;
        setError(err.message || 'No se pudieron cargar las fotos.');
      } finally {
        // El spinner lo apaga quien quedó vigente; si una carga más nueva ya
        // arrancó, ella se queda con el estado.
        if (loadIdRef.current === requestId && !silent) {
          setLoading(false);
        }
      }
    },
    [kind, pageSize],
  );

  // Búsqueda con debounce: se reconsulta ~400 ms después de la última tecla.
  // Si el usuario ya buscó a mano (Buscar/filtros), no se dispara de nuevo.
  useEffect(() => {
    if (filtersRef.current.search === appliedFiltersRef.current.search) return undefined;
    const timeout = window.setTimeout(() => {
      if (filtersRef.current.search === appliedFiltersRef.current.search) return;
      loadPhotos(filtersRef.current);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [filters.search, loadPhotos]);

  const handleRealtimeInsert = useCallback(
    (photo) => {
      if (!photoMatchesFilters(photo, { ...appliedFiltersRef.current, kind })) return;

      // Con selección activa o mirando otra página no se mete la foto nueva
      // (movería las tarjetas de la página que se está viendo): se ofrece con
      // «Ver», que lleva a la página 1 y la agrega.
      setPendingNewPhoto(photo);
    },
    [kind],
  );

  const handleRealtimeUpdate = useCallback((photo) => {
    if (selectedCache.current.has(photo.id)) {
      selectedCache.current.set(photo.id,photo);
      setCachedPhotos([...selectedCache.current.values()]);
    }
    const matches = photoMatchesFilters(photo, { ...appliedFiltersRef.current, kind });

    setPhotos((prev) => {
      const exists = prev.some((item) => item.id === photo.id);

      if (!matches) {
        return exists ? prev.filter((item) => item.id !== photo.id) : prev;
      }

      if (!exists) {
        return prev;
      }

      return sortPhotosNewestFirst(
        prev.map((item) => (item.id === photo.id ? photo : item)),
      );
    });
  }, [kind]);

  const handleRealtimeDelete = useCallback((id) => {
    selectedCache.current.delete(id);
    setCachedPhotos([...selectedCache.current.values()]);
    setPhotos((prev) => prev.filter((photo) => photo.id !== id));
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setPendingNewPhoto((prev) => (prev?.id === id ? null : prev));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadPhotos(appliedFiltersRef.current);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadPhotos, refreshKey]);

  useEffect(() => {
    const channel = supabase
      .channel(`photos-gallery-${kind || 'all'}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'photos' },
        (payload) => handleRealtimeInsert(payload.new),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'photos' },
        (payload) => handleRealtimeUpdate(payload.new),
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'photos' },
        (payload) => handleRealtimeDelete(payload.old.id),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLiveStatus('live');
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setLiveStatus('offline');
          return;
        }
        setLiveStatus('connecting');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleRealtimeDelete, handleRealtimeInsert, handleRealtimeUpdate, kind]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      loadPhotos(appliedFiltersRef.current, { silent: true, keepSelection: true });
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadPhotos]);

  useEffect(() => () => { clearLiveNoticeTimer(); requestRef.current?.abort(); }, [clearLiveNoticeTimer]);

  const selectedPhotos = useMemo(
    () => cachedPhotos.filter((photo) => selectedIds.has(photo.id)),
    [cachedPhotos, selectedIds],
  );

  // Server page: 30 rows on phones and 100 on desktop.
  const currentPage = useMemo(
    () => ({ items: photos, page, pageCount: Math.max(1, Math.ceil(total / pageSize)), start: (page - 1) * pageSize }),
    [photos, page, pageSize, total],
  );
  const pageItems = currentPage.items;
  const pageCount = currentPage.pageCount;

  const allSelected =
    pageItems.length > 0 && pageItems.every((photo) => selectedIds.has(photo.id));
  const hasSelection = selectedIds.size > 0;

  const hasActiveFilters = Object.entries(appliedFilters).some(([key, value]) => {
    if (key === 'kind') return false;
    if (typeof value === 'boolean') return value;
    return Boolean(value);
  });

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    loadPhotos(filters);
  }

  function applyToday() {
    const today = todayDateInput();
    const next = { ...filters, dateFrom: today, dateTo: today };
    setFilters(next);
    loadPhotos(next);
  }

  function applyYesterday() {
    const yesterday = yesterdayDateInput();
    const next = { ...filters, dateFrom: yesterday, dateTo: yesterday };
    setFilters(next);
    loadPhotos(next);
  }

  function applyComplaints() {
    const next = { ...filters, hasComplaint: true, isRefutado: false };
    setFilters(next);
    loadPhotos(next);
  }

  function toggleUnidentified() {
    const next = appliedFilters.codeNotFound ? baseFilters : { ...baseFilters, codeNotFound: true };
    setFilters(next);
    loadPhotos(next);
  }

  function clearFilters() {
    setFilters(baseFilters);
    loadPhotos(baseFilters);
  }

  function toggleFilters() {
    setFiltersOpen((prev) => {
      const next = !prev;
      saveFiltersOpen(next);
      return next;
    });
  }

  function handleUpdated(updated) {
    const matches = (photo) =>
      photoMatchesFilters(photo, { ...appliedFiltersRef.current, kind });

    if (Array.isArray(updated)) {
      updated.forEach(photo => selectedCache.current.set(photo.id, photo));
      setCachedPhotos([...selectedCache.current.values()]);
      setPhotos((prev) => {
        const map = new Map(updated.map((photo) => [photo.id, photo]));
        return prev
          .map((photo) => map.get(photo.id) || photo)
          .filter(matches);
      });
      return;
    }
    selectedCache.current.set(updated.id, updated);
    setCachedPhotos([...selectedCache.current.values()]);

    setPhotos((prev) => {
      const next = prev.map((photo) => (photo.id === updated.id ? updated : photo));
      if (!matches(updated)) {
        return next.filter((photo) => photo.id !== updated.id);
      }
      return next;
    });
  }

  function handleDeleted(ids) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    idSet.forEach(id => selectedCache.current.delete(id));
    setCachedPhotos([...selectedCache.current.values()]);
    setTotal(value => Math.max(0, value - idSet.size));
    setPhotos((prev) => prev.filter((photo) => !idSet.has(photo.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      idSet.forEach((id) => next.delete(id));
      return next;
    });
  }

  function changeViewMode(mode) {
    setViewMode(mode);
    saveGalleryViewMode(mode);
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectPhoto(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const ids = pageItems.map((photo) => photo.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // La selección se acumula entre páginas: al desmarcar «Página» solo
        // se quitan las de esta, las de las otras se conservan.
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    selectedCache.current = new Map(photos.map(photo=>[photo.id,photo]));
    setCachedPhotos(photos);
  }

  function acceptPendingPhoto() {
    if (!pendingNewPhoto) return;
    void loadPhotos(appliedFiltersRef.current, { targetPage: 1 });
    showLiveNotice(`Nuevo ${itemLabel} - ${getPhotoTitle(pendingNewPhoto)}`);
    setPendingNewPhoto(null);
  }

  function goToPage(nextPage) {
    const target = clampPage(nextPage, total,pageSize);
    if (target === pageRef.current) return;
    void loadPhotos(appliedFiltersRef.current, { targetPage: target, resetSnapshot: false });
    galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section ref={galleryRef} className={`gallery${hasSelection ? ' gallery--selecting' : ''}`}>
      {pendingNewPhoto && (
        <div className="gallery__pending" role="status">
          <span>Nuevo archivo — {getPhotoTitle(pendingNewPhoto)}</span>
          <div className="gallery__pending-actions">
            <button type="button" className="btn btn--small btn--primary" onClick={acceptPendingPhoto}>
              Ver
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => setPendingNewPhoto(null)}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {liveNotice && !pendingNewPhoto && (
        <div className="gallery__live-notice" role="status">
          {liveNotice}
        </div>
      )}

      <h2 className="gallery__title">{title}</h2>

      <div className="gallery__toolbar">
        <div className="gallery__toolbar-left">
          {!loading && (
            <p className="gallery__count">
              {total} {itemLabel}{total !== 1 ? 's' : ''}
              {hasActiveFilters ? ' · filtradas' : ''}
              {hasSelection ? ` · ${selectedIds.size} sel.` : ''}
            </p>
          )}
          {loading && photos.length > 0 && (
            <p className="gallery__count gallery__count--updating" role="status">
              Actualizando…
            </p>
          )}
          <span
            className={`gallery__live${liveStatus === 'live' ? ' gallery__live--on' : ''}`}
            title={
              liveStatus === 'live'
                ? 'La galería se actualiza sola'
                : 'Reconectando actualización en vivo'
            }
          >
            <span className="gallery__live-dot" aria-hidden="true" />
            {liveStatus === 'live' ? 'En vivo' : 'Sync…'}
          </span>
          <button
            type="button"
            className={`gallery__filters-toggle${filtersOpen ? ' gallery__filters-toggle--open' : ''}`}
            onClick={toggleFilters}
            aria-expanded={filtersOpen}
          >
            Filtros
            {hasActiveFilters && (
              <span className="gallery__filters-badge" aria-label="Filtros activos" />
            )}
          </button>
        </div>

        <div className="gallery__header-actions">
          {kind === 'orders' && <button type="button" className="btn btn--danger btn--small"
            onClick={() => setCleanupOpen(true)}>Borrar fotos antiguas</button>}
          {kind === 'orders' && (
            <button
              type="button"
              className={`btn btn--small ${appliedFilters.codeNotFound ? 'btn--primary' : 'btn--ghost'}`}
              onClick={toggleUnidentified}
              aria-pressed={appliedFilters.codeNotFound}
            >
              Sin código
            </button>
          )}
          <div className="tab-bar" role="group" aria-label="Modo de vista">
            <button
              type="button"
              className={`tab-bar__btn${viewMode === 'grid' ? ' tab-bar__btn--active' : ''}`}
              onClick={() => changeViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
            >
              Fotos
            </button>
            <button
              type="button"
              className={`tab-bar__btn${viewMode === 'list' ? ' tab-bar__btn--active' : ''}`}
              onClick={() => changeViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              Listado
            </button>
          </div>
          {kind === 'files' && (
            <button
              type="button"
              className={`btn btn--small ${showUploader ? 'btn--primary' : 'btn--ghost'} gallery__upload-trigger`}
              onClick={() => setShowUploader((prev) => !prev)}
            >
              {showUploader ? '✕ Ocultar' : '＋ Subir archivo'}
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => loadPhotos(appliedFilters)}
            disabled={loading}
            aria-label="Actualizar galería"
          >
            ↻
          </button>
        </div>
      </div>

      {kind === 'files' && showUploader && (
        <FileUploadCard
          onUploaded={() => {
            loadPhotos(appliedFiltersRef.current, { silent: false });
          }}
          onCancel={() => setShowUploader(false)}
        />
      )}

      {kind === 'orders' && appliedFilters.codeNotFound && (
        <CodeRecoveryPanel onUpdated={handleUpdated} />
      )}

      {filtersOpen && (
        <form className="gallery__filters gallery__filters--compact" onSubmit={handleSearchSubmit}>
          <div
            className={`gallery__filters-row gallery__filters-row--main${
              kind === 'orders' ? ' gallery__filters-row--with-aggregator' : ''
            }`}
          >
            <label className="gallery__filter-field gallery__filter-field--compact">
              <span>{searchLabel}</span>
              <input
                type="search"
                value={filters.search}
                onChange={(e) => updateFilter('search', e.target.value)}
                placeholder={searchPlaceholder}
              />
            </label>

            <label className="gallery__filter-field gallery__filter-field--compact">
              <span>Autor</span>
              <input
                type="search"
                value={filters.takenBy}
                onChange={(e) => updateFilter('takenBy', e.target.value)}
                placeholder="Lucas"
              />
            </label>

            <label className="gallery__filter-field gallery__filter-field--compact">
              <span>Notas</span>
              <input
                type="search"
                value={filters.notes}
                onChange={(e) => updateFilter('notes', e.target.value)}
                placeholder="Palabra clave"
              />
            </label>

            {kind === 'orders' && (
              <label className="gallery__filter-field gallery__filter-field--compact">
                <span>Agregador</span>
                <select
                  value={filters.aggregator}
                  onChange={(e) => updateFilter('aggregator', e.target.value)}
                >
                  <option value="">Todos</option>
                  {AGGREGATOR_OPTIONS.map((aggregator) => (
                    <option key={aggregator.id} value={aggregator.id}>
                      {aggregator.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="gallery__filters-row gallery__filters-row--secondary">
            <label className="gallery__filter-field gallery__filter-field--compact">
              <span>Desde</span>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => updateFilter('dateFrom', e.target.value)}
              />
            </label>

            <label className="gallery__filter-field gallery__filter-field--compact">
              <span>Hasta</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => updateFilter('dateTo', e.target.value)}
              />
            </label>

            <label className="gallery__filter-field gallery__filter-field--compact">
              <span>Hora desde</span>
              <input
                type="time"
                value={filters.timeFrom}
                onChange={(e) => updateFilter('timeFrom', e.target.value)}
              />
            </label>

            <label className="gallery__filter-field gallery__filter-field--compact">
              <span>Hora hasta</span>
              <input
                type="time"
                value={filters.timeTo}
                onChange={(e) => updateFilter('timeTo', e.target.value)}
              />
            </label>

            <div className="gallery__filter-checks gallery__filter-checks--inline">
              <label className="checkbox-label checkbox-label--compact">
                <input
                  type="checkbox"
                  checked={filters.hasComplaint}
                  onChange={(e) => updateFilter('hasComplaint', e.target.checked)}
                />
                <span>Reclamos</span>
              </label>
              <label className="checkbox-label checkbox-label--compact">
                <input
                  type="checkbox"
                  checked={filters.isRefutado}
                  onChange={(e) => updateFilter('isRefutado', e.target.checked)}
                />
                <span>Refutados</span>
              </label>
              {kind === 'orders' && (
                <label className="checkbox-label checkbox-label--compact">
                  <input
                    type="checkbox"
                    checked={filters.codeNotFound}
                    onChange={(e) => updateFilter('codeNotFound', e.target.checked)}
                  />
                  <span>Sin código</span>
                </label>
              )}
            </div>
          </div>

          <div className="gallery__filter-actions gallery__filter-actions--compact">
            <button type="submit" className="btn btn--primary btn--small">
              Buscar
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={applyToday}>
              Hoy
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={applyYesterday}>
              Ayer
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={applyComplaints}>
              Reclamos
            </button>
            {hasActiveFilters && (
              <button type="button" className="btn btn--ghost btn--small" onClick={clearFilters}>
                Limpiar
              </button>
            )}
          </div>
        </form>
      )}

      {loading && photos.length === 0 && (
        <div className="gallery__state">
          <div className="spinner" aria-hidden="true" />
          <p>Cargando {itemLabel}s...</p>
        </div>
      )}

      {error && (
        <div className="gallery__state">
          <p className="message message--error" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn--ghost" onClick={() => loadPhotos(appliedFilters)}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && photos.length === 0 && (
        <div className="gallery__state gallery__state--empty">
          <p>
            {hasActiveFilters
              ? `No hay ${itemLabel}s que coincidan con la busqueda.`
              : emptyMessage}
          </p>
          {kind === 'files' && !showUploader && (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => setShowUploader(true)}
              style={{ marginTop: '0.65rem' }}
            >
              ＋ Subir archivo
            </button>
          )}
        </div>
      )}

      {photos.length > 0 && (
        <label className="gallery__select-all checkbox-label">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
          />
          <span>
            {pageCount > 1 ? 'Página' : 'Todas'} ({pageItems.length})
          </span>
        </label>
      )}

      {photos.length > 0 && (
        <div className={viewMode === 'grid' ? 'gallery__grid' : 'gallery__list'}>
          {viewMode === 'grid'
            ? pageItems.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  highlight={appliedFilters.search}
                  selected={selectedIds.has(photo.id)}
                  onToggleSelect={toggleSelect}
                  onLongPressSelect={selectPhoto}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              ))
            : pageItems.map((photo) => (
                <PhotoListRow
                  key={photo.id}
                  photo={photo}
                  highlight={appliedFilters.search}
                  selected={selectedIds.has(photo.id)}
                  onToggleSelect={toggleSelect}
                  onLongPressSelect={selectPhoto}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              ))}
        </div>
      )}

      {photos.length > 0 && pageCount > 1 && (
        <nav className="gallery__pager" aria-label="Páginas de la galería">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => goToPage(currentPage.page - 1)}
            disabled={currentPage.page <= 1}
          >
            ‹ Anterior
          </button>
          <ul className="gallery__pager-pages">
            {pageNumbers(currentPage.page, pageCount).map((entry, index) =>
              typeof entry === 'number' ? (
                <li key={entry}>
                  <button
                    type="button"
                    className={`gallery__pager-btn${
                      entry === currentPage.page ? ' gallery__pager-btn--active' : ''
                    }`}
                    onClick={() => goToPage(entry)}
                    aria-current={entry === currentPage.page ? 'page' : undefined}
                    aria-label={`Página ${entry} de ${pageCount}`}
                  >
                    {entry}
                  </button>
                </li>
              ) : (
                <li key={`gap-${index}`} className="gallery__pager-gap" aria-hidden="true">
                  …
                </li>
              ),
            )}
          </ul>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => goToPage(currentPage.page + 1)}
            disabled={currentPage.page >= pageCount}
          >
            Siguiente ›
          </button>
          <p className="gallery__pager-range">
            Mostrando {currentPage.start + 1}–{currentPage.start + pageItems.length} de{' '}
            {total.toLocaleString('es-AR')}
            {hasActiveFilters ? ' filtrados' : ''}
          </p>
        </nav>
      )}

      <BulkActionBar
        selectedPhotos={selectedPhotos}
        allowDelete={kind === 'files'}
        onClearSelection={clearSelection}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />
      {cleanupOpen && <PhotoCleanupModal onClose={() => setCleanupOpen(false)}
        onCompleted={() => { clearSelection(); loadPhotos(appliedFiltersRef.current); }} />}
    </section>
  );
}
