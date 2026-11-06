// Replace the former operational worker at the same URL. No fetch/sync handlers:
// future navigations use the published demo and stored captures stay untouched.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
