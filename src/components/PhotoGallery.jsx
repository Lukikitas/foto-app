import { useCallback, useEffect, useState } from 'react';
import { todayDateInput, yesterdayDateInput } from '../lib/date';
import { fetchPhotos } from '../lib/photos';
import PhotoCard from './PhotoCard';

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

  const loadPhotos = useCallback(async (nextFilters = appliedFilters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPhotos(nextFilters);
      setPhotos(data);
      setAppliedFilters(nextFilters);
    } catch (err) {
      setError(err.message || 'No se pudieron cargar las fotos.');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    loadPhotos(appliedFilters);
  }, [refreshKey]);

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

  const hasActiveFilters = Object.entries(appliedFilters).some(([key, value]) => {
    if (typeof value === 'boolean') return value;
    return Boolean(value);
  });

  function handleUpdated(updated) {
    setPhotos((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
  }

  function handleDeleted(id) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <section className="gallery">
      <div className="gallery__header">
        <div>
          <h2>Pedidos registrados</h2>
          {!loading && (
            <p className="gallery__count">
              {photos.length} foto{photos.length !== 1 ? 's' : ''}
              {hasActiveFilters ? ' con los filtros aplicados' : ''}
            </p>
          )}
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
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={applyToday}
          >
            Hoy
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={applyYesterday}
          >
            Ayer
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={applyComplaints}
          >
            Reclamos
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={clearFilters}
            >
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
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => loadPhotos(appliedFilters)}
          >
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
        <div className="gallery__grid">
          {photos.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </section>
  );
}
