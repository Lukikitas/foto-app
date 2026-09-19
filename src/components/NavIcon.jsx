const ICONS = {
  metrics: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3.5" y="9" width="3.2" height="7.5" />
      <rect x="8.4" y="4.5" width="3.2" height="12" />
      <rect x="13.3" y="7" width="3.2" height="9.5" />
    </svg>
  ),
  capture: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.6 6.4h3.1l1.1-1.7h6.4l1.1 1.7h3.1c.7 0 1.2.5 1.2 1.2v8.1c0 .7-.5 1.2-1.2 1.2H2.6c-.7 0-1.2-.5-1.2-1.2V7.6c0-.7.5-1.2 1.2-1.2z" />
    </svg>
  ),
  gallery: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="6.2" height="6.2" />
      <rect x="10.8" y="3" width="6.2" height="6.2" />
      <rect x="3" y="10.8" width="6.2" height="6.2" />
      <rect x="10.8" y="10.8" width="6.2" height="6.2" />
    </svg>
  ),
  complaints: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 3.2h12v10.6H8.4L4 16.8V3.2z" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10.2" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 6.6v4l2.6 1.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  files: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3.2h6.4L15.2 7v9.6H5V3.2z" />
    </svg>
  ),
  collapse: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12.4 4.4 6.8 10l5.6 5.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.6 4.4 13.2 10l-5.6 5.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
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
