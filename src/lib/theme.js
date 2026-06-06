const THEME_KEY = 'foto-app-theme';

export function getTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage no disponible
  }
  return 'dark';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = theme === 'light' ? '#F5F1ED' : '#121212';
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage no disponible
  }
  applyTheme(theme);
}

export function toggleTheme(currentTheme) {
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  saveTheme(nextTheme);
  return nextTheme;
}
