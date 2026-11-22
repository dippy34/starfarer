import { AdditiveBlending, type DataTexture, Group, Points, ShaderMaterial, Vector3 } from 'three';
import { teffToLut } from '../astro/photometry';
import { LY, PC, SUN_ABS_MAG } from '../core/units';
import { formatRaDec } from '../core/frames';
import { extinction, GALAXY } from '../universe/Galaxy';
import { BANDS, cellSize, generateCell, reach, spectralLabel, type StarCell } from '../universe/ProceduralStars';
import { CatalogStar } from '../universe/Stars';
import { BAND_LIGHT, dustBetween, F_LOG0, F_N, F_STEP, galaxyForWorker, generateGalaxyCell, INTERIOR, interiorFrame } from './GalaxyInterior';
import { smooth } from './GalaxiesLayer';
import { STAR_FRAG } from './StarField';
import { CHUNK, POOL_VERT, type PoolHandle, StarPool } from './StarPool';

const ABS_MIN = -12;
const ABS_STEP = 0.125;
/** generated cells kept in memory */
const MAX_CELLS = 4000;
/** stars resident on the GPU (one draw call): a headset's budget, and a desktop's */
export const STAR_BUDGET = { vr: 150_000, desktop: 450_000 };
/**
 * A cell's stars go to the pool out to this multiple of its band's reach from the eye: the shader
 * fades out every star beyond the reach, so the rest would only take room. (Inside a giant
 * elliptical every cell of the bright bands holds the most a cell may, spread over a kiloparsec or
 * more: sent whole, a few of them filled the pool with stars out of reach and starved the cells
 * round the eye.) The stars sent are chosen again once the eye or the reach has moved out of the
 * margin.
 */
const MARGIN = 1.25;
/** stars looked through per frame to send cells again (theirs no longer cover the reach), as a share of the pool */
const REFRESH = 1 / 4;

interface Entry {
  cell: StarCell;
  /** galaxy index for cells inside other galaxies (-1: the Milky Way) */
  gi: number;
  /** where its stars sit in the pool (null: none sent, or none within the radius) */
  handle: PoolHandle | null;
  /** packed magnitude and colour per star (kept to re-add after an eviction from the pool) */
  mt: Uint16Array | null;
  /** farthest star from the cell centre (pc) */
  rmax: number;
  /**
   * The stars in the pool: those within `rad` pc of the eye position `at` (ICRF heliocentric pc);
   * `whole`: all of the cell's (then `rad` reaches its farthest star). rad 0: nothing sent yet.
   * `reachAt`: the band's reach (pc) when they were chosen.
   */
  at: Vector3;
  rad: number;
  whole: boolean;
  reachAt: number;
  /** visual extinction (mag) from the eye to the cell, and where the eye was when it was computed */
  ext: number;
  extAt: Vector3 | null;
  lastUsed: number;
}

/** a wanted cell: band, indices, distance (pc) from the eye to its box, and that distance over the band's reach */
interface Want { k: number; ix: number; iy: number; iz: number; d: number; q: number; gi: number }

/**
 * Cells in the order they are asked for and given room in the pool: by the distance from the eye
 * over the band's reach, which is the brightest one of its stars can look (a cell the eye is in
 * first, in every band; brighter bands first among equals). Sorted by band first, the brightest
 * bands' cells, however far, came before any faint band's: inside a dense galaxy they took the
 * whole pool.
 */
export const wantOrder = (a: Want, b: Want) => a.q - b.q || a.k - b.k;

/**
 * Indices of the stars of `c` within `rad` pc of the point (rx, ry, rz) from its centre (ICRF pc),
 * written to `out`; returns how many.
 */
export function starsWithin(c: StarCell, rx: number, ry: number, rz: number, rad: number, out: Uint32Array): number {
  const r2 = rad * rad, p = c.pos;
  let n = 0;
  for (let i = 0; i < c.count; i++) {
    const x = p[i * 3] - rx, y = p[i * 3 + 1] - ry, z = p[i * 3 + 2] - rz;
    if (x * x + y * y + z * z <= r2) out[n++] = i;
  }
  return n;
}

/** A star generated from the galaxy model (no catalogue entry). */
export class ProceduralStar extends CatalogStar {
  /** `home`: the galaxy it belongs to (null: the Milky Way) */
  constructor(key: string, posPc: Vector3, absMag: number, teff: number, spect: string, name: string, readonly home: string | null = null) {
    super(key, posPc, absMag, teff, spect, [name], null);
    this.exact = true;
  }

