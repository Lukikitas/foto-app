import { useState } from 'react';
import { cameraDiagnostic } from '../lib/cameraControls';
import { APP_VERSION } from '../lib/version';

export default function CameraLensPicker({ camera, disabled, remember }) {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState('');
  const [message, setMessage] = useState('');
  const blocked = disabled || checking;
  async function refresh() {
    setChecking(true); setReport(''); setMessage('');
    try { await camera.refreshDevices(); } finally { setChecking(false); }
  }
  async function copyReport() {
    const text = 'Foto-app ' + APP_VERSION + '\n' + cameraDiagnostic({ devices: camera.allDevices, deviceId: camera.deviceId,
      range: camera.nativeRange, enumerationError: camera.enumerationError, userAgent: navigator.userAgent,
      standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone });
    setReport(text);
    try { await navigator.clipboard.writeText(text); setMessage('Diagnóstico copiado. Podés pegarlo en el chat.'); }
    catch { setMessage('Seleccioná y copiá el diagnóstico de abajo.'); }
  }
  return <div className="camera-lens-picker">
    <div className="order-camera__lenses">
      {camera.wideDeviceId && camera.wideDeviceId !== camera.normalDeviceId && <>
        <button type="button" className="btn btn--small btn--ghost" disabled={blocked} onClick={() => camera.switchCamera(camera.normalDeviceId, remember)}>Normal</button>
        <button type="button" className="btn btn--small btn--ghost" aria-pressed={camera.deviceId === camera.wideDeviceId} disabled={blocked} onClick={() => camera.switchCamera(camera.wideDeviceId, remember)}>Gran angular</button>
      </>}
      {camera.nativeRange?.min < 1 && <button type="button" className="btn btn--small btn--ghost" disabled={blocked} onClick={() => camera.requestZoom(camera.minZoom)}>{Number(camera.minZoom.toFixed(2))}×</button>}
      {camera.allDevices.length > 1 && <label>Elegir cámara <select aria-label="Elegir cámara" value={camera.deviceId} disabled={blocked} onChange={event => camera.switchCamera(event.target.value, remember)}>
        {camera.allDevices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || ('Cámara ' + (index + 1))}</option>)}
      </select></label>}
    </div>
    <details className="camera-lens-picker__help">
      <summary>¿No aparece el 0,5×?</summary>
      <div className="camera-lens-picker__panel">
        {camera.enumerationError ? <p role="alert">{camera.enumerationError}</p> : <p>La PWA detecta {camera.allDevices.length} {camera.allDevices.length === 1 ? 'cámara' : 'cámaras'}, incluidas las frontales disponibles.</p>}
        <p>Si aparece «Elegir cámara», probá las opciones traseras: el gran angular puede tener un nombre genérico y marcar 1× dentro de su propio lente.</p>
        <p>Si ninguna amplía el encuadre, el navegador podría no ofrecer el gran angular. Tener 0,5× en la cámara del teléfono no asegura que esté disponible en la PWA.</p>
        <button type="button" className="btn btn--small btn--ghost" disabled={blocked} onClick={refresh}>{checking ? 'Detectando…' : 'Volver a detectar'}</button>
        <button type="button" className="btn btn--small btn--ghost" onClick={copyReport}>Copiar diagnóstico</button>
        {message && <p role="status">{message}</p>}
        {report && <textarea aria-label="Diagnóstico de cámara" readOnly value={report} rows={6} />}
      </div>
    </details>
  </div>;
}
