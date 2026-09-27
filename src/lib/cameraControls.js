import { clamp } from './touchZoom.js';
export function cameraZoomRange(track) {
  const range = track?.getCapabilities?.().zoom;
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min || range.min <= 0) return null;
  return { min: range.min, max: Math.min(range.max, Math.max(4, range.min)), step: range.step || 0.01 };
}
export function snapCameraZoom(value, range) {
  return clamp(range.min + Math.round((value - range.min) / range.step) * range.step, range.min, range.max);
}
export function rearCameras(devices, activeId) {
  return devices.filter(d => d.kind === 'videoinput' && (d.deviceId === activeId || !/front|user|facetime|frontal/i.test(d.label)));
}
export function wideCamera(devices) {
  return devices.find(d => {
    const label = String(d.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /ultra[\s_-]*(?:wide|gran(?:d)?[\s_-]*(?:ang|angle)|ampl|angular)|super[\s_-]*wide|(?:^|\s)0[.,]5(?:x|×|\s|$)/.test(label);
  });
}
export function availableCameras(devices, active = {}) {
  const cameras = new Map(devices.filter(d => d.kind === 'videoinput' && d.deviceId).map(d => [d.deviceId, { deviceId: d.deviceId, label: d.label || '' }]));
  if (active.deviceId && !cameras.has(active.deviceId)) cameras.set(active.deviceId, { deviceId: active.deviceId, label: active.label || 'Cámara actual' });
  return [...cameras.values()];
}
export function cameraDiagnostic({ devices, deviceId, range, enumerationError, userAgent, standalone }) {
  return JSON.stringify({
    browser: userAgent, installed: Boolean(standalone),
    cameras: devices.map((d, index) => ({ number: index + 1, name: d.label || 'Sin nombre', active: d.deviceId === deviceId })),
    nativeZoom: range ? { min: range.min, max: range.max, step: range.step } : null,
    enumerationError: enumerationError || null,
  }, null, 2);
}