  override info(): [string, string][] {
    const rows: [string, string][] = [['Type', this.home ? `Star in the ${this.home} (generated from its model)` : 'Star (generated from the Milky Way model)']];
    if (this.spect) rows.push(['Spectral class', this.spect]);
    rows.push(['Temperature', `${Math.round(this.teff).toLocaleString()} K`]);
    rows.push(['Absolute mag (V)', this.absMag.toFixed(2)]);
    rows.push(['Luminosity (V)', `${Math.pow(10, -0.4 * (this.absMag - SUN_ABS_MAG)).toPrecision(3)} L☉`]);
    rows.push(['Radius', `${(this.radius / 695_700e3).toPrecision(3)} R☉ (estimated)`]);
    const d = this.posPc.length();
    rows.push(['Distance from Sun', d > 3000 ? `${(d / 1000).toFixed(2)} kpc (${((d * PC) / LY / 1000).toFixed(1)} thousand ly)` : `${d.toFixed(0)} pc (${((d * PC) / LY).toFixed(0)} ly)`]);
    rows.push(['RA / Dec (from Sun)', formatRaDec(this.posPc)]);
    if (this.home) rows.push(['Galaxy', this.home]);
    rows.push(['Origin', 'procedural: stars like it are there, this one is invented']);
    return rows;
  }
}

/**
 * Draws the procedural stars (universe/ProceduralStars.ts) around the explorer: for every
 * magnitude band, the cells close enough for their stars to reach the limiting magnitude are
 * generated (those whose stars can look brightest first, within a time budget) and drawn with the
 * catalogue star shader, dimmed by the model's dust between the eye and the cell. Of each cell,
 * the stars within its band's reach of the eye (and a margin) are in the pool.
 */
export class ProceduralStarLayer {
  readonly group = new Group();
  enabled = true;
  /** cells drawn this frame */
  readonly visible: Entry[] = [];
  private entries = new Map<string, Entry>();
  readonly pool: StarPool;
  private points: Points;
  /**
   * The magnitude the stars are generated to: the limiting magnitude, or brighter while the
   * point budget is short (faint bands then thin out first, their light left to the volume).
   */
  mGen = 10;
  /** how far (mag) the point budget holds the generation magnitude above the limiting magnitude */
  private cut = 0;
  /** the point budget was over last frame (the cut rising) */
  private raising = false;
  private frame = 0;
  private stars = new Map<string, ProceduralStar>();
  pending = 0;
  /** cells being generated by the workers */
  private inflight = new Set<string>();
  private workers: Worker[] = [];
  private nextWorker = 0;
  /** workers generating cells inside other galaxies (started when first needed) */
  private gworkers: Worker[] = [];

  constructor(psf: Record<string, { value: number }>, colorLut: DataTexture, vr = false) {
    this.group.name = 'procedural-stars';
    const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../workers/stars.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => this.receive(ev.data);
      this.workers.push(w);
    }
    this.pool = new StarPool(vr ? STAR_BUDGET.vr : STAR_BUDGET.desktop);
    const mat = new ShaderMaterial({
      name: 'procedural-stars', vertexShader: POOL_VERT, fragmentShader: STAR_FRAG,
      uniforms: {
        ...psf, uOffset: { value: new Vector3() }, uScale: { value: 1 }, uAbsMin: { value: ABS_MIN }, uAbsStep: { value: ABS_STEP },
        uHideRadius: { value: 0 }, uExtinction: { value: 0 }, uColorLut: { value: colorLut }, uSlots: { value: this.pool.slots },
      },
      transparent: true, depthWrite: false, depthTest: true, blending: AdditiveBlending,
    });
    this.points = new Points(this.pool.geometry, mat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.name = 'procedural-stars';
    this.group.add(this.points);
  }

  /** the stars' packed magnitude and colour */
  private pack(c: StarCell): Uint16Array {
    const mt = new Uint16Array(c.count);
    for (let i = 0; i < c.count; i++) {
      const a = Math.max(0, Math.min(255, Math.round((c.absMag[i] - ABS_MIN) / ABS_STEP)));
      const t = Math.round(teffToLut(c.teff[i]) * 255);
      mt[i] = a | (t << 8);
    }
    return mt;
  }

