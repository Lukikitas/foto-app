const ICONS = {
  pending: <><rect x="5" y="4" width="14" height="17" rx="3" /><path d="M9 4V3h6v1M9 10l1.5 1.5L14 8M9 16h6" /></>,
  metrics: <><path d="M4 4v16h16M8 16v-4m5 4V8m5 8V5" /><path d="m7 8 5-4 4 1 4-3" /></>,
  capture: <><path d="M8 5.5 9.5 3h5L16 5.5h3A2 2 0 0 1 21 7.5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="4" /><path d="M17.5 9h.01" /></>,
  gallery: <><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
  complaints: <><path d="M8 19 4 22v-5a3 3 0 0 1-1-2V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9Z" /><path d="M12 7v5m0 3h.01" /></>,
  history: <><path d="M3 10a9 9 0 1 1 2.5 8M3 4v6h6M12 7v5l3 2" /></>,
  files: <><path d="M3 8V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 11h18" /></>,
  settings: <><path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  collapse: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m7-12-3 4 3 4" /></>,
  expand: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m4-12 3 4-3 4" /></>,
};

export default function NavIcon({ name }) {
  return <span className="app-nav__icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  </span>;
}
