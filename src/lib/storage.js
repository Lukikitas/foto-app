const TAKEN_BY_KEY = 'foto-app-taken-by';
const GALLERY_VIEW_KEY = 'foto-app-gallery-view';
const FILTERS_OPEN_KEY = 'foto-app-filters-open';
const NAV_COLLAPSED_KEY = 'foto-app-nav-collapsed';

export function getLastTakenBy() {
  try {
    return localStorage.getItem(TAKEN_BY_KEY) || '';
  } catch {
    return '';
  }
}

export function saveLastTakenBy(name) {
  try {
    if (name?.trim()) {
      localStorage.setItem(TAKEN_BY_KEY, name.trim());
    }
  } catch {
    // localStorage no disponible
  }
}

export function getGalleryViewMode() {
  try {
    return localStorage.getItem(GALLERY_VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function saveGalleryViewMode(mode) {
  try {
    localStorage.setItem(GALLERY_VIEW_KEY, mode);
  } catch {
    // localStorage no disponible
  }
}

export function getFiltersOpen() {
  try {
    return localStorage.getItem(FILTERS_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveFiltersOpen(open) {
  try {
    localStorage.setItem(FILTERS_OPEN_KEY, String(open));
  } catch {
    // localStorage no disponible
  }
}

export function getNavCollapsed() {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveNavCollapsed(collapsed) {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, String(Boolean(collapsed)));
  } catch {
    // localStorage no disponible
  }
}

const IMPORT_AGGREGATOR_KEY = 'foto-app-import-aggregator';

export function getImportAggregator() {
  try {
    return localStorage.getItem(IMPORT_AGGREGATOR_KEY) || '';
  } catch {
    return '';
  }
}

export function saveImportAggregator(aggregator) {
  try {
    const value = String(aggregator || '').trim();
    if (value) localStorage.setItem(IMPORT_AGGREGATOR_KEY, value);
    else localStorage.removeItem(IMPORT_AGGREGATOR_KEY);
  } catch {
    // localStorage no disponible
  }
}

const SHEET_URL_KEY = 'foto-app-complaints-sheet-url';

export function getSavedSheetUrl() {
  try {
    return localStorage.getItem(SHEET_URL_KEY) || '';
  } catch {
    return '';
  }
}

export function saveSheetUrl(url) {
  try {
    const trimmed = url?.trim() || '';
    if (trimmed) localStorage.setItem(SHEET_URL_KEY, trimmed);
    else localStorage.removeItem(SHEET_URL_KEY);
  } catch {
    // localStorage no disponible
  }
}
