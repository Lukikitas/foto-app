export const NATIVE_CAMERA_PACKAGE = 'app.deliverystar.capture';
export const NATIVE_CAMERA_DOWNLOAD_PATH = '/manual/piloto-android/';
export const DEMO_CAMERA_PACKAGE = 'app.deliverystar.capture.demo';
export const DEMO_CAMERA_DOWNLOAD_PATH = '/demo/camara/';

// No installation probing or timed redirects: the browser resolves the pinned
// Android package and uses the HTTPS fallback if it cannot open the app.
export function nativeCameraLinks(origin, { demo = import.meta.env?.MODE === 'demo' } = {}) {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol)) throw new TypeError('Invalid web origin');
  const download = new URL(demo ? DEMO_CAMERA_DOWNLOAD_PATH : NATIVE_CAMERA_DOWNLOAD_PATH, base.origin).href;
  const cameraPackage = demo ? DEMO_CAMERA_PACKAGE : NATIVE_CAMERA_PACKAGE;
  return {
    download,
    open: `intent://capture#Intent;scheme=deliverystar;package=${cameraPackage};S.browser_fallback_url=${encodeURIComponent(download)};end`,
  };
}

export function usesNativeCamera(userAgent = globalThis.navigator?.userAgent || '', enabled = import.meta.env?.VITE_NATIVE_CAMERA_ENABLED) {
  const version = userAgent.match(/\bAndroid\s+(\d+)/i);
  return enabled !== 'false' && /\bAndroid\b/i.test(userAgent) && (!version || Number(version[1]) >= 8);
}