  /** scratch for the stars of a cell sent in part */
  private sel = new Uint32Array(0);
  private selPos = new Float32Array(0);
  private selMt = new Uint16Array(0);

  /**
   * Put the stars of an entry within MARGIN times its band's reach `R` of the eye in the pool (all
   * of them when the cell lies within that), in place of those it had there, evicting cells unused
   * this frame if needed. False when there is no room: what it had stays.
   */
  private place(e: Entry, cam: Vector3, R: number): boolean {
    const c = e.cell, mtAll = e.mt;
    if (!mtAll) { e.at.copy(cam); e.rad = Infinity; e.whole = true; return true; }
    const ox = cam.x - c.centre.x, oy = cam.y - c.centre.y, oz = cam.z - c.centre.z;
    const extent = Math.hypot(ox, oy, oz) + e.rmax;
    let rad = MARGIN * R, whole = extent <= rad;
    let pos = c.pos, mt = mtAll, n = c.count;
    if (!whole) {
      if (this.sel.length < c.count) {
        this.sel = new Uint32Array(c.count);
        this.selPos = new Float32Array(c.count * 3);
        this.selMt = new Uint16Array(c.count);
      }
      n = starsWithin(c, ox, oy, oz, rad, this.sel);
      // (in as many chunks of the pool as the whole cell: the whole cell, never sent again)
      if (Math.ceil(n / CHUNK) >= Math.ceil(c.count / CHUNK)) { whole = true; n = c.count; } else {
        for (let j = 0; j < n; j++) {
          const i = this.sel[j];
          this.selPos[j * 3] = c.pos[i * 3]; this.selPos[j * 3 + 1] = c.pos[i * 3 + 1]; this.selPos[j * 3 + 2] = c.pos[i * 3 + 2];
          this.selMt[j] = mtAll[i];
        }
        pos = this.selPos; mt = this.selMt;
      }
    }
    if (whole) rad = extent;
    const have = e.handle ? e.handle.chunks.length * CHUNK : 0;
    if (this.pool.freeStars + have < n) {
      // (once nothing more can be freed this frame, the rest wait)
      if (this.noRoom === this.frame) return false;
      this.free(n - have);
      if (this.pool.freeStars + have < n) { this.noRoom = this.frame; return false; }
    }
    if (e.handle) this.pool.remove(e.handle);
    e.handle = n ? this.pool.add(pos, mt, n) : null;
    // (out of slots: nothing of it is in the pool now)
    if (n && !e.handle) { e.rad = 0; return false; }
    e.at.copy(cam);
    e.rad = rad;
    e.whole = whole;
    e.reachAt = R;
    return true;
  }

  /**
   * Whether the stars of a placed entry need choosing again: they no longer hold every star within
   * the reach `R` of the eye (it moved, or the reach grew); or, with the pool short of room
   * (`tight`), the reach has shrunk by the margin since they were chosen.
   */
  private stale(e: Entry, cam: Vector3, R: number, tight: boolean): boolean {
    if (e.rad === Infinity) return false;
    if (!e.whole && e.at.distanceTo(cam) + R > e.rad) return true;
    // (a cell in one chunk takes no less room for being sent in part)
    return tight && MARGIN * R < e.reachAt && !!e.handle && e.handle.chunks.length > 1;
  }

