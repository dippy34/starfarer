/*
 * Starfarer service worker (generated at build time from this template).
 * Strategy:
 *   - app shell (HTML/JS/CSS/icons): pre-cached, cache-first, updated when the build hash changes
 *   - data tiles (./data/…): network pass-through — the app keeps its own IndexedDB tile cache,
 *     so they are not duplicated here
 */
const VERSION = '92a8668af294';
const CACHE = `starfarer-shell-${VERSION}`;
const FILES = ["./","./apple-touch-icon.png","./assets/dataWorker-Dkl19be6.js","./assets/index-5aRnW919.js","./assets/index-Bc8cf1Xv.css","./assets/three-DTGfjAnH.js","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./icon.svg","./index.html","./manifest.webmanifest"];

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
  // The shell cache holds only this build's own files, keyed by URL: ignore `Vary` (many static
  // hosts send `Vary: Origin`, and a module script's request then no longer matches the copy the
  // worker fetched for itself — which would break every offline launch) and query strings.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(event.request).catch(() =>
          // Offline navigation to an unknown URL: fall back to the app shell.
          event.request.mode === 'navigate' ? caches.match('./', { ignoreVary: true }) : Response.error(),
        ),
    ),
  );
});
