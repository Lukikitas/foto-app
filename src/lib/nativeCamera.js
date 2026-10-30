export const NATIVE_CAMERA_PACKAGE = 'app.deliverystar.capture';
export const NATIVE_CAMERA_DOWNLOAD_PATH = '/manual/piloto-android/';

// No installation probing or timed redirects: the browser resolves the pinned
// Android package and uses the HTTPS fallback if it cannot open the app.
export function nativeCameraLinks(origin) {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol)) throw new TypeError('Invalid web origin');
  const download = new URL(NATIVE_CAMERA_DOWNLOAD_PATH, base.origin).href;
  return {
    download,
    open: `intent://capture#Intent;scheme=deliverystar;package=${NATIVE_CAMERA_PACKAGE};S.browser_fallback_url=${encodeURIComponent(download)};end`,
  };
}

export function usesNativeCamera(userAgent = globalThis.navigator?.userAgent || '', enabled = import.meta.env?.VITE_NATIVE_CAMERA_ENABLED) {
  const version = userAgent.match(/\bAndroid\s+(\d+)/i);
  return enabled !== 'false' && /\bAndroid\b/i.test(userAgent) && (!version || Number(version[1]) >= 8);
}
