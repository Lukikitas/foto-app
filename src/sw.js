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
import { keepTicketForRecovery, recoverOrderCodeInCloud, releaseCloudTicket } from './lib/cloudOrderRecovery.js';
import {
  UPLOAD_QUEUE_MESSAGE,
  UPLOAD_QUEUE_SYNC_TAG,
} from './lib/uploadQueueProtocol.js';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/tesseract\//, /^\/presentacion(\/|$)/],
  }),
);

function drainQueue() {
  return processStoredUploadQueue({
    detectOrderFromPhoto,
    compressImage,
    uploadFile,
    uploadPhoto,
    uploadUnidentifiedOrder,
    keepTicketForRecovery,
    recoverOrderCodeInCloud,
    releaseCloudTicket,
  });
}

self.addEventListener('message', (event) => {
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
