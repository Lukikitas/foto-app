const TAKEN_BY_KEY = 'foto-app-taken-by';
const GALLERY_VIEW_KEY = 'foto-app-gallery-view';

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
