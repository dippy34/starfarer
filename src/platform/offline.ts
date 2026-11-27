import { diffOfflineManifests, earthMoonOfflineManifest, type OfflineManifest } from '../offline/manifest';

const PREFIX = 'starfarer-offline-';
const CONTROL = `${PREFIX}control`;
const FULL_LIST = 'offline-manifest.json';
const COPY_LIST = 'offline-copy.json';

type ActiveCopy = { version: string; cacheName: string };

export interface OfflineSnapshot {
  manifest: OfflineManifest;
  activeVersion: string | null;
  ready: boolean;
  persistent: boolean | null;
  estimate: { usage?: number; quota?: number; available?: number };
  testCopy: boolean;
}

export interface OfflineProgress {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
  totalBytes: number;
  networkBytes: number;
  networkTotalBytes: number;
}

export interface OfflineDownloaded {
  version: string;
  persistent: boolean | null;
  progress: OfflineProgress;
}

const base = () => new URL('./', location.href);
const urlFor = (path: string, network = false) => {
  const url = new URL(path, base());
  if (network) url.searchParams.set('__starfarer_offline_network', '1');
  return url.href;
};

async function response(cacheName: string, path: string): Promise<Response | null> {
  if (!(await caches.keys()).includes(cacheName)) return null;
  const cache = await caches.open(cacheName);
  return await cache.match(urlFor(path)) ?? null;
}

