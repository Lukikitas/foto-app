const TAKEN_BY_KEY = 'foto-app-taken-by';

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