  private noRoom = -1;
  /** free room for `n` stars: cells not drawn this frame, least recently used first */
  private free(n: number): void {
    const old = [...this.entries.values()].filter((x) => x.handle && x.lastUsed < this.frame).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const x of old) {
      if (this.pool.freeStars >= n) break;
      this.pool.remove(x.handle!);
      x.handle = null;
      // (sent again when next wanted)
      x.rad = 0;
    }
  }

  private receive(d: { gi?: number; key: string; band: number; ix: number; iy: number; iz: number; size: number; count: number; centre: number[];
    pos: Float32Array; absMag: Float32Array; teff: Float32Array; cls: Uint8Array }): void {
    this.inflight.delete(d.key);
    const cell: StarCell = { ...d, centre: new Vector3(d.centre[0], d.centre[1], d.centre[2]) };
    let r2 = 0;
    for (let i = 0; i < cell.count; i++) r2 = Math.max(r2, cell.pos[i * 3] ** 2 + cell.pos[i * 3 + 1] ** 2 + cell.pos[i * 3 + 2] ** 2);
    const e: Entry = { cell, gi: d.gi ?? -1, handle: null, mt: cell.count ? this.pack(cell) : null, rmax: Math.sqrt(r2),
      at: new Vector3(), rad: 0, whole: false, reachAt: 0, ext: 0, extAt: null, lastUsed: this.frame };
    this.entries.set(d.key, e);
  }

  /** `camPc` ICRF heliocentric pc; `mLim` current limiting magnitude; `hidePc` near-star radius. */
  update(camPc: Vector3, mLim: number, hidePc: number, maxRequests = 6): void {
    this.frame++;
    for (const e of this.visible) if (e.handle) this.pool.hide(e.handle.slot);
    this.visible.length = 0;
    this.points.visible = this.enabled;
    if (!this.enabled) { INTERIOR.active = null; return; }
    // the point budget: generate to a brighter magnitude while the pool is (nearly) full
    const mTop = mLim + 0.3;
    const mGen = (this.mGen = mTop - this.cut);
    const reachK = BANDS.map((b) => reach(b.M, mGen));
    const camGal = GALAXY.toGal(camPc);
    const want: Want[] = [];
    // (far outside the Milky Way its model holds no stars)
    if (camGal.length() < 60000) for (let k = 0; k < BANDS.length; k++) {
      const R = reachK[k];
      const S = cellSize(k);
      const lo = [camGal.x - R, camGal.y - R, camGal.z - R].map((v) => Math.floor(v / S));
      const hi = [camGal.x + R, camGal.y + R, camGal.z + R].map((v) => Math.floor(v / S));
      for (let ix = lo[0]; ix <= hi[0]; ix++) for (let iy = lo[1]; iy <= hi[1]; iy++) for (let iz = lo[2]; iz <= hi[2]; iz++) {
        // distance from the eye to the cell box
        const dx = Math.max(ix * S - camGal.x, 0, camGal.x - (ix + 1) * S);
        const dy = Math.max(iy * S - camGal.y, 0, camGal.y - (iy + 1) * S);
        const dz = Math.max(iz * S - camGal.z, 0, camGal.z - (iz + 1) * S);
        const d = Math.hypot(dx, dy, dz);
        if (d <= R) want.push({ k, ix, iy, iz, d, q: d / R, gi: -1 });
      }
    }
    const inside = this.galaxyCells(camPc, reachK, want);
    want.sort(wantOrder);
    const wanted = new Float32Array(BANDS.length), ready = new Float32Array(BANDS.length);
    let extBudget = 40, starved = 0;
    // stars that may be looked through this frame to send cells again; while the pool is over
    // budget, cells holding far more than their reach give the room back
    let refresh = REFRESH * this.pool.capacity;
    const tight = this.raising;
    this.pending = 0;
    const g = new Vector3();
    const dA = new Vector3(), dB = new Vector3();
    const keyOf = (w: Want) => (w.gi >= 0 ? `g${w.gi}:${w.k}:${w.ix}:${w.iy}:${w.iz}` : `${w.k}:${w.ix}:${w.iy}:${w.iz}`);
    // (cells still wanted are never evicted to make room for others: the budget shrinks instead)
    for (const w of want) { const e = this.entries.get(keyOf(w)); if (e) e.lastUsed = this.frame; }
    for (const w of want) {
      const key = keyOf(w);
      if (w.gi >= 0) wanted[w.k]++;
      const e = this.entries.get(key);
      if (!e) {
        // the cells whose stars can look brightest come first in `want`; keep a few in flight per worker
        this.pending++;
        const pool = w.gi >= 0 ? this.galaxyWorkers() : this.workers;
        if (!this.inflight.has(key) && this.inflight.size < pool.length * maxRequests) {
          this.inflight.add(key);
          pool[this.nextWorker++ % pool.length].postMessage({ gi: w.gi, k: w.k, ix: w.ix, iy: w.iy, iz: w.iz });
        }
        continue;
      }
      e.lastUsed = this.frame;
      const R = reachK[w.k];
      if (e.rad === 0) {
        if (!this.place(e, camPc, R)) { starved++; continue; }
      } else if (refresh > 0 && this.stale(e, camPc, R, tight)) {
        // (without room to send them again, the stars it has stay)
        refresh -= Math.max(e.cell.count, CHUNK);
        if (!this.place(e, camPc, R)) starved++;
      }
      if (w.gi >= 0) ready[w.k]++;
      if (!e.handle) continue;
      // dust towards the cell, refreshed when the eye has moved a few percent of the distance
      const toCell = e.cell.centre.distanceTo(camPc);
      if ((!e.extAt || e.extAt.distanceTo(camPc) > 0.03 * toCell + 1) && extBudget-- > 0) {
        if (e.gi >= 0) {
          const fr = interiorFrame(e.gi);
          e.ext = fr ? 1.086 * dustBetween(fr.model, fr.toDisc(camPc, dA), fr.toDisc(e.cell.centre, dB)) : 0;
        } else e.ext = extinction(camGal, GALAXY.toGal(e.cell.centre, g), 16);
        e.extAt = camPc.clone();
      }
      // stars of another galaxy fade in as the explorer enters it
      const fadeIn = e.gi >= 0 && inside ? -2.5 * Math.log10(Math.max(inside.w, 1e-4)) : 0;
      const c = e.cell.centre;
      this.pool.show(e.handle.slot, c.x - camPc.x, c.y - camPc.y, c.z - camPc.z, e.ext + fadeIn, reachK[w.k]);
      this.visible.push(e);
    }
    (this.points.material as ShaderMaterial).uniforms.uHideRadius.value = hidePc;
    this.pool.commit();
    if (this.entries.size > MAX_CELLS) this.evict();
    // over budget (cells waiting for room, or the pool nearly full): bring the faint end in;
    // with room to spare, let it back out towards the limiting magnitude. The room counted is what
    // the cells wanted here take: cells kept from elsewhere give theirs up as soon as it is needed
    // (counted, the stars of the last galaxy visited held the cut wherever the eye went next).
    let held = 0;
    for (const e of this.visible) held += e.handle!.chunks.length * CHUNK;
    const fill = held / this.pool.capacity;
    this.raising = starved > 0 || fill > 0.92 || want.length > MAX_CELLS * 0.8;
    if (this.raising) this.cut = Math.min(6, this.cut + 0.05);
    else if (fill < 0.75 && this.pending < 8 && want.length < MAX_CELLS * 0.7) this.cut = Math.max(0, this.cut - 0.02);
    // the share of the galaxy's light carried by the stars drawn, by distance from the eye: bands
    // drawn out to their reach, counted as far as their cells are ready
    if (inside) {
      const F = new Float32Array(F_N);
      for (let j = 0; j < F_N; j++) {
        const d = 10 ** (F_LOG0 + j * F_STEP);
        let f = 0;
        for (let k = 0; k < BANDS.length; k++) if (wanted[k] > 0) f += BAND_LIGHT[k] * (ready[k] / wanted[k]) * (1 - smooth(0.8 * reachK[k], reachK[k], d));
        F[j] = Math.min(1, f) * inside.w;
      }
      INTERIOR.active = { gi: inside.gi, w: inside.w, F };
    } else INTERIOR.active = null;
  }

  private gSent = 0;
  private galaxyWorkers(): Worker[] {
    // galaxies added since (catalogue picks) are sent before any request for them
    if (this.gworkers.length && INTERIOR.galaxies.length > this.gSent) {
      const add = INTERIOR.galaxies.slice(this.gSent).map((g, j) => ({ gi: this.gSent + j, g: galaxyForWorker(g) }));
      for (const w of this.gworkers) w.postMessage({ add });
      this.gSent = INTERIOR.galaxies.length;
    }
    if (!this.gworkers.length) {
      this.gSent = INTERIOR.galaxies.length;
      const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
      // (as placed here, not as catalogued: M87 sits on its black hole)
      const galaxies = INTERIOR.galaxies.map(galaxyForWorker);
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('../workers/galaxyStars.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (ev) => this.receive(ev.data);
        w.postMessage({ galaxies });
        this.gworkers.push(w);
      }
    }
    return this.gworkers;
  }

  /**
   * Inside (or close to) another galaxy: its cells within each band's reach, in its disc frame and
   * within its box. Returns the galaxy and how far its stars have faded in (from 1.6 to 1.1 radii).
   */
  private galaxyCells(camPc: Vector3, reachK: number[], want: Want[]): { gi: number; w: number } | null {
    let gi = -1, best = Infinity;
    const rel = new Vector3();
    INTERIOR.galaxies.forEach((g, i) => {
      const k = rel.copy(g.upos.toVector3()).multiplyScalar(1 / PC).sub(camPc).length() / (g.radius / PC);
      if (k < best) { best = k; gi = i; }
    });
    if (gi < 0 || best > 1.6) return null;
    const fr = interiorFrame(gi);
    if (!fr) return null;
    const w = smooth(1.6, 1.1, best);
    const cam = fr.toDisc(camPc).multiplyScalar(fr.rpc);      // disc frame, pc
    const e = fr.model.ext;
    const half = Math.max(e.x, e.y, e.z) * fr.rpc;
    const halfZ = (fr.model.look.disc ? Math.max(e.x, e.y, e.z) : e.z) * fr.rpc;
    for (let k = 0; k < BANDS.length; k++) {
      const R = reachK[k];
      const S = cellSize(k);
      const lo = [Math.max(cam.x - R, -half), Math.max(cam.y - R, -half), Math.max(cam.z - R, -halfZ)].map((v) => Math.floor(v / S));
      const hi = [Math.min(cam.x + R, half), Math.min(cam.y + R, half), Math.min(cam.z + R, halfZ)].map((v) => Math.floor(v / S));
      for (let ix = lo[0]; ix <= hi[0]; ix++) for (let iy = lo[1]; iy <= hi[1]; iy++) for (let iz = lo[2]; iz <= hi[2]; iz++) {
        const dx = Math.max(ix * S - cam.x, 0, cam.x - (ix + 1) * S);
        const dy = Math.max(iy * S - cam.y, 0, cam.y - (iy + 1) * S);
        const dz = Math.max(iz * S - cam.z, 0, cam.z - (iz + 1) * S);
        const d = Math.hypot(dx, dy, dz);
        if (d <= R) want.push({ k, ix, iy, iz, d, q: d / R, gi });
      }
    }
    return { gi, w };
  }

  private evict(): void {
    const old = [...this.entries.values()].filter((e) => e.lastUsed < this.frame).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of old.slice(0, this.entries.size - MAX_CELLS * 0.8)) {
      if (e.handle) this.pool.remove(e.handle);
      this.entries.delete(e.cell.key);
    }
  }

  get drawnStars(): number {
    return this.visible.reduce((s, e) => s + (e.handle ? e.handle.count : 0), 0);
  }

  /**
   * Diagnostics (after `update`, from the same eye): the stars of the cells wanted this frame within
   * their band's reach of `camPc`, all of which a whole cell would have had in the pool, and how
   * many of them are in it. (Looks through every star of those cells: not for every frame.)
   */
  reachStats(camPc: Vector3): { inReach: number; inPool: number } {
    let inReach = 0, inPool = 0;
    for (const e of this.entries.values()) {
      if (e.lastUsed !== this.frame) continue;
      const c = e.cell, R = reach(BANDS[c.band].M, this.mGen), r2 = e.whole ? Infinity : e.rad * e.rad;
      for (let i = 0; i < c.count; i++) {
        const x = c.centre.x + c.pos[i * 3], y = c.centre.y + c.pos[i * 3 + 1], z = c.centre.z + c.pos[i * 3 + 2];
        if ((x - camPc.x) ** 2 + (y - camPc.y) ** 2 + (z - camPc.z) ** 2 >= R * R) continue;
        inReach++;
        if (e.handle && (x - e.at.x) ** 2 + (y - e.at.y) ** 2 + (z - e.at.z) ** 2 <= r2) inPool++;
      }
    }
    return { inReach, inPool };
  }

  /**
   * Visit the stars currently drawn and brighter than `mLim` from `camPc`: `fn(relPc, mag, star)`
   * with the camera-relative position (pc) and apparent magnitude; `star()` makes the object.
   */
  forEachVisible(camPc: Vector3, mLim: number, fn: (relPc: Vector3, mag: number, star: () => ProceduralStar) => void): void {
    const rel = new Vector3();
    for (const e of this.visible) {
      const c = e.cell;
      const R = reach(BANDS[c.band].M, this.mGen);
      // (only the stars in the pool are drawn)
      const ax = e.at.x - c.centre.x, ay = e.at.y - c.centre.y, az = e.at.z - c.centre.z, r2 = e.whole ? Infinity : e.rad * e.rad;
      for (let i = 0; i < c.count; i++) {
        if (r2 < Infinity && (c.pos[i * 3] - ax) ** 2 + (c.pos[i * 3 + 1] - ay) ** 2 + (c.pos[i * 3 + 2] - az) ** 2 > r2) continue;
        rel.set(c.centre.x + c.pos[i * 3] - camPc.x, c.centre.y + c.pos[i * 3 + 1] - camPc.y, c.centre.z + c.pos[i * 3 + 2] - camPc.z);
        const d = rel.length();
        if (d >= R) continue;
        // (as drawn: fading out towards the band's reach)
        const m = c.absMag[i] + 5 * Math.log10(Math.max(d, 1e-9)) - 5 + e.ext - 2.5 * Math.log10(Math.max(1 - smooth(0.8 * R, R, d), 1e-4));
        if (m > mLim) continue;
        fn(rel, m, () => this.star(c, i));
      }
    }
  }

  /** Stars within `radiusPc` of `camPc` (for the near-star renderer), nearest first. */
  nearest(camPc: Vector3, radiusPc: number, max = 8): { star: ProceduralStar; dist: number }[] {
    const out: { star: ProceduralStar; dist: number }[] = [];
    const rel = new Vector3();
    for (const e of this.visible) {
      const c = e.cell;
      if (c.centre.distanceTo(camPc) > c.size + radiusPc) continue;
      for (let i = 0; i < c.count; i++) {
        rel.set(c.centre.x + c.pos[i * 3] - camPc.x, c.centre.y + c.pos[i * 3 + 1] - camPc.y, c.centre.z + c.pos[i * 3 + 2] - camPc.z);
        const d = rel.length();
        if (d < radiusPc) out.push({ star: this.star(c, i), dist: d });
      }
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, max);
  }

  /** The selectable object for star `i` of `cell` (one object per star). */
  star(c: StarCell, i: number): ProceduralStar {
    const key = `ps:${c.key}:${i}`;
    let s = this.stars.get(key);
    if (!s) {
      const p = new Vector3(c.centre.x + c.pos[i * 3], c.centre.y + c.pos[i * 3 + 1], c.centre.z + c.pos[i * 3 + 2]);
      const gm = /^g(\d+):/.exec(c.key);
      const home = gm ? INTERIOR.galaxies[Number(gm[1])]?.name ?? null : null;
      s = new ProceduralStar(key, p, c.absMag[i], c.teff[i], spectralLabel(c, i), designation(c, i), home);
      if (this.stars.size > 5000) this.stars.clear();
      this.stars.set(key, s);
    }
    return s;
  }

  /** Look a star up by its designation (e.g. "PS 9.41.-3.0-17"). */
  find(name: string): ProceduralStar | null {
    const gm = /^ps\s*g(\d+)\.(\d+)\.(-?\d+)\.(-?\d+)\.(-?\d+)-(\d+)$/i.exec(name.trim());
    if (gm) {
      const [gi, k, ix, iy, iz, i] = gm.slice(1).map(Number);
      const fr = k < BANDS.length ? interiorFrame(gi) : null;
      if (!fr) return null;
      const c = this.entries.get(`g${gi}:${k}:${ix}:${iy}:${iz}`)?.cell ?? generateGalaxyCell(fr, k, ix, iy, iz);
      return i < c.count ? this.star(c, i) : null;
    }
    const m = /^ps\s*(\d+)\.(-?\d+)\.(-?\d+)\.(-?\d+)-(\d+)$/i.exec(name.trim());
    if (!m) return null;
    const [k, ix, iy, iz, i] = m.slice(1).map(Number);
    if (k >= BANDS.length) return null;
    const c = this.entries.get(`${k}:${ix}:${iy}:${iz}`)?.cell ?? generateCell(k, ix, iy, iz);
    return i < c.count ? this.star(c, i) : null;
  }
}

/** Designation encoding the cell and index, so the star can be found again. */
export function designation(c: StarCell, i: number): string {
  const gm = /^g(\d+):/.exec(c.key);
  return gm ? `PS G${gm[1]}.${c.band}.${c.ix}.${c.iy}.${c.iz}-${i}` : `PS ${c.band}.${c.ix}.${c.iy}.${c.iz}-${i}`;
}
