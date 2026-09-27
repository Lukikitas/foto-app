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
  return devices.find(d => /ultra.?wide|ultra.?grand|ultra.?ampl|0[.,]5|ultra.?angular/i.test(d.label));
}
