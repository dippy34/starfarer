/* Kill switch: serve this file as sw.js if sw.js ever misbehaves; it deletes every Starfarer offline cache and unregisters itself. */
const PREFIX = 'starfarer-offline-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX)) await caches.delete(name);
    }
    await self.registration.unregister();
  })());
});
