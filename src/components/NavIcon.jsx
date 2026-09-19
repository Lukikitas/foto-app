const ICONS = {
  metrics: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 16V9h3v7H4zm4.5 0V5h3v11h-3zM13 16v-5h3v5h-3z" />
    </svg>
  ),
  capture: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 6.5h2.2l1.1-1.5h5.4l1.1 1.5H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16.5H4A1.5 1.5 0 0 1 2.5 15v-7A1.5 1.5 0 0 1 4 6.5zm6 8.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z" />
    </svg>
  ),
  gallery: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 4.5h5v5h-5v-5zm8 0h5v5h-5v-5zm-8 8h5v5h-5v-5zm8 0h5v5h-5v-5z" />
    </svg>
  ),
  complaints: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 3.5h12v11H8.2L4 16.8V3.5zm3 3.2h6v1.4H7V6.7zm0 3.1h6v1.4H7v-1.4z" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.2a6.8 6.8 0 1 1-4.8 2M5.2 3.4v3.2H8.4M10 6.6V10l2.4 1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  ),
  files: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3.5h6.2L15.5 8v8.5H5V3.5zm6.2 0V8h4.3" />
    </svg>
  ),
  collapse: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12.2 4.5 6.7 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.8 4.5 13.3 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" />
    </svg>
  ),
};

export default function NavIcon({ name }) {
  return (
    <span className="app-nav__icon" aria-hidden="true">
      {ICONS[name]}
    </span>
  );
}
