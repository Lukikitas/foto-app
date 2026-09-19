export const PHONE_MEDIA_QUERY = '(max-width: 1023px)';

export function isPhoneViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(PHONE_MEDIA_QUERY).matches;
}
