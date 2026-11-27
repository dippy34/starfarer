/* Starfarer's offline copy. Nothing is cached at install: the page asks for a copy, downloads and
 * verifies a staging cache, then sends "activate". A tab stays on one version until it reloads. */
const PREFIX = 'starfarer-offline-';
const CONTROL = `${PREFIX}control`;
let active = null;
let activeRead = null;
const pinned = new Map();

const controlUrl = () => new URL('__starfarer_offline_active__', self.registration.scope).href;
const pinUrl = (clientId) => new URL(`__starfarer_offline_pin_${clientId}`, self.registration.scope).href;

async function putPin(clientId, cacheName) {
  if (!clientId || pinned.get(clientId) === cacheName) return;
  if (!active) return;
  pinned.set(clientId, cacheName);
  const control = await caches.open(CONTROL);
  await control.put(pinUrl(clientId), new Response(cacheName));
}

async function getPin(clientId) {
  if (!clientId) return null;
  if (pinned.has(clientId)) return pinned.get(clientId);
  const response = await caches.match(pinUrl(clientId), { cacheName: CONTROL });
  const cacheName = response ? await response.text() : null;
  if (cacheName) pinned.set(clientId, cacheName);
  return cacheName;
}

const LOCK = 'starfarer-offline-download';
const copyUrl = () => new URL('offline-copy.json', self.registration.scope).href;

/**
 * Completed versions no open tab uses can go. A stopped download has no manifest until it is
 * complete; it goes only when the page lists the staging caches to keep (`keepStaging`). While a tab
 * downloads (it holds the Web Lock) nothing is pruned, unless the downloader itself asks (`locked`).
 */
async function prune(current, options = {}) {
  const run = async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const keep = new Set([current]);
    for (const client of windows) keep.add(await getPin(client.id));
    for (const name of await caches.keys()) {
      if (!name.startsWith(`${PREFIX}v-`) || keep.has(name)) continue;
      // (looked up, not opened: opening creates a cache, and Remove may have just deleted this one)
      const complete = !!(await caches.match(copyUrl(), { cacheName: name }));
      if (complete || (options.keepStaging && !options.keepStaging.includes(name))) await caches.delete(name);
    }
  };
  if (options.locked || !self.navigator.locks) return run();
  return self.navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => (lock ? run() : undefined));
}

let startPruned = false;
/** The first event after the worker starts also clears what an update left behind. */
function pruneOnStart(event) {
  if (startPruned) return;
  startPruned = true;
  event.waitUntil(readActive().then((current) => current && prune(current.cacheName)).catch(() => undefined));
}

async function readActive() {
  if (active) return active;
  if (!activeRead) {
    activeRead = (async () => {
      // Cache Storage creates on open. After Remove, this unregistered worker may still serve an
      // already-open tab until its next navigation; even then it must not recreate an empty cache.
      const response = await caches.match(controlUrl(), { cacheName: CONTROL });
      active = response ? await response.json() : null;
      return active;
    })();
  }
  return activeRead;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim().then(() => readActive()).then((current) => current && prune(current.cacheName)).catch(() => undefined));
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !event.ports[0]) return;
  pruneOnStart(event);
  const work = (async () => {
    try {
      if (data.type === 'activate') {
        const cache = await caches.open(data.cacheName);
        const complete = await cache.match(copyUrl());
        if (!complete || typeof data.version !== 'string' || !data.cacheName.startsWith(`${PREFIX}v-`)) throw new Error('The offline copy is incomplete.');
        const before = await readActive();
        // Existing documents keep the version their code came from. Only their next navigation moves.
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) if (!await getPin(client.id)) await putPin(client.id, before?.cacheName ?? data.cacheName);
        const next = { version: data.version, cacheName: data.cacheName };
        const control = await caches.open(CONTROL);
        await control.put(controlUrl(), new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json' } }));
        active = next;
        activeRead = Promise.resolve(next);
        await prune(next.cacheName, { locked: true });
        event.ports[0].postMessage({ ok: true });
      } else if (data.type === 'prune') {
        const current = await readActive();
        await prune(current?.cacheName ?? null, { keepStaging: Array.isArray(data.keepStaging) ? data.keepStaging : undefined });
        event.ports[0].postMessage({ ok: true });
      } else if (data.type === 'reset') {
        await caches.delete(CONTROL);
        active = null;
        activeRead = null;
        pinned.clear();
        event.ports[0].postMessage({ ok: true });
      } else {
        throw new Error('Unknown offline message.');
      }
    } catch (error) {
      event.ports[0].postMessage({ ok: false, error: String(error) });
    }
  })();
  event.waitUntil(work);
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // The download manager's own requests must not be answered from the old version it is replacing.
  pruneOnStart(event);
  if (url.searchParams.has('__starfarer_offline_network')) { event.respondWith(fetch(request)); return; }
  event.respondWith((async () => {
    const current = await readActive();
    if (!current) return fetch(request);
    const navigating = request.mode === 'navigate';
    const clientId = event.resultingClientId || event.clientId;
    const cacheName = navigating ? current.cacheName : await getPin(event.clientId) ?? current.cacheName;
    await putPin(clientId, cacheName);
    const wanted = navigating ? new URL('index.html', self.registration.scope).href : request.url;
    // (looked up, not opened: a request still under way when Remove deleted the copy must not create it again empty)
    const cached = await caches.match(wanted, { cacheName, ignoreSearch: true });
    // An incomplete or test-limited copy never invents a fallback: it goes to the network, and an
    // actual missing offline file therefore remains visible to the app and to the browser check.
    return cached ?? fetch(request);
  })());
});
