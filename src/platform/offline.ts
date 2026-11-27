import { diffOfflineManifests, earthMoonOfflineManifest, type OfflineManifest } from '../offline/manifest';

const PREFIX = 'starfarer-offline-';
const CONTROL = `${PREFIX}control`;
const FULL_LIST = 'offline-manifest.json';
const COPY_LIST = 'offline-copy.json';
/** A few bytes (version and size), so More need not fetch the 1.5 MB full list before anyone opts in. */
const SIZE_LIST = 'offline-size.json';
/** One download at a time across tabs: two would delete each other's staging cache. */
const LOCK = `${PREFIX}download`;
const TRIES = 3;

type ActiveCopy = { version: string; cacheName: string };

export interface OfflineSnapshot {
  version: string;
  totalBytes: number;
  /** A stopped download of this version that Download carries on from. */
  partial: { bytes: number; totalBytes: number } | null;
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

type ErrorKind = 'busy' | 'unsupported' | 'network' | 'quota' | 'other';

/** An error whose kind is known. Only `busy` and `unsupported` carry words meant for people. */
export class OfflineError extends Error {
  constructor(readonly kind: ErrorKind, message: string) { super(message); }
}

function errorKind(error: unknown): ErrorKind {
  if (error instanceof OfflineError) return error.kind;
  const e = error as { name?: string; message?: string } | null;
  if (e?.name === 'QuotaExceededError' || /quota/i.test(e?.message ?? '')) return 'quota';
  if (error instanceof TypeError || e?.name === 'AbortError' || e?.name === 'NetworkError' || e?.name === 'TimeoutError') return 'network';
  return 'other';
}

/** Plain words for a failed download. Never the raw error. */
export function offlineErrorWords(error: unknown): string {
  const kind = errorKind(error);
  if ((kind === 'busy' || kind === 'unsupported') && error instanceof OfflineError) return error.message;
  if (kind === 'quota') return 'Not enough room on this device for the offline copy.';
  if (kind === 'network') return 'The download stopped (no connection?). Download again to carry on.';
  return 'The offline copy could not be made.';
}

const base = () => new URL('./', location.href);
const urlFor = (path: string, network = false) => {
  const url = new URL(path, base());
  if (network) url.searchParams.set('__starfarer_offline_network', '1');
  return url.href;
};

async function response(cacheName: string, path: string): Promise<Response | null> {
  return await caches.match(urlFor(path), { cacheName }) ?? null;
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

/** This build's version and size. Without a copy it reads a few bytes, never the full list. */
async function currentBuild(active: ActiveCopy | null): Promise<{ version: string; totalBytes: number }> {
  const kept = async () => {
    const full = active ? await cachedManifest(active.cacheName, FULL_LIST) : null;
    if (!full) return null;
    const { version, totalBytes } = selectedManifest(full);
    return { version, totalBytes };
  };
  if (active && navigator.onLine === false) {
    const found = await kept();
    if (found) return found;
  }
  try {
    const res = await fetch(urlFor(SIZE_LIST, true), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const size = await res.json() as { version?: unknown; totalBytes?: unknown };
    if (typeof size.version !== 'string' || typeof size.totalBytes !== 'number') throw new Error('The size list is unreadable.');
    return { version: testCopyRequested() ? `${size.version}-earth-moon` : size.version, totalBytes: size.totalBytes };
  } catch (error) {
    const found = await kept();
    if (found) return found;
    throw error;
  }
}

const stagingNames = (version: string) => [`${PREFIX}v-${version}`, `${PREFIX}v-${version}-repair`];

/** A stopped download of this version: what its staging cache already holds. */
async function stoppedCopy(version: string, activeName: string | null): Promise<{ name: string; bytes: number; totalBytes: number } | null> {
  const names = await caches.keys();
  for (const name of stagingNames(version)) {
    if (!names.includes(name) || name === activeName) continue;
    if (await response(name, COPY_LIST)) continue;
    const full = await cachedManifest(name, FULL_LIST);
    if (!full) continue;
    const manifest = selectedManifest(full);
    const have = new Set((await (await caches.open(name)).keys()).map((request) => request.url));
    let bytes = 0;
    for (const file of manifest.files) if (have.has(urlFor(file.path))) bytes += file.size;
    return { name, bytes, totalBytes: manifest.totalBytes };
  }
  return null;
}

/** What a stopped download holds now (after a failure), for the panel. */
export async function partialOfflineCopy(version: string): Promise<OfflineSnapshot['partial']> {
  if (!('caches' in globalThis)) return null;
  const found = await stoppedCopy(version, (await activeCopy())?.cacheName ?? null);
  return found ? { bytes: found.bytes, totalBytes: found.totalBytes } : null;
}

/**
 * Ask this site's worker, if one exists, to delete finished copies no tab uses. With `keepStaging`
 * it also deletes every stopped download not listed. It never creates a worker or a cache.
 */
async function askWorkerToPrune(keepStaging?: string[]): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration(base().href);
    if (registration?.active) await tellWorker(registration, { type: 'prune', keepStaging });
  } catch { /* the next page load tries again */ }
}

/** When a page loads: an update's old copy goes once no tab uses it. */
export function pruneOfflineCopies(): Promise<void> {
  return askWorkerToPrune();
}

/** The offer in More. Reading it never registers a worker or creates a cache. */
export async function offlineSnapshot(): Promise<OfflineSnapshot> {
  const active = await activeCopy();
  const build = await currentBuild(active);
  const current = active ? await cachedManifest(active.cacheName, COPY_LIST) : null;
  const stopped = 'caches' in globalThis ? await stoppedCopy(build.version, active?.cacheName ?? null) : null;
  void askWorkerToPrune(stopped ? [stopped.name] : []);
  const [estimate, persistent] = await Promise.all([storageEstimate(), persistenceGranted()]);
  return {
    version: build.version,
    totalBytes: build.totalBytes,
    partial: stopped ? { bytes: stopped.bytes, totalBytes: stopped.totalBytes } : null,
    activeVersion: current?.version ?? null,
    ready: !!active && current?.version === build.version,
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

async function tellWorker(registration: ServiceWorkerRegistration, message: { type: 'activate' | 'reset' | 'prune'; version?: string; cacheName?: string; keepStaging?: string[] }): Promise<void> {
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
  if (!res.ok) throw new OfflineError(res.status >= 500 || res.status === 408 || res.status === 429 ? 'network' : 'other', `${file.path}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== file.size || hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.hash) throw new OfflineError('other', `${file.path} did not match its content hash.`);
  // Fetch has already decoded content-encoding; keep only the type, not stale encoding/length headers.
  await cache.put(urlFor(file.path), new Response(bytes, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream' } }));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Download only new/changed files, copy unchanged ones from the active version, verify every new
 * file's bytes, then atomically point future navigations at the completed cache. Existing tabs stay
 * on their own version. A file that keeps failing stops the download, but what was fetched stays in
 * the staging cache: Download again fetches only what it lacks. One tab at a time (a Web Lock).
 */
export async function downloadOfflineCopy(onProgress: (progress: OfflineProgress) => void): Promise<OfflineDownloaded> {
  if (!('caches' in globalThis)) throw new OfflineError('unsupported', 'This browser does not support offline copies.');
  // (every browser that keeps a copy has Web Locks: Safari from 15.4. One without them cannot tell whether another tab
  // downloads, and asking to try again could never help)
  if (!navigator.locks) throw new OfflineError('unsupported', 'This browser is too old to keep an offline copy.');
  const done = await navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => lock ? downloadLocked(onProgress) : null);
  if (!done) throw new OfflineError('busy', 'Another tab is downloading the offline copy. Wait for it to finish, then try again.');
  return done;
}

async function downloadLocked(onProgress: (progress: OfflineProgress) => void): Promise<OfflineDownloaded> {
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
  // A stopped download's staging cache is kept: files already in it are not fetched again.
  const cache = await caches.open(cacheName);
  const have = new Set((await cache.keys()).map((request) => request.url));
  // The full list in the staging cache is how a stopped download is found and measured later.
  if (!have.has(urlFor(FULL_LIST))) await cache.put(urlFor(FULL_LIST), new Response(JSON.stringify(full), { headers: { 'Content-Type': 'application/json' } }));
  const oldCache = active ? await caches.open(active.cacheName) : null;
  const diff = diffOfflineManifests(previous, manifest);
  const progress: OfflineProgress = {
    completedFiles: 0, totalFiles: manifest.files.length,
    completedBytes: 0, totalBytes: manifest.totalBytes,
    networkBytes: 0, networkTotalBytes: 0,
  };
  const todo: { file: OfflineManifest['files'][number]; copy: boolean }[] = [];
  for (const [files, copy] of [[diff.reuse, true], [diff.download, false]] as const) {
    for (const file of files) {
      if (have.has(urlFor(file.path))) { progress.completedFiles++; progress.completedBytes += file.size; }
      else { todo.push({ file, copy }); if (!copy) progress.networkTotalBytes += file.size; }
    }
  }
  onProgress({ ...progress });
  // Fetch one file; it is retried after a short wait. A file copied from the old version needs no network.
  const fetchOne = async (task: (typeof todo)[number]): Promise<boolean> => {
    const found = task.copy && oldCache ? await oldCache.match(urlFor(task.file.path)) : null;
    if (found) { await cache.put(urlFor(task.file.path), found); return false; }
    await downloadFile(cache, task.file);
    return true;
  };
  let cursor = 0;
  let failed = false;
  let firstError: unknown = null;
  const loop = async () => {
    while (!failed && cursor < todo.length) {
      const task = todo[cursor++];
      try {
        let network = false;
        for (let tries = 1; ; tries++) {
          try { network = await fetchOne(task); break; } catch (error) {
            if (failed || tries >= TRIES || errorKind(error) === 'quota') throw error;
            await wait(500 * tries);
          }
        }
        if (network) { if (task.copy) progress.networkTotalBytes += task.file.size; progress.networkBytes += task.file.size; }
        progress.completedFiles++;
        progress.completedBytes += task.file.size;
        onProgress({ ...progress });
      } catch (error) {
        if (!failed) { failed = true; firstError = error; }
        return;
      }
    }
  };
  // Every loop settles before anything else touches the cache.
  await Promise.allSettled(Array.from({ length: 6 }, loop));
  if (failed) throw firstError;
  try {
    await cache.put(urlFor(COPY_LIST), new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
    await tellWorker(registration, { type: 'activate', version: manifest.version, cacheName });
  } catch (error) {
    // A message reply can be lost after the worker has already switched.
    const now = await activeCopy();
    if (now?.cacheName === cacheName && now.version === manifest.version) return { version: manifest.version, persistent, progress: { ...progress } };
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
  if (!('caches' in globalThis)) return;
  // A request the old worker was still answering can open (and so create again, empty) a cache just deleted: what
  // comes back is deleted again, a few times over a second (the offline suite saw one left behind, 27 Nov 2026)
  for (let tries = 0; tries < 6; tries++) {
    const left = (await caches.keys()).filter((name) => name.startsWith(PREFIX));
    if (!left.length && tries > 0) return;
    await Promise.all(left.map((name) => caches.delete(name)));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
