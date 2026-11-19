/*
 * Starfarer service worker (generated at build time from this template).
 * Strategy:
 *   - app shell (HTML/JS/CSS/icons): pre-cached, cache-first, updated when the build hash changes
 *   - data tiles (./data/…): network pass-through — the app keeps its own IndexedDB tile cache,
 *     so they are not duplicated here
 */
const VERSION = '__VERSION__';
const CACHE = `starfarer-shell-${VERSION}`;
const FILES = "__FILES__";

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('starfarer-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/data/')) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(event.request).catch(() =>
          // Offline navigation to an unknown URL: fall back to the app shell.
          event.request.mode === 'navigate' ? caches.match('./') : Response.error(),
        ),
    ),
  );
});
