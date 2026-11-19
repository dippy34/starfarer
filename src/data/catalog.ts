/**
 * Runtime view of the real-data catalogues: manifest, octree indices, names,
 * deep-sky objects, exoplanets, constellations and curated notes.
 *
 * Tile bytes are fetched through the platform asset service and cached in the
 * platform blob store (IndexedDB on the web) under a key that includes the
 * data build stamp, so a new catalogue build never mixes with stale tiles and
 * everything already seen keeps working offline.
 */
import { platform } from '../platform';
import type { CompanionData, ExoHostData } from '../universe/system';
import type { DatasetManifest, Manifest } from './format/schema';
import { idPath } from './format/schema';
import { type LodNode, buildNodeIndex } from './lod';
import { NamesTable } from './names';
import type { WorkerPool } from './workerPool';

/** Deep-sky object record (see scripts/build-catalogs/steps/dso.ts). */
export interface DsoRecord {
  n: string;
  t: 'oc' | 'gc' | 'pn' | 'en' | 'rn' | 'dn' | 'snr' | 'psr' | 'bh' | 'qso';
  ra: number;
  dec: number;
  d?: number;
  z?: number;
  r?: number;
  m?: number;
  x?: Record<string, string | number>;
}

export interface ConstellationRecord {
  abbr: string;
  name: string;
  english: string;
  /** Polylines of star position codes [ra, dec, dist]. */
  lines: number[][][];
}

export interface NotableData {
  starCompanions: Array<{ key: [number, number, number]; aliases: string[]; companion: CompanionData; ref: string }>;
  galaxyNotes: Array<{ key: [number, number, number]; smbhMassSun: number; jet: number; ref: string }>;
}

export interface CatalogDataset {
  manifest: DatasetManifest;
  nodes: LodNode[];
}

const codeKey = (a: number, b: number, c: number): string => `${a}_${b}_${c}`;

export class Catalog {
  readonly datasets = new Map<string, CatalogDataset>();
  names!: NamesTable;
  dso: DsoRecord[] = [];
  constellations: ConstellationRecord[] = [];
  /** Exoplanet hosts by star position-code key. */
  readonly exoHosts = new Map<string, ExoHostData>();
  readonly companions = new Map<string, NotableData['starCompanions'][number]>();
  readonly galaxyNotes = new Map<string, NotableData['galaxyNotes'][number]>();
  private readonly idCache = new Map<string, Promise<BigUint64Array>>();
  private readonly inflight = new Map<string, Promise<Uint8Array>>();

  private constructor(readonly manifest: Manifest, private readonly pool: WorkerPool) {
    for (const ds of manifest.datasets) this.datasets.set(ds.id, { manifest: ds, nodes: buildNodeIndex(ds) });
  }

  /** Cache key prefix for this data build. */
  private get stamp(): string {
    return `d${this.manifest.built}/`;
  }

  /**
   * Fetch a data file: memory de-dupe → persistent cache → network.
   * Rejects only if the file is neither cached nor reachable.
   */
  fetchBytes(path: string): Promise<Uint8Array> {
    let p = this.inflight.get(path);
    if (!p) {
      p = (async () => {
        const key = this.stamp + path;
        const cached = await platform.blobs.get(key);
        if (cached) return cached;
        const bytes = await platform.assets.fetchData(path);
        // Store a copy: the original buffer is usually transferred to a worker right after.
        void platform.blobs.put(key, bytes.slice());
        return bytes;
      })().finally(() => this.inflight.delete(path));
      this.inflight.set(path, p);
    }
    return p;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const bytes = await this.fetchBytes(path);
    return (await this.pool.run('json', { bytes }, { priority: 1, transfer: [bytes.buffer as ArrayBuffer] }).promise) as T;
  }

