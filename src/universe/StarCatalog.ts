import { Vector3 } from 'three';
import { lutToTeff } from '../astro/photometry';
import { PC } from '../core/units';

/**
 * Streaming star catalogue (AT-HYG v4.0 + Gaia DR3 100 pc) stored as a
 * brightest-first octree (see pipeline/build_stars.py). Each frame the
 * camera position and the current limiting magnitude decide which nodes are
 * needed; a node is needed exactly when one of its stars could be brighter
 * than the limit as seen from the camera.
 */
export interface StarNode {
  id: number;
  parent: number;
  depth: number;
  center: [number, number, number]; // pc
  half: number; // pc
  count: number;
  magMin: number;
  magMax: number;
  subMag: number;
  enc: 'u' | 'f';
  children: number[];
  // runtime
  state: 'none' | 'loading' | 'ready' | 'error';
  /** u16: normalised in node cube; f32: pc relative to centre */
  pos: Uint16Array | Float32Array | null;
  /** absMag code | teff code << 8 */
  mt: Uint16Array | null;
  absMag: Float32Array | null;
  lastNeeded: number;
  /** stars to draw this frame (prefix of the brightness-sorted list) */
  drawCount: number;
  /** min distance camera -> node cube (pc) this frame */
  dmin: number;
  cpuPos: Float64Array | null;
  ids: Uint32Array | null;
  idsState: 'none' | 'loading' | 'ready';
  /** how good each star's distance is (`grade`), fetched with its designation when it is chosen */
  quality?: Promise<Uint8Array | null>;
  /** where each star's temperature comes from (`teffSource`), fetched when one of them is made */
  teffSrc?: Promise<Uint8Array | null>;
  /** Gaia's temperatures for some of its stars (slot, K), with Gaia's data: fetched with the node */
  gaiaTeff?: Promise<Uint8Array | null>;
}

/**
 * How far a star's distance can be trusted (pipeline/build_distance_quality.py): its parallax at
 * least five times its error (`good`), less (`poor`, with the parallax and its error in mas), or the
 * distance from Hipparcos alone, beyond 500 pc (`hipFar`); `ungraded` where no grade was made.
 */
export type DistanceGrade = { grade: 'good' | 'ungraded' | 'hipFar' } | { grade: 'poor'; parallaxMas: number; errorMas: number };
const GRADES = ['ungraded', 'good', 'poor', 'hipFar'] as const;

/** A star's grade from its node's quality file (2 bits a star, then each poor star's parallax and error in µas). */
export function readGrade(q: Uint8Array, count: number, slot: number): DistanceGrade {
  const at = (s: number) => (q[s >> 2] >> (2 * (s & 3))) & 3;
  const g = GRADES[at(slot)];
  if (g !== 'poor') return { grade: g };
  let rank = 0;
  for (let s = 0; s < slot; s++) if (at(s) === 2) rank++;
  const v = new DataView(q.buffer, q.byteOffset + ((count + 3) >> 2) + 4 * rank, 4);
  return { grade: 'poor', parallaxMas: v.getInt16(0, true) / 1000, errorMas: v.getUint16(2, true) / 1000 };
}

/**
 * Where a star's temperature comes from (pipeline/build_star_teff.py): its colour (B-V); the usual
 * colour of its spectral class (its own not known); its spectral type, on Pecaut & Mamajek's scale
 * for dwarfs (2013), Martins, Schaerer & Hillier's for O giants and supergiants (2005) or Crowther,
 * Lennon & Walborn's for early B supergiants (2006); or Gaia DR3's analysis of hot stars' spectra
 * (ESP-HS). `flagged`: its catalogue type matches neither its colour nor its brightness, and is not
 * used; `reddened`: its type is used though dust has reddened its colour by `ebv`, E(B-V);
 * `dwarfScale`: the dwarfs' scale for a giant or supergiant, for want of one for its class;
 * `redder`: its colour is redder than its type, which may be dust or a wrong type (its colour kept);
 * `composite`: its type is of a composite spectrum, two stars'.
 */
