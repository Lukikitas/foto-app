import { useState } from 'react';
import { nativeCameraLinks, normalizeCameraAuthor, usesNativeCamera } from '../lib/nativeCamera';
import { getTakenByHistory, saveLastTakenBy } from '../lib/storage';
import NavIcon from './NavIcon';
import PhotographerPicker from './PhotographerPicker';

export default function NativeCameraEntry({ author = '', onAuthorChange }) {
  const demo = import.meta.env.MODE === 'demo';
  const [history] = useState(getTakenByHistory);
  const [error, setError] = useState('');
  const name = normalizeCameraAuthor(author);
  const links = nativeCameraLinks(window.location.origin, { author: name });
  const open = usesNativeCamera(undefined, demo ? 'true' : undefined) ? links.open : links.download;
  function changeAuthor(value, meta) {
    onAuthorChange?.(value);
    setError('');
    if (meta?.selected && normalizeCameraAuthor(value)) {
      saveLastTakenBy(normalizeCameraAuthor(value));
    }
  }
  function openCamera(event) {
    if (!name) {
      event.preventDefault();
      setError('Ingresá quién saca la foto antes de abrir la cámara.');
      return;
    }
    saveLastTakenBy(name);
  }
  return (
    <section className="native-camera-entry" aria-label="Cámara de pedidos">
      <h1>Fotos de pedidos</h1>
      <p>Ticket y bolsa, desde Delivery Star · Fotos.</p>
      <PhotographerPicker value={author} history={history} onChange={changeAuthor} />
      {error && <p className="message message--error" role="alert">{error}</p>}
      <a className="uploader__hero-camera-btn" href={open} onClick={openCamera} aria-disabled={!name}>
        <span className="uploader__hero-icon-ring"><NavIcon name="capture" /></span>
        <span className="uploader__hero-text"><strong>SACAR FOTO</strong><span>Abrir la app de cámara</span></span>
      </a>
      <p className="native-camera-entry__hint">{demo ? 'Modo demo: las fotos quedan solamente en este celular, sin envíos.' : 'Las fotos se guardan en este celular antes de enviarse.'}</p>
      <a className="native-camera-entry__download" href={links.download}>Descargar o actualizar la app</a>
      <p className="native-camera-entry__hint">Después de instalarla, volvé y tocá Sacar foto.</p>
    </section>
  );
}