  /** Load the manifest (network first, cached copy when offline) and the first-launch files. */
  static async load(pool: WorkerPool, onProgress: (fraction: number, status: string) => void): Promise<Catalog> {
    onProgress(0.02, 'Reading the star charts…');
    let manifestBytes: Uint8Array;
    try {
      manifestBytes = await platform.assets.fetchData('manifest.json');
      void platform.blobs.put('manifest.json', manifestBytes.slice());
    } catch (err) {
      const cached = await platform.blobs.get('manifest.json');
      if (!cached) throw err;
      manifestBytes = cached;
    }
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
    const catalog = new Catalog(manifest, pool);
    // Drop tiles from older data builds.
    void platform.blobs.clearExcept(catalog.stamp).then(() => platform.blobs.put('manifest.json', manifestBytes.slice()));

    catalog.names = new NamesTable(manifest.names, (file) => catalog.fetchBytes(file), pool);
    const steps: Array<[string, () => Promise<void>]> = [
      ['Learning the names of the stars…', () => catalog.names.loadChunk(0)],
      ['Charting nebulae and clusters…', async () => {
        catalog.dso = await catalog.fetchJson<DsoRecord[]>(manifest.files.dso!.file);
      }],
      ['Counting other worlds…', async () => {
        const hosts = await catalog.fetchJson<ExoHostData[]>(manifest.files.exoplanets!.file);
        for (const h of hosts) catalog.exoHosts.set(codeKey(h.key[0], h.key[1], h.key[2]), h);
      }],
      ['Drawing the constellations…', async () => {
        catalog.constellations = await catalog.fetchJson<ConstellationRecord[]>(manifest.files.constellations!.file);
      }],
      ['Noting the famous places…', async () => {
        const bytes = await catalog.fetchBytes(manifest.files.notable!.file);
        const notable = JSON.parse(new TextDecoder().decode(bytes)) as NotableData;
        for (const c of notable.starCompanions) catalog.companions.set(codeKey(c.key[0], c.key[1], c.key[2]), c);
        for (const g of notable.galaxyNotes) catalog.galaxyNotes.set(codeKey(g.key[0], g.key[1], g.key[2]), g);
      }],
    ];
    let done = 0;
    await Promise.all(
      steps.map(async ([status, run]) => {
        try {
          await run();
        } catch (err) {
          // A missing optional file must not block exploring; the affected feature is simply empty.
          console.warn(`Starfarer: could not load data (${status})`, err);
        }
        done++;
        onProgress(0.05 + 0.6 * (done / steps.length), status);
      }),
    );
    return catalog;
  }

  /** Large-scale-structure file bytes (still compressed), or null if unavailable. */
  async lssBytes(): Promise<Uint8Array | null> {
    try {
      return await this.fetchBytes(this.manifest.files.lss!.file);
    } catch {
      return null;
    }
  }

  exoHost(ra: number, dec: number, dist: number): ExoHostData | undefined {
    return this.exoHosts.get(codeKey(ra, dec, dist));
  }

  companion(ra: number, dec: number, dist: number): CompanionData | undefined {
    return this.companions.get(codeKey(ra, dec, dist))?.companion;
  }

  galaxyNote(ra: number, dec: number, z: number): NotableData['galaxyNotes'][number] | undefined {
    return this.galaxyNotes.get(codeKey(ra, dec, z));
  }

  /** 64-bit catalogue ids of a star tile (lazy, cached; rejects when offline and never fetched). */
  ids(datasetId: string, path: string): Promise<BigUint64Array> {
    const key = `${datasetId}:${path}`;
    let p = this.idCache.get(key);
    if (!p) {
      p = this.fetchBytes(idPath(datasetId, path)).then((bytes) => this.pool.run('ids', { bytes }, { priority: 1, transfer: [bytes.buffer as ArrayBuffer] }).promise);
      p.catch(() => this.idCache.delete(key));
      if (this.idCache.size > 24) this.idCache.delete(this.idCache.keys().next().value as string);
      this.idCache.set(key, p);
    }
    return p;
  }
}
