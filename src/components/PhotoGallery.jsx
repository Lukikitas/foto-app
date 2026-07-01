import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayDateInput, yesterdayDateInput } from '../lib/date';
import { fetchPhotos, getPhotoTitle, photoMatchesFilters } from '../lib/photos';
import { supabase } from '../lib/supabase';
import {
  getFiltersOpen,
  getGalleryViewMode,
  saveFiltersOpen,
  saveGalleryViewMode,
} from '../lib/storage';
import BulkActionBar from './BulkActionBar';
import PhotoCard from './PhotoCard';
import PhotoListRow from './PhotoListRow';

const EMPTY_FILTERS = {
  kind: '',
  search: '',
  dateFrom: '',
  dateTo: '',
  hasComplaint: false,
  isRefutado: false,
  takenBy: '',
  notes: '',
};

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(baseFilters);
  const [appliedFilters, setAppliedFilters] = useState(baseFilters);
  const [viewMode, setViewMode] = useState(getGalleryViewMode);
  const [filtersOpen, setFiltersOpen] = useState(getFiltersOpen);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [liveStatus, setLiveStatus] = useState('connecting');
  const [liveNotice, setLiveNotice] = useState(null);
  const [pendingNewPhoto, setPendingNewPhoto] = useState(null);

  const appliedFiltersRef = useRef(appliedFilters);
  const selectedIdsRef = useRef(selectedIds);
  const noticeTimerRef = useRef(null);

  useEffect(() => {
    appliedFiltersRef.current = appliedFilters;
    selectedIdsRef.current = selectedIds;
  }, [appliedFilters, selectedIds]);

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

  const prependPhoto = useCallback((photo) => {
    setPhotos((prev) => {
      if (prev.some((item) => item.id === photo.id)) return prev;
      return sortPhotosNewestFirst([photo, ...prev]);
    });
  }, []);

  const loadPhotos = useCallback(
    async (nextFilters, { silent = false, keepSelection = false } = {}) => {
      const filtersToLoad = nextFilters ?? appliedFiltersRef.current;

      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await fetchPhotos({ ...filtersToLoad, kind });
        setPhotos(data);
        setAppliedFilters(filtersToLoad);
        if (!keepSelection) {
          setSelectedIds(new Set());
        }
      } catch (err) {
        setError(err.message || 'No se pudieron cargar las fotos.');
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [kind],
  );

  const handleRealtimeInsert = useCallback(
    (photo) => {
      if (!photoMatchesFilters(photo, { ...appliedFiltersRef.current, kind })) return;

      if (selectedIdsRef.current.size > 0) {
        setPendingNewPhoto(photo);
        return;
      }

      prependPhoto(photo);
      showLiveNotice(`Nuevo ${itemLabel} - ${getPhotoTitle(photo)}`);
    },
    [itemLabel, kind, prependPhoto, showLiveNotice],
  );

  const handleRealtimeUpdate = useCallback((photo) => {
    const matches = photoMatchesFilters(photo, { ...appliedFiltersRef.current, kind });

    setPhotos((prev) => {
      const exists = prev.some((item) => item.id === photo.id);

      if (!matches) {
        return exists ? prev.filter((item) => item.id !== photo.id) : prev;
      }

      if (!exists) {
        return sortPhotosNewestFirst([photo, ...prev]);
      }

      return sortPhotosNewestFirst(
        prev.map((item) => (item.id === photo.id ? photo : item)),
      );
    });
  }, [kind]);

  const handleRealtimeDelete = useCallback((id) => {
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

  useEffect(() => () => clearLiveNoticeTimer(), [clearLiveNoticeTimer]);

  const selectedPhotos = useMemo(
    () => photos.filter((photo) => selectedIds.has(photo.id)),
    [photos, selectedIds],
  );

  const allSelected = photos.length > 0 && selectedIds.size === photos.length;
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
    if (Array.isArray(updated)) {
      setPhotos((prev) => {
        const map = new Map(updated.map((photo) => [photo.id, photo]));
        return prev.map((photo) => map.get(photo.id) || photo);
      });
      return;
    }

    setPhotos((prev) =>
      prev.map((photo) => (photo.id === updated.id ? updated : photo)),
    );
  }

  function handleDeleted(ids) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
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
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(photos.map((photo) => photo.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function acceptPendingPhoto() {
    if (!pendingNewPhoto) return;
    prependPhoto(pendingNewPhoto);
    showLiveNotice(`Nuevo ${itemLabel} - ${getPhotoTitle(pendingNewPhoto)}`);
    setPendingNewPhoto(null);
  }

  return (
    <section className={`gallery${hasSelection ? ' gallery--selecting' : ''}`}>
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
              {photos.length} {itemLabel}{photos.length !== 1 ? 's' : ''}
              {hasActiveFilters ? ' · filtradas' : ''}
              {hasSelection ? ` · ${selectedIds.size} sel.` : ''}
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
          <div className="gallery__view-toggle" role="group" aria-label="Modo de vista">
            <button
              type="button"
              className={`gallery__view-btn${viewMode === 'grid' ? ' gallery__view-btn--active' : ''}`}
              onClick={() => changeViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
            >
              Fotos
            </button>
            <button
              type="button"
              className={`gallery__view-btn${viewMode === 'list' ? ' gallery__view-btn--active' : ''}`}
              onClick={() => changeViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              Listado
            </button>
          </div>
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

      {filtersOpen && (
        <form className="gallery__filters gallery__filters--compact" onSubmit={handleSearchSubmit}>
          <div className="gallery__filters-row gallery__filters-row--main">
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
        </div>
      )}

      {photos.length > 0 && (
        <label className="gallery__select-all checkbox-label">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
          />
          <span>Todas ({photos.length})</span>
        </label>
      )}

      {photos.length > 0 && (
        <div className={viewMode === 'grid' ? 'gallery__grid' : 'gallery__list'}>
          {viewMode === 'grid'
            ? photos.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  selected={selectedIds.has(photo.id)}
                  onToggleSelect={toggleSelect}
                  onLongPressSelect={selectPhoto}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              ))
            : photos.map((photo) => (
                <PhotoListRow
                  key={photo.id}
                  photo={photo}
                  selected={selectedIds.has(photo.id)}
                  onToggleSelect={toggleSelect}
                  onLongPressSelect={selectPhoto}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              ))}
        </div>
      )}

      <BulkActionBar
        selectedPhotos={selectedPhotos}
        onClearSelection={clearSelection}
        onUpdated={handleUpdated}
        onDeleted={handleDeleted}
      />
    </section>
  );
}
