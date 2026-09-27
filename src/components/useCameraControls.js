import { useEffect, useRef, useState } from 'react';
import { availableCameras, cameraZoomRange, rearCameras, snapCameraZoom, wideCamera } from '../lib/cameraControls';
import { clamp, pinchDistance } from '../lib/touchZoom';
import { setTrackTorch, trackSupportsTorch } from '../lib/cameraFlash';

const PREFERENCE = 'foto-app-evidence-camera';
export default function useCameraControls(videoRef, flashOnRef) {
  const streamRef = useRef(null);
  const mounted = useRef(false);
  const changing = useRef(false);
  const queue = useRef(null);
  const draining = useRef(false);
  const zoomRef = useRef(1);
  const rangeRef = useRef(null);
  const normalId = useRef('');
  const preferredId = useRef('');
  const points = useRef(new Map());
  const pinch = useRef(null);
  const [status, setStatus] = useState('starting');
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [zoomBusy, setZoomBusy] = useState(false);
  const [hardwareZoom, setHardwareZoom] = useState(false);
  const [range, setRange] = useState({ min: 1, max: 3 });
  const [devices, setDevices] = useState([]);
  const [allDevices, setAllDevices] = useState([]);
  const [enumerationError, setEnumerationError] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [normalDeviceId, setNormalDeviceId] = useState('');
  const [flashSupported, setFlashSupported] = useState(false);
  const [imageRatio, setImageRatio] = useState(4 / 3);

  async function attach(stream) {
    if (!mounted.current) { stream.getTracks().forEach(t => t.stop()); return; }
    streamRef.current = stream;
    const video = videoRef.current;
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { video.removeEventListener('loadedmetadata', ready); reject(new Error('La cámara no devolvió imagen.')); }, 8000);
      function ready() { clearTimeout(timer); video.removeEventListener('loadedmetadata', ready); resolve(); }
      video.addEventListener('loadedmetadata', ready);
    });
    if (!mounted.current || streamRef.current !== stream) return;
    const track = stream.getVideoTracks()[0];
    let nextRange = cameraZoomRange(track);
    const initial = nextRange ? clamp(1, nextRange.min, nextRange.max) : 1;
    if (nextRange) {
      try { await track.applyConstraints({ advanced: [{ zoom: initial }] }); }
      catch { nextRange = null; }
    }
    rangeRef.current = nextRange;
    const value = nextRange ? (track.getSettings().zoom ?? initial) : 1;
    zoomRef.current = value; setZoom(value);
    setHardwareZoom(Boolean(nextRange)); setRange(nextRange || { min: 1, max: 3 });
    const id = track.getSettings().deviceId || '';
    setDeviceId(id);
    setImageRatio(video.videoWidth / video.videoHeight);
    setFlashSupported(trackSupportsTorch(track));
    if (trackSupportsTorch(track)) await setTrackTorch(track, flashOnRef.current);
    await refreshDevices();
    setStatus('ready');
  }
  async function refreshDevices() {
    const track = streamRef.current?.getVideoTracks()[0];
    const id = track?.getSettings().deviceId || '';
    try {
      const discovered = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current) return;
      const all = availableCameras(discovered, { deviceId: id, label: track?.label });
      const cameras = rearCameras(all.map(d => ({ ...d, kind: 'videoinput' })), id);
      setAllDevices(all); setDevices(cameras); setEnumerationError('');
      if (!normalId.current) {
        const wide = wideCamera(cameras);
        const normal = wide?.deviceId === id ? cameras.find(d => d.deviceId !== id && !wideCamera([d]) && !/tele|macro/i.test(d.label) && /back|rear|environment|trasera/i.test(d.label)) : null;
        normalId.current = normal?.deviceId || id;
        setNormalDeviceId(normalId.current);
      }
    } catch {
      if (!mounted.current) return;
      setEnumerationError('No se pudo consultar la lista de cámaras. Tocá Volver a detectar.');
      normalId.current ||= id; setNormalDeviceId(normalId.current);
      setAllDevices(current => current.length ? current : availableCameras([], { deviceId: id, label: track?.label }));
    }
  }
  async function open(id) {
    return navigator.mediaDevices.getUserMedia({ audio: false, video: {
      ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 2560 }, height: { ideal: 1920 },
    } });
  }
  async function switchCamera(id, remember = false) {
    if (!id || changing.current || draining.current) return;
    if (streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId === id) {
      if (remember) savePreference(id);
      return;
    }
    changing.current = true; setStatus('starting'); setError(null); queue.current = null;
    const oldId = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      await attach(await open(id));
      if (remember) savePreference(id);
    } catch {
      try {
        streamRef.current?.getTracks().forEach(t => t.stop());
        await attach(await open(oldId));
        setError('No se pudo abrir ese lente. Se recuperó la cámara anterior.');
      } catch { setStatus('error'); setError('No se pudo recuperar la cámara. Cerrá y volvé a abrir.'); }
    } finally { changing.current = false; }
  }
  function savePreference(id) {
    preferredId.current = id;
    try { localStorage.setItem(PREFERENCE, id); } catch { /* Optional preference. */ }
  }
  async function requestZoom(value) {
    if (changing.current || !streamRef.current) return;
    const currentRange = rangeRef.current;
    const next = currentRange ? snapCameraZoom(value, currentRange) : clamp(value, 1, 3);
    queue.current = next;
    if (draining.current) return;
    draining.current = true; setZoomBusy(true);
    try {
      while (queue.current != null && mounted.current) {
        const desired = queue.current; queue.current = null;
        const track = streamRef.current?.getVideoTracks()[0];
        if (currentRange) await track.applyConstraints({ advanced: [{ zoom: desired }] });
        const actual = currentRange ? (track.getSettings().zoom ?? desired) : desired;
        zoomRef.current = actual; setZoom(actual);
      }
    } catch { queue.current = null; setError('No se pudo ajustar el zoom de esta cámara.'); }
    finally { draining.current = false; if (mounted.current) setZoomBusy(false); }
  }
  async function resetForStep(ticket) {
    const id = ticket ? normalId.current : preferredId.current;
    if (id && id !== streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId) await switchCamera(id);
    await requestZoom(rangeRef.current ? clamp(1, rangeRef.current.min, rangeRef.current.max) : 1);
  }
  function pointerDown(event) {
    if (status !== 'ready') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2) pinch.current = { distance: pinchDistance(points.current), zoom: zoomRef.current };
  }
  function pointerMove(event) {
    if (!points.current.has(event.pointerId)) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.current.size === 2 && pinch.current?.distance) {
      void requestZoom(pinch.current.zoom * pinchDistance(points.current) / pinch.current.distance);
    }
  }
  function pointerUp(event) { points.current.delete(event.pointerId); pinch.current = null; }
  useEffect(() => {
    let active = true;
    mounted.current = true;
    try { preferredId.current = localStorage.getItem(PREFERENCE) || ''; } catch { /* Optional preference. */ }
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    open().then(async stream => {
      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
      await attach(stream);
      if (active && normalId.current && normalId.current !== stream.getVideoTracks()[0]?.getSettings().deviceId) await switchCamera(normalId.current);
    }).catch(e => { if (active) { setError(e.message); setStatus('error'); } });
    const video = videoRef.current;
    const resize = () => { if (video.videoWidth) setImageRatio(video.videoWidth / video.videoHeight); };
    video.addEventListener('resize', resize);
    return () => {
      active = false; mounted.current = false; queue.current = null;
      streamRef.current?.getTracks().forEach(t => t.stop());
      video.removeEventListener('resize', resize); document.body.style.overflow = overflow;
    };
    // A camera session lives for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { streamRef, status, error, setError, zoom, minZoom: range.min, maxZoom: range.max,
    hardwareZoom, zoomBusy, flashSupported, setFlashSupported, devices, deviceId,
    normalDeviceId, wideDeviceId: wideCamera(devices)?.deviceId,
    allDevices, enumerationError, nativeRange: hardwareZoom ? range : null, refreshDevices,
    imageRatio, switchCamera, requestZoom, resetForStep,
    gestures: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp,
      onPointerCancel: pointerUp, onLostPointerCapture: pointerUp } };
}
