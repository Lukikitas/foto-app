import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  compressImage,
  uploadFile,
  uploadPhoto,
  uploadUnidentifiedOrder,
} from './lib/uploadQueueDeps.js';
import { processStoredUploadQueue } from './lib/uploadQueueDrain.js';
import { detectOrderFromPhoto } from './lib/orderOcrServiceWorker.js';
import { keepTicketForRecovery, recoverOrderCodeInCloud } from './lib/cloudOrderRecovery.js';
import {
  UPLOAD_QUEUE_MESSAGE,
  UPLOAD_QUEUE_SYNC_TAG,
} from './lib/uploadQueueProtocol.js';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/tesseract\//, /^\/presentacion(\/|$)/, /^\/manual(\/|$)/],
  }),
);

// Heavy modules and the selected OCR core are cached only after actual use.
// A failed download is never installed as a cached response.
const RUNTIME_CACHE = 'foto-runtime-v1';
registerRoute(({ url }) => url.origin === self.location.origin &&
  (url.pathname.startsWith('/tesseract/') || (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js'))),
async ({ request }) => {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - 64))) await cache.delete(key);
  }
  return response;
});

let foregroundQueue = false;
let backgroundAbort = null;
async function drainQueue() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  foregroundQueue = windows.some(client => client.visibilityState === 'visible');
  if (foregroundQueue) return;
  backgroundAbort = new AbortController();
  return processStoredUploadQueue({
    signal: backgroundAbort.signal,
    shouldYield: () => foregroundQueue,
    detectOrderFromPhoto,
    compressImage,
    uploadFile,
    uploadPhoto,
    uploadUnidentifiedOrder,
    keepTicketForRecovery,
    recoverOrderCodeInCloud,
  });
}

self.addEventListener('message', (event) => {
  if (event.data?.type === UPLOAD_QUEUE_MESSAGE.foreground) {
    foregroundQueue = event.data.active === true;
    if (foregroundQueue) backgroundAbort?.abort();
    return;
  }
  if (event.data?.type === UPLOAD_QUEUE_MESSAGE.skipWaiting) {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === UPLOAD_QUEUE_MESSAGE.process) {
    event.waitUntil(drainQueue());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === UPLOAD_QUEUE_SYNC_TAG) {
    event.waitUntil(drainQueue());
  }
});
