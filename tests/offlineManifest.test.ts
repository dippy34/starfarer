import { describe, expect, it } from 'vitest';
import { diffOfflineManifests, earthMoonOfflineManifest, makeOfflineManifest, type OfflineFile, type OfflineManifest } from '../src/offline/manifest';

/** A small manifest from literal files. */
function manifest(files: OfflineFile[]): OfflineManifest {
  return { version: 'v1', files, totalBytes: 0 };
}

describe('offline manifest diff', () => {
  it('with no previous manifest every next file is downloaded, and a changed pair reuses, downloads, and removes', () => {
    expect(diffOfflineManifests(null, manifest([
      { path: 'b.png', size: 30, hash: 'hb' },
      { path: 'a.png', size: 10, hash: 'ha' },
    ]))).toEqual({
      reuse: [],
      download: [
        { path: 'a.png', size: 10, hash: 'ha' },
        { path: 'b.png', size: 30, hash: 'hb' },
      ],
      remove: [],
      downloadBytes: 40,
    });

    const unchanged = { path: 'kept.png', size: 4, hash: 'h1' };
    const changedBefore = { path: 'changed.png', size: 5, hash: 'h2-old' };
    const changedAfter = { path: 'changed.png', size: 7, hash: 'h2-new' };
    const removed = { path: 'gone.png', size: 9, hash: 'h3' };
    const added = { path: 'new.png', size: 6, hash: 'h4' };

    expect(diffOfflineManifests(
      manifest([unchanged, changedBefore, removed]),
      manifest([added, changedAfter, unchanged]),
    )).toEqual({
      reuse: [unchanged],
      download: [changedAfter, added],
      remove: ['gone.png'],
      downloadBytes: 13,
    });
  });
});

describe('the built offline file list', () => {
  it('sorts paths, measures the real total, rejects duplicates, and keeps only the Earth–Moon test copy', () => {
    const files = [
      { path: 'data/textures/moon.jpg', size: 20, hash: 'm' },
      { path: 'assets/app.js', size: 5, hash: 'a' },
      { path: 'index.html', size: 2, hash: 'i' },
    ];
    const built = makeOfflineManifest(files, 'v1');
    expect(built.files.map((f) => f.path)).toEqual(['assets/app.js', 'data/textures/moon.jpg', 'index.html']);
    expect(built.totalBytes).toBe(27);
    expect(files.map((f) => f.path)).toEqual(['data/textures/moon.jpg', 'assets/app.js', 'index.html']);
    expect(() => makeOfflineManifest([...files, files[0]], 'v1')).toThrow('duplicate offline file');

    const full = makeOfflineManifest([
      ...files,
      { path: 'data/stars/index.json', size: 3, hash: 's' },
      { path: 'data/textures/mars.jpg', size: 50, hash: 'x' },
      { path: 'data/custom/view.bin', size: 7, hash: 'c' },
    ], 'v1');
    const small = earthMoonOfflineManifest(full, ['data/custom/view.bin']);
    expect(small.files.map((f) => f.path)).toEqual([
      'assets/app.js', 'data/custom/view.bin', 'data/stars/index.json', 'data/textures/moon.jpg', 'index.html',
    ]);
    expect(small.totalBytes).toBe(37);
    expect(small.version).toBe('v1-earth-moon');
  });
});
