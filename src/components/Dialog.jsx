import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const dialogs = [];
let initialOverflow = '';
export default function Dialog({ children, onClose, busy = false, labelledBy, label, variant = 'normal', className = '' }) {
  const ref = useRef(null);
  // Capture before portal children apply autoFocus during commit.
  const [opener] = useState(() => document.activeElement);
  const current = useRef({ onClose, busy });
  useEffect(() => { current.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    const root = ref.current;
    if (!dialogs.length) initialOverflow = document.body.style.overflow;
    dialogs.push(root); document.body.style.overflow = 'hidden';
    const controls = () => [...root.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length);
    (root.querySelector('[autofocus]') || controls()[0] || root).focus();
    function key(event) {
      if (dialogs.at(-1) !== root) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!current.current.busy) current.current.onClose?.();
      }
      if (event.key === 'Tab') {
        const elements = controls(); const first = elements[0]; const last = elements.at(-1);
        if (!first) { event.preventDefault(); root.focus(); }
        else if (!root.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', key, true);
    return () => {
      dialogs.splice(dialogs.indexOf(root), 1); document.removeEventListener('keydown', key, true);
      if (!dialogs.length) document.body.style.overflow = initialOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);
  return createPortal(<div ref={ref} className={`app-dialog app-dialog--${variant} ${className}`} role="dialog"
    tabIndex={-1} aria-modal="true" aria-labelledby={labelledBy} aria-label={label} aria-busy={busy}
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose?.(); }}>
    {children}
  </div>, document.body);
}
