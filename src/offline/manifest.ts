export interface OfflineFile {
  path: string;
  size: number;
  hash: string;
}

export interface OfflineManifest {
  version: string;
  files: readonly OfflineFile[];
  totalBytes: number;
}

/** Make the build's sorted file list. A path occurs once; the total is measured from its files. */
export function makeOfflineManifest(files: readonly OfflineFile[], version: string): OfflineManifest {
  const sorted = [...files].sort((a, b) => compareStrings(a.path, b.path));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].path === sorted[i].path) throw new Error(`duplicate offline file: ${sorted[i].path}`);
  }
  return { version, files: sorted, totalBytes: sorted.reduce((n, file) => n + file.size, 0) };
}

/**
 * The browser suite's deliberately small copy. It has the app, its ordinary startup data and every
 * Earth/Moon map, not the other worlds, close-up pyramids or deep catalogues. `loadedPaths` also keeps
 * exactly what this already-open view asked for (including workers' entries visible to the browser).
 */
export function earthMoonOfflineManifest(full: OfflineManifest, loadedPaths: readonly string[]): OfflineManifest {
  const loaded = new Set(loadedPaths);
  const files = full.files.filter((file) => {
    const p = file.path;
    return !p.includes('/') || p.startsWith('assets/') || loaded.has(p)
      || p.startsWith('data/solar/') || p.startsWith('data/stars/') || p.startsWith('data/ephem/')
      || p.startsWith('data/sky/') || p.startsWith('data/materials/')
      || /^data\/(?:exoplanets|blackholes|galaxies|deepsky|spacecraft)\.json$/.test(p)
      || /^data\/textures\/(?:manifest|thumbs)\.json$/.test(p) || p === 'data/textures/thumbs.jpg'
      || /^data\/textures\/(?:earth_|moon)/.test(p)
      || /^data\/terrain\/(?:terrain\.json|earth\.png|moon\.png)$/.test(p)
      || p === 'data/elevation/index.json' || /^data\/elevation\/(?:earth|moon)\/manifest\.json$/.test(p);
  });
  return makeOfflineManifest(files, `${full.version}-earth-moon`);
}

export interface OfflineDiff {
  reuse: OfflineFile[];
  download: OfflineFile[];
  remove: string[];
  downloadBytes: number;
}

/**
 * Compare a previous offline manifest against the next one.
 *
 * A file is reused when the same path exists in both manifests with an
 * identical content hash; otherwise (new path or changed hash) it must be
 * downloaded. Paths only present in the previous manifest are removed.
 *
 * Neither input is mutated. `totalBytes` on the inputs is ignored.
 */
export function diffOfflineManifests(
  previous: OfflineManifest | null,
  next: OfflineManifest,
): OfflineDiff {
  const previousByPath = new Map<string, OfflineFile>();
  if (previous !== null) {
    for (const file of previous.files) {
      previousByPath.set(file.path, file);
    }
  }

  const nextByPath = new Map<string, OfflineFile>();
  for (const file of next.files) {
    nextByPath.set(file.path, file);
  }

  const reuse: OfflineFile[] = [];
  const download: OfflineFile[] = [];

  for (const file of next.files) {
    const before = previousByPath.get(file.path);
    if (before !== undefined && before.hash === file.hash) {
      reuse.push(file);
    } else {
      download.push(file);
    }
  }

  const remove: string[] = [];
  for (const file of previous !== null ? previous.files : []) {
    if (!nextByPath.has(file.path)) {
      remove.push(file.path);
    }
  }

  reuse.sort(byPath);
  download.sort(byPath);
  remove.sort(compareStrings);

  let downloadBytes = 0;
  for (const file of download) {
    downloadBytes += file.size;
  }

  return { reuse, download, remove, downloadBytes };
}

function byPath(a: OfflineFile, b: OfflineFile): number {
  return compareStrings(a.path, b.path);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
