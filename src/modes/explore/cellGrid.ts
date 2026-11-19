/**
 * Generic manager for procedural level-of-detail cells (star blocks of a
 * galaxy, cosmic-web cells of the universe).
 *
 * Each level is a cubic grid with its own cell size and its own "interest
 * radius" around the camera. The manager keeps the cells that touch every
 * level's sphere of interest generated (in a worker) and in the point layer,
 * and drops cells that fall out of range. Results are pure functions of the
 * cell coordinates, so nothing is cached to disk — leaving and coming back
 * regenerates identical cells.
 *
 * All cells of a level share one point-layer batch, i.e. one draw call per
 * level however many cells are loaded.
 */
import type { UPos } from '../../core/hp';
import type { PointChunkData } from '../../data/decode';
import { JobCancelled, type JobHandle } from '../../data/workerPool';
import type { BatchOptions, PointLayer } from '../../render/pointLayer';

export interface CellLevel {
  /** Identifies the level (and anything else that changes its cells, e.g. a block size) in keys and host callbacks. */
  id: number;
  /** Cell edge length in grid units. */
  size: number;
  /** Interest radius around the camera in grid units. */
  radius: number;
}

export interface CellResult<T> {
  chunk: PointChunkData;
  /** Generator-specific per-cell data kept for picking (seeds, indices…). */
  extra: T;
}

export interface CellGridHost<T> {
  /** Prefix of point-layer keys, unique per grid. */
  prefix: string;
  /** Start generating a cell. Return null to skip it without a job (known to be empty). */
  request(id: number, ix: number, iy: number, iz: number): JobHandle<CellResult<T>> | null;
  /** Universe position of a cell's centre. */
  anchor(id: number, ix: number, iy: number, iz: number): UPos;
  /** Point-layer settings shared by a level's cells. */
  options(id: number): BatchOptions;
}

interface Cell<T> {
  key: string;
  id: number;
  ix: number;
  iy: number;
  iz: number;
  job: JobHandle<CellResult<T>> | null;
  extra: T | null;
  count: number;
  wanted: boolean;
}

/** Hard cap on cells per level, to bound work whatever radius is requested. */
const MAX_CELLS_PER_LEVEL = 260;

export class CellGrid<T> {
  private readonly cells = new Map<string, Cell<T>>();
  private readonly batches = new Set<number>();
  /** Jobs in flight. */
  pending = 0;

  constructor(private readonly host: CellGridHost<T>, private readonly layer: PointLayer) {}

  key(id: number, ix: number, iy: number, iz: number): string {
    return `${this.host.prefix}${id}:${ix}:${iy}:${iz}`;
  }

  private batchId(id: number): string {
    return `${this.host.prefix}${id}`;
  }

  /** Per-cell data for a layer key (for picking), if that cell is loaded. */
  cell(key: string): { id: number; ix: number; iy: number; iz: number; extra: T } | undefined {
    const c = this.cells.get(key);
    return c && c.extra ? { id: c.id, ix: c.ix, iy: c.iy, iz: c.iz, extra: c.extra } : undefined;
  }

  owns(key: string): boolean {
    return key.startsWith(this.host.prefix);
  }

  /** Points of this grid currently on the GPU. */
  get points(): number {
    let n = 0;
    for (const id of this.batches) n += this.layer.batchCount(this.batchId(id));
    return n;
  }

  /**
   * Bring the loaded cells in line with the camera position (grid units, relative to the grid origin).
   * Call a few times per second.
   */
  update(levels: readonly CellLevel[], cx: number, cy: number, cz: number): void {
    for (const c of this.cells.values()) c.wanted = false;
    const live = new Set<number>();
    for (const { id, size, radius } of levels) {
      if (radius <= 0) continue;
      live.add(id);
      this.batches.add(id);
      this.layer.configureBatch(this.batchId(id), this.host.options(id));
      // Shrink the radius if it would cover an unreasonable number of cells.
      const maxR = size * (Math.cbrt((MAX_CELLS_PER_LEVEL * 3) / (4 * Math.PI)) - 0.87);
      const r = Math.min(radius, Math.max(size * 0.5, maxR));
      const x0 = Math.floor((cx - r) / size);
      const x1 = Math.floor((cx + r) / size);
      const y0 = Math.floor((cy - r) / size);
      const y1 = Math.floor((cy + r) / size);
      const z0 = Math.floor((cz - r) / size);
      const z1 = Math.floor((cz + r) / size);
      for (let iz = z0; iz <= z1; iz++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let ix = x0; ix <= x1; ix++) {
            // Keep cells whose cube intersects the sphere of interest.
            const dx = Math.max(ix * size - cx, 0, cx - (ix + 1) * size);
            const dy = Math.max(iy * size - cy, 0, cy - (iy + 1) * size);
            const dz = Math.max(iz * size - cz, 0, cz - (iz + 1) * size);
            if (dx * dx + dy * dy + dz * dz > r * r) continue;
            const key = this.key(id, ix, iy, iz);
            const existing = this.cells.get(key);
            if (existing) {
              existing.wanted = true;
              continue;
            }
            this.start(key, id, ix, iy, iz);
          }
        }
      }
    }
    // Drop cells that fell out of range (they are beyond the fade distance, so nothing pops).
    for (const c of [...this.cells.values()]) {
      if (c.wanted) continue;
      c.job?.cancel();
      if (c.count > 0) this.layer.removeChunk(c.key);
      this.cells.delete(c.key);
    }
    // Retire the batches of levels that are no longer in use.
    for (const id of [...this.batches]) {
      if (live.has(id)) continue;
      this.layer.removeBatch(this.batchId(id));
      this.batches.delete(id);
    }
  }

  private start(key: string, id: number, ix: number, iy: number, iz: number): void {
    const cell: Cell<T> = { key, id, ix, iy, iz, job: null, extra: null, count: 0, wanted: true };
    this.cells.set(key, cell);
    const job = this.host.request(id, ix, iy, iz);
    if (!job) return; // known-empty cell: remembered so it is not re-tested every update
    cell.job = job;
    this.pending++;
    job.promise
      .then((result) => {
        if (this.cells.get(key) !== cell) return; // dropped while generating
        cell.extra = result.extra;
        cell.count = result.chunk.count;
        if (result.chunk.count > 0) this.layer.addChunk(key, this.host.anchor(id, ix, iy, iz), result.chunk, { batch: this.batchId(id) });
      })
      .catch((err) => {
        if (!(err instanceof JobCancelled)) console.warn('Starfarer: cell generation failed', key, err);
        if (this.cells.get(key) === cell) this.cells.delete(key);
      })
      .finally(() => {
        cell.job = null;
        this.pending--;
      });
  }

  /** Remove everything (e.g. when leaving a galaxy). */
  clear(): void {
    for (const c of this.cells.values()) c.job?.cancel();
    this.cells.clear();
    for (const id of this.batches) this.layer.removeBatch(this.batchId(id));
    this.batches.clear();
  }
}