async function activeCopy(): Promise<ActiveCopy | null> {
  const found = await response(CONTROL, '__starfarer_offline_active__');
  if (!found) return null;
  try {
    const value = await found.json() as ActiveCopy;
    return typeof value.version === 'string' && typeof value.cacheName === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function cachedManifest(cacheName: string, path: string): Promise<OfflineManifest | null> {
  const found = await response(cacheName, path);
  if (!found) return null;
  try {
    return await found.json() as OfflineManifest;
  } catch {
    return null;
  }
}

async function fetchFullManifest(active: ActiveCopy | null): Promise<OfflineManifest> {
  if (active && navigator.onLine === false) {
    const cached = await cachedManifest(active.cacheName, FULL_LIST);
    if (cached) return cached;
  }
  try {
    const res = await fetch(urlFor(FULL_LIST, true), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as OfflineManifest;
  } catch (error) {
    // With no network, the active copy still has the full build list (not just a test copy's subset).
    const cached = active ? await cachedManifest(active.cacheName, FULL_LIST) : null;
    if (cached) return cached;
    throw error;
  }
}

function testCopyRequested(): boolean {
  return new URLSearchParams(location.search).get('offlineTest') === 'earth-moon';
}

function selectedManifest(full: OfflineManifest): OfflineManifest {
  if (!testCopyRequested()) return full;
  const root = base();
  const loaded: string[] = [];
  for (const entry of performance.getEntriesByType('resource')) {
    if (!entry.name.startsWith(root.href)) continue;
    const path = new URL(entry.name).pathname.slice(root.pathname.length);
    try { loaded.push(decodeURIComponent(path)); } catch { loaded.push(path); }
  }
  return earthMoonOfflineManifest(full, loaded);
}

async function storageEstimate(): Promise<OfflineSnapshot['estimate']> {
  try {
    const e = await navigator.storage?.estimate();
    return { usage: e?.usage, quota: e?.quota, available: e?.quota !== undefined && e.usage !== undefined ? Math.max(0, e.quota - e.usage) : undefined };
  } catch {
    return {};
  }
}

async function persistenceGranted(): Promise<boolean | null> {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { return null; }
}

/** The offer in More. Reading it never registers a worker or creates a cache. */
export async function offlineSnapshot(): Promise<OfflineSnapshot> {
  const active = await activeCopy();
  const full = await fetchFullManifest(active);
  const manifest = selectedManifest(full);
  const current = active ? await cachedManifest(active.cacheName, COPY_LIST) : null;
  const [estimate, persistent] = await Promise.all([storageEstimate(), persistenceGranted()]);
  return {
    manifest,
    activeVersion: current?.version ?? null,
    ready: !!active && current?.version === manifest.version,
    persistent,
    estimate,
    testCopy: testCopyRequested(),
  };
}

async function workerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!navigator.serviceWorker) throw new Error('This browser does not support offline copies.');
  const scope = base().href;
  let registration = await navigator.serviceWorker.getRegistration(scope);
  if (registration) await registration.update();
  else registration = await navigator.serviceWorker.register(urlFor('sw.js'), { scope });
  const ready = await navigator.serviceWorker.ready;
  return ready.scope === scope ? ready : registration;
}

async function tellWorker(registration: ServiceWorkerRegistration, message: { type: 'activate' | 'reset'; version?: string; cacheName?: string }): Promise<void> {
  const worker = registration.active ?? (await navigator.serviceWorker.ready).active;
  if (!worker) throw new Error('The offline worker is not ready yet. Try again.');
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('The offline worker did not answer. Try again.')), 30000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data?.ok) resolve();
      else reject(new Error(event.data?.error ?? 'The offline worker could not finish.'));
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function hex(hash: ArrayBuffer): string {
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function downloadFile(cache: Cache, file: OfflineManifest['files'][number]): Promise<void> {
  const res = await fetch(urlFor(file.path, true), { cache: 'reload' });
  if (!res.ok) throw new Error(`${file.path}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== file.size || hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.hash) throw new Error(`${file.path} did not match its content hash.`);
  // Fetch has already decoded content-encoding; keep only the type, not stale encoding/length headers.
  await cache.put(urlFor(file.path), new Response(bytes, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }));
}

/**
 * Download only new/changed files, copy unchanged ones from the active version, verify every new
 * file's bytes, then atomically point future navigations at the completed cache. Existing tabs stay
 * on their own version. A failed staging copy is deleted and the old copy remains active.
 */
export async function downloadOfflineCopy(onProgress: (progress: OfflineProgress) => void): Promise<OfflineDownloaded> {
  if (!('caches' in globalThis)) throw new Error('This browser does not support offline copies.');
  let persistent: boolean | null = null;
  try { persistent = navigator.storage?.persist ? await navigator.storage.persist() : null; } catch { persistent = false; }
  const active = await activeCopy();
  const full = await fetchFullManifest(active);
  const manifest = selectedManifest(full);
  const previous = active ? await cachedManifest(active.cacheName, COPY_LIST) : null;
  const registration = await workerRegistration();
  const wantedName = `${PREFIX}v-${manifest.version}`;
  const cacheName = active?.cacheName === wantedName ? `${wantedName}-repair` : wantedName;
  if (active?.version === manifest.version && previous?.version === manifest.version) {
    const progress = { completedFiles: manifest.files.length, totalFiles: manifest.files.length, completedBytes: manifest.totalBytes, totalBytes: manifest.totalBytes, networkBytes: 0, networkTotalBytes: 0 };
    onProgress(progress);
    return { version: manifest.version, persistent, progress };
  }
  if (active?.cacheName !== cacheName) await caches.delete(cacheName);
  const cache = await caches.open(cacheName);
  const oldCache = active ? await caches.open(active.cacheName) : null;
  const diff = diffOfflineManifests(previous, manifest);
  const progress: OfflineProgress = {
    completedFiles: 0, totalFiles: manifest.files.length,
    completedBytes: 0, totalBytes: manifest.totalBytes,
    networkBytes: 0, networkTotalBytes: diff.downloadBytes,
  };
  onProgress(progress);
  let cursor = 0;
  const tasks = [
    ...diff.reuse.map((file) => ({ file, copy: true })),
    ...diff.download.map((file) => ({ file, copy: false })),
  ];
  try {
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        if (task.copy && oldCache) {
          const found = await oldCache.match(urlFor(task.file.path));
          if (found) await cache.put(urlFor(task.file.path), found);
          else { progress.networkTotalBytes += task.file.size; await downloadFile(cache, task.file); progress.networkBytes += task.file.size; }
        } else {
          await downloadFile(cache, task.file);
          progress.networkBytes += task.file.size;
        }
        progress.completedFiles++;
        progress.completedBytes += task.file.size;
        onProgress({ ...progress });
      }
    }));
    // The full list supports later updates; this internal list is what the worker checks as complete.
    await cache.put(urlFor(FULL_LIST), new Response(JSON.stringify(full), { headers: { 'Content-Type': 'application/json' } }));
    await cache.put(urlFor(COPY_LIST), new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
    await tellWorker(registration, { type: 'activate', version: manifest.version, cacheName });
  } catch (error) {
    // A message reply can be lost after the worker has already switched. Never delete that active copy.
    const now = await activeCopy();
    if (now?.cacheName === cacheName && now.version === manifest.version) return { version: manifest.version, persistent, progress: { ...progress } };
    await caches.delete(cacheName);
    throw error;
  }
  return { version: manifest.version, persistent, progress: { ...progress } };
}

/** Unregister this site's worker and delete active, previous, control and incomplete offline caches. */
export async function removeOfflineCopy(): Promise<void> {
  const scope = base().href;
  if (navigator.serviceWorker) {
    for (const registration of await navigator.serviceWorker.getRegistrations()) {
      if (registration.scope !== scope) continue;
      try { await tellWorker(registration, { type: 'reset' }); } catch { /* deletion below still removes the copy */ }
      await registration.unregister();
    }
  }
  if ('caches' in globalThis) await Promise.all((await caches.keys()).filter((name) => name.startsWith(PREFIX)).map((name) => caches.delete(name)));
}
