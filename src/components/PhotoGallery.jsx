import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayDateInput, yesterdayDateInput } from '../lib/date';
import { fetchPhotos } from '../lib/photos';
import { getGalleryViewMode, saveGalleryViewMode } from '../lib/storage';
import BulkActionBar from './BulkActionBar';
import PhotoCard from './PhotoCard';
import PhotoListRow from './PhotoListRow';

const EMPTY_FILTERS = {
  search: '',
  dateFrom: '',
  dateTo: '',
  hasComplaint: false,
  isRefutado: false,
  takenBy: '',
  notes: '',
};

export default function PhotoGallery({ refreshKey }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState(getGalleryViewMode);
  const [selectedIds, setSelectedIds] = useState(new Set());

  const loadPhotos = useCallback(async (nextFilters = appliedFilters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPhotos(nextFilters);
      setPhotos(data);
      setAppliedFilters(nextFilters);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las fotos.');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    loadPhotos(appliedFilters);
  }, [refreshKey]);

  const selectedPhotos = useMemo(
    () => photos.filter((photo) => selectedIds.has(photo.id)),
    [photos, selectedIds]
  );

  const allSelected = photos.length > 0 && selectedIds.size === photos.length;
  const hasSelection = selectedIds.size > 0;

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
    setFilters(EMPTY_FILTERS);
    loadPhotos(EMPTY_FILTERS);
  }

  const hasActiveFilters = Object.entries(appliedFilters).some(([, value]) => {
    if (typeof value === 'boolean') return value;
    return Boolean(value);
  });

  function handleUpdated(updated) {
    if (Array.isArray(updated)) {
      setPhotos((prev) => {
        const map = new Map(updated.map((photo) => [photo.id, photo]));
        return prev.map((photo) => map.get(photo.id) || photo);
      });
      return;
    }

    setPhotos((prev) =>
      prev.map((photo) => (photo.id === updated.id ? updated : photo))
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

  return (
    <section className={`gallery${hasSelection ? ' gallery--selecting' : ''}`}>
      <div className="gallery__header">
        {!loading && (
          <p className="gallery__count">
            {photos.length} foto{photos.length !== 1 ? 's' : ''}
            {hasActiveFilters ? ' · filtradas' : ''}
            {hasSelection ? ` · ${selectedIds.size} seleccionada${selectedIds.size !== 1 ? 's' : ''}` : ''}
          </p>
        )}
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
          >
            Actualizar
          </button>
        </div>
      </div>

      <form className="gallery__filters" onSubmit={handleSearchSubmit}>
        <label className="gallery__filter-field gallery__filter-field--search">
          Buscar pedido
          <input
            type="search"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4 dígitos, ej: 4821"
            inputMode="numeric"
            maxLength={4}
          />
        </label>

        <label className="gallery__filter-field">
          Desde
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
          />
        </label>

        <label className="gallery__filter-field">
          Hasta
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
          />
        </label>

        <label className="gallery__filter-field">
          Quién sacó la foto
          <input
            type="search"
            value={filters.takenBy}
            onChange={(e) => updateFilter('takenBy', e.target.value)}
            placeholder="Ej: Lucas"
          />
        </label>

        <label className="gallery__filter-field gallery__filter-field--wide">
          Buscar en anotaciones
          <input
            type="search"
            value={filters.notes}
            onChange={(e) => updateFilter('notes', e.target.value)}
            placeholder="Palabra clave en las notas"
          />
        </label>

        <div className="gallery__filter-checks">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.hasComplaint}
              onChange={(e) => updateFilter('hasComplaint', e.target.checked)}
            />
            <span>Solo reclamos</span>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={filters.isRefutado}
              onChange={(e) => updateFilter('isRefutado', e.target.checked)}
            />
            <span>Solo refutados</span>
          </label>
        </div>

        <div className="gallery__filter-actions">
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

      {loading && photos.length === 0 && (
        <div className="gallery__state">
          <div className="spinner" aria-hidden="true" />
          <p>Cargando fotos…</p>
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
              ? 'No hay fotos que coincidan con la búsqueda.'
              : 'Todavía no hay pedidos registrados. ¡Sacá la primera foto!'}
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
          <span>Seleccionar todas ({photos.length})</span>
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
