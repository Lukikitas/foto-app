import { nativeCameraLinks } from '../lib/nativeCamera';
import NavIcon from './NavIcon';

export default function NativeCameraEntry() {
  const links = nativeCameraLinks(window.location.origin);
  return (
    <section className="native-camera-entry" aria-label="Cámara de pedidos">
      <h1>Fotos de pedidos</h1>
      <p>Ticket y bolsa, desde Delivery Star · Fotos.</p>
      <a className="uploader__hero-camera-btn" href={links.open}>
        <span className="uploader__hero-icon-ring"><NavIcon name="capture" /></span>
        <span className="uploader__hero-text"><strong>SACAR FOTO</strong><span>Abrir la app de cámara</span></span>
      </a>
      <p className="native-camera-entry__hint">Las fotos se guardan en este celular antes de enviarse.</p>
      <a className="native-camera-entry__download" href={links.download}>Descargar o actualizar la app</a>
      <p className="native-camera-entry__hint">Después de instalarla, volvé y tocá Sacar foto.</p>
    </section>
  );
}
