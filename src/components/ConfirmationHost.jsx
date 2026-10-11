import { useEffect, useId, useState } from 'react';
import { registerConfirmation } from '../lib/confirmAction';
import Dialog from './Dialog';

export default function ConfirmationHost() {
  const [pending, setPending] = useState(null);
  const titleId = useId();
  useEffect(() => {
    let active;
    const off = registerConfirmation(options => new Promise(resolve => {
      if (active) { resolve(false); return; }
      active = resolve;
      setPending({ ...options, resolve: value => { active = null; setPending(null); resolve(value); } });
    }));
    return () => { off(); active?.(false); };
  }, []);
  return pending && <Dialog labelledBy={titleId} onClose={() => pending.resolve(false)}>
    <section className="app-dialog__panel">
      <header className="app-dialog__header"><h3 id={titleId}>{pending.title || 'Confirmar acción'}</h3></header>
      <div className="app-dialog__body"><p>{pending.message}</p></div>
      <footer className="app-dialog__actions">
        <button className="btn btn--ghost" autoFocus onClick={() => pending.resolve(false)}>Cancelar</button>
        <button className={`btn ${pending.danger === false ? 'btn--primary' : 'btn--danger'}`} onClick={() => pending.resolve(true)}>{pending.confirmLabel || 'Confirmar'}</button>
      </footer>
    </section>
  </Dialog>;
}