export interface TeffSource {
  source: 'colour' | 'classColour' | 'dwarfs' | 'martins' | 'crowther' | 'gaia';
  flagged: boolean; reddened: boolean; dwarfScale: boolean; redder: boolean; composite: boolean;
  ebv: number;
  /** Gaia's temperature (K), where it is the one used */
  gaiaTeff: number | null;
}
const TEFF_SOURCES = ['colour', 'classColour', 'dwarfs', 'martins', 'crowther'] as const;

/** The 4-byte record (uint16 slot, ...) of `slot` in a node's file of records in slot order, or -1. */
function findRecord(buf: Uint8Array, slot: number): number {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let lo = 0, hi = (buf.byteLength >> 2) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, s = v.getUint16(4 * mid, true);
    if (s === slot) return 4 * mid;
    if (s < slot) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** A star's temperature source from its node's file (records: uint16 slot, uint8 code, uint8 E(B-V) in hundredths); none: its colour. */
export function readTeffSource(t: Uint8Array, slot: number, gaia: Uint8Array | null = null): TeffSource {
  const at = findRecord(t, slot);
  const code = at < 0 ? 0 : t[at + 2];
  const g = gaia ? findRecord(gaia, slot) : -1;
  const gaiaTeff = g < 0 ? null : new DataView(gaia!.buffer, gaia!.byteOffset + g + 2, 2).getUint16(0, true);
  return {
    source: gaiaTeff !== null ? 'gaia' : TEFF_SOURCES[code & 7] ?? 'colour',
    flagged: (code & 8) !== 0, reddened: (code & 16) !== 0, dwarfScale: (code & 32) !== 0, redder: (code & 64) !== 0, composite: (code & 128) !== 0,
    ebv: at < 0 ? 0 : t[at + 3] / 100, gaiaTeff,
  };
}

interface StarIndex {
  source?: string; license?: string;
  nodeCapacity: number; rootHalf: number;
  absMag: { min: number; step: number };
  teff: { min: number; max: number };
  idCode: { notableCount: number };
  stars: number;
  nodes: [number, number, number, number, number, number, number, number, number, number, number, 'u' | 'f', number[]][];
}

export interface StarRef { catalog: StarCatalog; node: StarNode; slot: number }

export class StarCatalog {
  readonly nodes: StarNode[];
  readonly totalStars: number;
  readonly notableCount: number;
  private absMin: number;
  private absStep: number;
  private frame = 0;
  private inflight = 0;
  private queue: StarNode[] = [];
  /** nodes needed in the current frame */
  readonly needed: StarNode[] = [];
  loadedStars = 0;
  onNodeLoaded: ((n: StarNode) => void) | null = null;
  onNodeEvicted: ((n: StarNode) => void) | null = null;
  maxLoadedStars = 4_000_000;
  private extraIds: string[] | null = null;
  private extraPromise: Promise<string[]> | null = null;

  readonly license: string;
  readonly source: string;
  /**
   * Where the nodes' distance grades are (public/data/stars-quality: Gaia's numbers, under Gaia's
   * licence, kept apart from the catalogue's tiles), if they are to be used; set by the app.
   */
  qualityBase: string | null = null;
  /** where the nodes' temperature sources are (public/data/stars/t: the catalogue's own), if it has them; set by the app */
  teffBase: string | null = null;
  /**
   * Gaia's temperatures of hot stars (public/data/stars-teff-gaia: under Gaia's licence, kept apart
   * from the catalogue's tiles), if they are to be used: where, and the nodes that have any. A node
   * of these is drawn with them (its temperature bytes replaced as it comes in). Set by the app.
   */
  gaiaTeff: { base: string; nodes: Set<number> } | null = null;
  private teffMin: number;
  private teffMax: number;

  constructor(readonly id: string, private base: string, index: StarIndex) {
    this.license = index.license ?? '';
    this.source = index.source ?? '';
    this.absMin = index.absMag.min;
    this.absStep = index.absMag.step;
    this.teffMin = index.teff.min;
    this.teffMax = index.teff.max;
    this.totalStars = index.stars;
    this.notableCount = index.idCode.notableCount;
    this.nodes = index.nodes.map((n) => ({
      id: n[0], parent: n[1], depth: n[2], center: [n[3], n[4], n[5]], half: n[6], count: n[7],
      magMin: n[8], magMax: n[9], subMag: n[10], enc: n[11], children: n[12],
      state: 'none', pos: null, mt: null, absMag: null, lastNeeded: -1, drawCount: 0, dmin: 0,
      cpuPos: null, ids: null, idsState: 'none',
    }));
  }

  static async load(id: string, base: string): Promise<StarCatalog> {
    const res = await fetch(`${base}/index.json`);
    if (!res.ok) throw new Error(`star index: HTTP ${res.status}`);
    return new StarCatalog(id, base, await res.json());
  }

  decodeAbsMag(code: number): number {
    return this.absMin + code * this.absStep;
  }

  /**
   * Select needed nodes for a camera at `cam` (pc) with limiting apparent magnitude `mLim`.
   * `minDistPc` is a lower bound on the distance of any star drawn by the field (the nearest star
   * outside the near-star layer); it keeps tiles around the camera from drawing every faint star.
   * Fills `this.needed` with ready nodes and queues loads (brightest first).
   */
  update(cam: Vector3, mLim: number, minDistPc = 0): void {
    this.frame++;
    this.needed.length = 0;
    const want: { node: StarNode; m: number }[] = [];
    const stack = [0];
    while (stack.length) {
      const n = this.nodes[stack.pop()!];
      // no star can be closer than the nearest star (outside the near-star layer)
      const d = Math.max(aabbDistance(cam, n.center, n.half), minDistPc);
      n.dmin = d;
      const distMod = 5 * Math.log10(Math.max(d, 1e-9) / 10);
      if (n.subMag + distMod > mLim) continue;
      if (n.count > 0 && n.magMin + distMod <= mLim) {
        n.lastNeeded = this.frame;
        if (n.state === 'ready') {
          n.drawCount = this.countBrighter(n, mLim - distMod);
          this.needed.push(n);
        } else if (n.state === 'none') {
          want.push({ node: n, m: n.magMin + distMod });
        }
      }
      for (const c of n.children) stack.push(c);
    }
    want.sort((a, b) => a.m - b.m);
    this.queue = want.map((w) => w.node);
    this.pump();
    if (this.frame % 60 === 0) this.evict();
  }

  /** Number of leading (brightest) stars in the node with absMag <= limit. */
  private countBrighter(n: StarNode, absLimit: number): number {
    const a = n.absMag!;
    if (absLimit >= n.magMax) return a.length;
    let lo = 0, hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] <= absLimit) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  get pending(): number {
    return this.queue.length + this.inflight;
  }

  private pump(): void {
    while (this.inflight < 6 && this.queue.length) {
      const n = this.queue.shift()!;
      if (n.state !== 'none') continue;
      n.state = 'loading';
      this.inflight++;
      const gaia = this.gaiaTeffOf(n);
      fetch(`${this.base}/n/${n.id}.bin`)
        .then((r) => {
          if (!r.ok) throw new Error(`star node ${n.id}: HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then(async (buf) => [buf, gaia ? await gaia : null] as const)
        .then(([buf, g]) => {
          if (g) this.patchTeff(n, buf, g);
          this.decode(n, buf);
          n.state = 'ready';
          this.loadedStars += n.count;
          this.onNodeLoaded?.(n);
        })
        .catch((e) => {
          console.error(e);
          n.state = 'error';
        })
        .finally(() => {
          this.inflight--;
          this.pump();
        });
    }
  }

  /** a node's Gaia temperatures, if it has any and they are used (fetched once) */
  private gaiaTeffOf(n: StarNode): Promise<Uint8Array | null> | null {
    if (!this.gaiaTeff?.nodes.has(n.id)) return null;
    n.gaiaTeff ??= fetch(`${this.gaiaTeff.base}/n/${n.id}.g`).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
    return n.gaiaTeff;
  }

  /** The temperature byte of the tiles for a temperature (K): build_stars.py's encoding. */
  teffCode(teff: number): number {
    const u = (Math.log(teff) - Math.log(this.teffMin)) / (Math.log(this.teffMax) - Math.log(this.teffMin));
    return Math.max(0, Math.min(255, Math.round(u * 255)));
  }

  /** Put Gaia's temperatures (records: uint16 slot, uint16 K) into a node's tile before it is read. */
  private patchTeff(n: StarNode, buf: ArrayBuffer, g: Uint8Array): void {
    const bytes = new Uint8Array(buf), v = new DataView(g.buffer, g.byteOffset, g.byteLength);
    const [stride, at] = n.enc === 'u' ? [8, 7] : [16, 13];
    for (let k = 0; k + 4 <= g.byteLength; k += 4) {
      const slot = v.getUint16(k, true);
      if (slot < n.count) bytes[slot * stride + at] = this.teffCode(v.getUint16(k + 2, true));
    }
  }

  private decode(n: StarNode, buf: ArrayBuffer): void {
    const count = n.count;
    const mt = new Uint16Array(count);
    const absMag = new Float32Array(count);
    const bytes = new Uint8Array(buf);
    if (n.enc === 'u') {
      const src = new Uint16Array(buf);
      const pos = new Uint16Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = src[i * 4];
        pos[i * 3 + 1] = src[i * 4 + 1];
        pos[i * 3 + 2] = src[i * 4 + 2];
        const m = bytes[i * 8 + 6], t = bytes[i * 8 + 7];
        mt[i] = m | (t << 8);
        absMag[i] = this.absMin + m * this.absStep;
      }
      n.pos = pos;
    } else {
      const src = new Float32Array(buf);
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = src[i * 4];
        pos[i * 3 + 1] = src[i * 4 + 1];
        pos[i * 3 + 2] = src[i * 4 + 2];
        const m = bytes[i * 16 + 12], t = bytes[i * 16 + 13];
        mt[i] = m | (t << 8);
        absMag[i] = this.absMin + m * this.absStep;
      }
      n.pos = pos;
    }
    n.mt = mt;
    n.absMag = absMag;
  }

  private evict(): void {
    if (this.loadedStars < this.maxLoadedStars) return;
    const candidates = this.nodes.filter((n) => n.state === 'ready' && n.lastNeeded < this.frame - 120 && n.id !== 0);
    candidates.sort((a, b) => a.lastNeeded - b.lastNeeded);
    for (const n of candidates) {
      if (this.loadedStars < this.maxLoadedStars * 0.8) break;
      this.onNodeEvicted?.(n);
      n.state = 'none';
      n.pos = null; n.mt = null; n.absMag = null; n.cpuPos = null;
      this.loadedStars -= n.count;
    }
  }

  /** Origin used for rendering a node: min corner (u16) or centre (f32), and the scale factor (pc). */
  nodeFrame(n: StarNode): { origin: [number, number, number]; scale: number } {
    if (n.enc === 'u') return { origin: [n.center[0] - n.half, n.center[1] - n.half, n.center[2] - n.half], scale: 2 * n.half };
    return { origin: n.center, scale: 1 };
  }

  /** Star positions (pc, heliocentric) decoded to doubles, cached per node. */
  cpuPositions(n: StarNode): Float64Array | null {
    if (n.cpuPos) return n.cpuPos;
    if (!n.pos) return null;
    const { origin, scale } = this.nodeFrame(n);
    const out = new Float64Array(n.count * 3);
    const norm = n.enc === 'u' ? 1 / 65535 : 1;
    for (let i = 0; i < n.count * 3; i++) out[i] = origin[i % 3] + n.pos[i] * norm * scale;
    n.cpuPos = out;
    return out;
  }

  starPosition(ref: StarRef, out = new Vector3()): Vector3 {
    const p = this.cpuPositions(ref.node)!;
    return out.set(p[ref.slot * 3], p[ref.slot * 3 + 1], p[ref.slot * 3 + 2]);
  }

  starAbsMag(ref: StarRef): number {
    return ref.node.absMag![ref.slot];
  }

  starTeff(ref: StarRef): number {
    return lutToTeff((ref.node.mt![ref.slot] >> 8) / 255);
  }

  /** Nearest loaded catalogue stars to `cam` (pc) within `radius` pc. */
  nearest(cam: Vector3, radius: number, max = 8): { ref: StarRef; dist: number }[] {
    const out: { ref: StarRef; dist: number }[] = [];
    for (const n of this.nodes) {
      if (n.state !== 'ready') continue;
      if (aabbDistance(cam, n.center, n.half) > radius) continue;
      const p = this.cpuPositions(n)!;
      for (let i = 0; i < n.count; i++) {
        const dx = p[i * 3] - cam.x, dy = p[i * 3 + 1] - cam.y, dz = p[i * 3 + 2] - cam.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < radius * radius) out.push({ ref: { catalog: this, node: n, slot: i }, dist: Math.sqrt(d2) });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, max);
  }

  // ------------------------------------------------------------------ designations
  async designation(ref: StarRef): Promise<{ code: number; text: string | null; notable: number | null }> {
    const n = ref.node;
    if (n.idsState !== 'ready') {
      const r = await fetch(`${this.base}/n/${n.id}.ids`);
      n.ids = new Uint32Array(await r.arrayBuffer());
      n.idsState = 'ready';
    }
    const code = n.ids![ref.slot];
    const kind = code >>> 30;
    const payload = code & 0x3fffffff;
    if (kind === 1) return { code, text: `HIP ${payload}`, notable: null };
    if (kind === 2) return { code, text: `HD ${payload}`, notable: null };
    if (kind === 3) return { code, text: `TYC ${payload >>> 16}-${(payload >>> 2) & 0x3fff}-${(payload & 3) + 1}`, notable: null };
    if (payload < this.notableCount) return { code, text: null, notable: payload };
    const extra = await this.loadExtra();
    const s = extra[payload - this.notableCount] ?? '';
    return { code, text: /^\d+$/.test(s) ? `Gaia DR3 ${s}` : s, notable: null };
  }

  /** How good a star's distance is; null where the catalogue does not say. */
  async distanceGrade(ref: StarRef): Promise<DistanceGrade | null> {
    const n = ref.node;
    if (!this.qualityBase) return null;
    n.quality ??= fetch(`${this.qualityBase}/n/${n.id}.q`).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
    const q = await n.quality;
    if (!q) { n.quality = undefined; return null; } // (asked again next time)
    return readGrade(q, n.count, ref.slot);
  }

  /** Where a star's temperature comes from; null where the catalogue does not say. */
  async teffSource(ref: StarRef): Promise<TeffSource | null> {
    const n = ref.node;
    if (!this.teffBase) return null;
    n.teffSrc ??= fetch(`${this.teffBase}/t/${n.id}.t`).then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null);
    const [t, g] = await Promise.all([n.teffSrc, this.gaiaTeffOf(n)]);
    if (!t) { n.teffSrc = undefined; return null; } // (asked again next time)
    return readTeffSource(t, ref.slot, g ?? null);
  }

  private loadExtra(): Promise<string[]> {
    if (this.extraIds) return Promise.resolve(this.extraIds);
    if (!this.extraPromise) {
      this.extraPromise = fetch(`${this.base}/extra_ids.txt`).then((r) => r.text()).then((t) => (this.extraIds = t.split('\n')));
    }
    return this.extraPromise;
  }
}

export function aabbDistance(p: Vector3, c: [number, number, number], h: number): number {
  const dx = Math.max(Math.abs(p.x - c[0]) - h, 0);
  const dy = Math.max(Math.abs(p.y - c[1]) - h, 0);
  const dz = Math.max(Math.abs(p.z - c[2]) - h, 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export const pcToMeters = (pc: number) => pc * PC;
