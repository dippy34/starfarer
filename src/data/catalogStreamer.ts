/**
 * Streams real-catalogue tiles for one dataset.
 *
 * A few times per second the runtime LOD selection decides which octree
 * nodes could contain something visible from the camera within the point
 * budget. Missing tiles are fetched (network or persistent cache), decoded in
 * a worker and handed to the point layer; tiles that have not been wanted for
 * a while are evicted. Failed downloads back off and retry, so flaky or
 * absent connectivity only delays detail — it never breaks the app.
 */
import { type UPos, uposFromMeters } from '../core/hp';
import { platform } from '../platform';
import type { PointLayer } from '../render/pointLayer';
import type { Catalog, CatalogDataset } from './catalog';
import type { CatalogChunkData } from './decode';
import { tilePath } from './format/schema';
import { type LodNode, type LodOptions, selectNodes } from './lod';
import { JobCancelled, type WorkerPool } from './workerPool';

const MAX_PARALLEL = 5;
const EVICT_AFTER_S = 6;

interface NodeState {
  status: 'loading' | 'ready' | 'failed';
  data?: CatalogChunkData;
  lastWanted: number;
  retryAt: number;
  failures: number;
}

export class CatalogStreamer {
  /** Apparent magnitude at which the current selection stops (drives the layer's fade limit). */
  cutoffMag: number;
  loadedTiles = 0;
  pendingTiles = 0;
  loadedPoints = 0;
  private readonly states = new Map<number, NodeState>();
  private readonly tenPc: number;
  private wanted: number[] = [];
  private readonly uniformNodes = new Set<number>();
  private byPath: Map<string, LodNode> | null = null;
  private clock = 0;
  private active = 0;
  private disposed = false;
  private readonly offOnline: () => void;

  constructor(
    readonly ds: CatalogDataset,
    private readonly catalog: Catalog,
    private readonly pool: WorkerPool,
    readonly layer: PointLayer,
    magLimit: number,
    /** Brightness group of the layer this dataset's points belong to. */
    private readonly group = 0,
    /**
     * Brightness group for the tiles that sample the dataset evenly (see `LodSelection.uniform`):
     * the "survey" view that stays visible from afar. Null = no such distinction.
     */
    private readonly uniformGroup: number | null = null,
  ) {
    this.tenPc = (10 * 3.085677581491367e16) / ds.manifest.unit;
    this.cutoffMag = magLimit;
    // Coming back online: retry everything that failed, immediately.
    this.offOnline = platform.lifecycle.onOnlineChange((online) => {
      if (!online) return;
      for (const s of this.states.values()) if (s.status === 'failed') s.retryAt = 0;
    });
  }

  private groupOf(index: number): number {
    return this.uniformGroup !== null && this.uniformNodes.has(index) ? this.uniformGroup : this.group;
  }

  key(node: LodNode): string {
    return `${this.ds.manifest.id}:${node.path}`;
  }

  /** Universe position of a node's centre (the anchor its points are relative to). */
  anchor(node: LodNode): UPos {
    const u = this.ds.manifest.unit;
    return uposFromMeters(node.cx * u, node.cy * u, node.cz * u);
  }

  /** Decoded data of a loaded tile by layer key. */
  chunk(key: string): { node: LodNode; data: CatalogChunkData } | undefined {
    if (!this.byPath) {
      this.byPath = new Map();
      for (const n of this.ds.nodes) this.byPath.set(n.path, n);
    }
    const node = this.byPath.get(key.slice(this.ds.manifest.id.length + 1));
    const state = node ? this.states.get(node.index) : undefined;
    return node && state?.data ? { node, data: state.data } : undefined;
  }

  /** True when every currently wanted tile is on screen (used by the loading screen). */
  get settled(): boolean {
    return this.wanted.length > 0 && this.wanted.every((i) => this.states.get(i)?.status !== 'loading' && this.states.has(i));
  }

  /**
   * Re-evaluate the selection.
   * @param x,y,z camera position in dataset units relative to the Sun
   * @param lod   point budget and limits for this dataset (see `datasetLodOptions`)
   */
  update(x: number, y: number, z: number, dt: number, lod: Omit<LodOptions, 'tenPc'>): void {
    if (this.disposed) return;
    this.clock += dt;
    const sel = selectNodes(this.ds.nodes, x, y, z, { ...lod, tenPc: this.tenPc });
    this.wanted = sel.nodes;
    this.cutoffMag = sel.cutoffMag;
    if (this.uniformGroup !== null) {
      // Tiles move between the two groups as levels complete or the budget shrinks.
      this.uniformNodes.clear();
      for (let k = 0; k < sel.uniform; k++) this.uniformNodes.add(sel.nodes[k]!);
      for (const [i, s] of this.states) if (s.status === 'ready') this.layer.setChunkGroup(this.key(this.ds.nodes[i]!), this.groupOf(i));
    }
    for (const i of sel.nodes) {
      const s = this.states.get(i);
      if (s) s.lastWanted = this.clock;
    }
    // Start downloads, brightest (most important) first.
    for (const i of sel.nodes) {
      if (this.active >= MAX_PARALLEL) break;
      const s = this.states.get(i);
      if (!s) this.load(i);
      else if (s.status === 'failed' && this.clock >= s.retryAt) this.load(i, s.failures);
    }
    // Evict tiles nobody has asked for recently.
    for (const [i, s] of this.states) {
      if (s.status !== 'loading' && this.clock - s.lastWanted > EVICT_AFTER_S) {
        if (s.status === 'ready') {
          this.layer.removeChunk(this.key(this.ds.nodes[i]!));
          this.loadedTiles--;
          this.loadedPoints -= s.data?.count ?? 0;
        }
        this.states.delete(i);
      }
    }
    this.pendingTiles = this.active;
  }

  private load(index: number, failures = 0): void {
    const node = this.ds.nodes[index]!;
    const state: NodeState = { status: 'loading', lastWanted: this.clock, retryAt: 0, failures };
    this.states.set(index, state);
    this.active++;
    const m = this.ds.manifest;
    this.catalog
      .fetchBytes(tilePath(m.id, node.path))
      .then((bytes) => this.pool.run('tile', { kind: m.kind, specs: m.columns, bytes, cx: node.cx, cy: node.cy, cz: node.cz, half: node.half }, { priority: 2 + Math.min(1.5, node.level * 0.25), transfer: [bytes.buffer as ArrayBuffer] }).promise)
      .then((data) => {
        if (this.disposed || this.states.get(index) !== state) return; // evicted while loading
        state.status = 'ready';
        state.data = data;
        this.layer.addChunk(this.key(node), this.anchor(node), data, { group: this.groupOf(index) });
        this.loadedTiles++;
        this.loadedPoints += data.count;
      })
      .catch((err) => {
        if (err instanceof JobCancelled || this.states.get(index) !== state) return;
        state.status = 'failed';
        state.failures = failures + 1;
        // Back off: 3 s, 9 s, 27 s … capped at two minutes.
        state.retryAt = this.clock + Math.min(120, 3 ** Math.min(5, state.failures));
      })
      .finally(() => {
        this.active--;
      });
  }

  dispose(): void {
    this.disposed = true;
    this.offOnline();
    for (const [i, s] of this.states) if (s.status === 'ready') this.layer.removeChunk(this.key(this.ds.nodes[i]!), true);
    this.states.clear();
  }
}
