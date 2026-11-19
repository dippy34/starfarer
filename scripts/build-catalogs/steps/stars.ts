/**
 * Star catalogue assembly: Gaia DR3 bright sample + Gaia Catalogue of Nearby
 * Stars (100 pc, volume complete) + Hipparcos for the brightest stars Gaia
 * saturates on, with names from the IAU and the HD/Bayer/Flamsteed cross index.
 */
import { existsSync, readFileSync } from 'node:fs';
import { bvToTeff, teffToBpRp } from '../../../src/core/color';
import { DEG } from '../../../src/core/astro';
import { PC } from '../../../src/core/units';
import {
  STAR_COLUMNS, STAR_FLAG_NEARBY, STAR_FLAG_PRIOR_DIST, STAR_FLAG_WD, STAR_SRC_GAIA, STAR_SRC_HIP,
  qStarColor, qStarDec, qStarDist, qStarMag, qStarRa, dqStarDist, dqStarMag, dqStarRa, dqStarDec, type DatasetManifest,
} from '../../../src/data/format/schema';
import { GAIA_DIR, GAIA_G_LIMIT } from '../download';
import { rawPath } from '../lib/http';
import { type NameRegistry, bayerNames, flamsteedNames } from '../lib/names';
import { writeDataset } from '../lib/octree';
import { num, readCsv, readVizierTsv } from '../lib/tables';

/** Gaia DR3 global parallax zero-point offset (Lindegren et al. 2021), mas. */
const PLX_ZERO = 0.017;
/** Length scale of the exponentially-decreasing-space-density distance prior, pc (Bailer-Jones 2015). */
const EDSD_L = 1350;
/** Parallax signal-to-noise above which 1/parallax is used directly. */
const PLX_SNR = 5;
/** Radius of the volume-complete nearby sample (GCNS), pc. */
export const NEAR_RADIUS_PC = 100;

/**
 * Mode of the distance posterior for a parallax measurement with an
 * exponentially decreasing space density prior (Bailer-Jones 2015, eq. 19):
 *   r³/L − 2r² + (ϖ/σ²)·r − 1/σ² = 0   (ϖ, σ in arcsec; r in pc).
 */
export function edsdDistance(plxMas: number, errMas: number, L = EDSD_L): number {
  const w = plxMas / 1000;
  const s = Math.max(errMas, 1e-3) / 1000;
  // Cubic r³ + a r² + b r + c = 0.
  const a = -2 * L;
  const b = (w / (s * s)) * L;
  const c = -L / (s * s);
  const q = (a * a - 3 * b) / 9;
  const r = (2 * a * a * a - 9 * a * b + 27 * c) / 54;
  const roots: number[] = [];
  if (r * r < q * q * q) {
    const th = Math.acos(r / Math.sqrt(q * q * q));
    const m = -2 * Math.sqrt(q);
    roots.push(m * Math.cos(th / 3) - a / 3, m * Math.cos((th + 2 * Math.PI) / 3) - a / 3, m * Math.cos((th - 2 * Math.PI) / 3) - a / 3);
  } else {
    const A = -Math.sign(r) * Math.cbrt(Math.abs(r) + Math.sqrt(r * r - q * q * q));
    const B = A === 0 ? 0 : q / A;
    roots.push(A + B - a / 3);
  }
  const pos = roots.filter((x) => x > 0).sort((x, y) => x - y);
  // One real root → it is the mode; three → the smallest for ϖ ≥ 0, the (single) positive one otherwise.
  return pos[0] ?? L;
}

export class StarStore {
  count = 0;
  ra: Float64Array;
  dec: Float64Array;
  dist: Float64Array;
  mag: Float32Array;
  color: Float32Array;
  flags: Uint8Array;
  id: BigUint64Array;
  hip: Int32Array;
  nameHandle: Int32Array;
  readonly bySource = new Map<bigint, number>();
  readonly byHip = new Map<number, number>();
  private decOrder: Uint32Array | null = null;

  constructor(capacity: number) {
    this.ra = new Float64Array(capacity);
    this.dec = new Float64Array(capacity);
    this.dist = new Float64Array(capacity);
    this.mag = new Float32Array(capacity);
    this.color = new Float32Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.id = new BigUint64Array(capacity);
    this.hip = new Int32Array(capacity);
    this.nameHandle = new Int32Array(capacity).fill(-1);
  }

  add(ra: number, dec: number, distPc: number, mag: number, color: number, flags: number, id: bigint): number {
    const i = this.count++;
    if (i >= this.ra.length) throw new Error('StarStore capacity exceeded');
    this.ra[i] = ra;
    this.dec[i] = dec;
    this.dist[i] = distPc;
    this.mag[i] = mag;
    this.color[i] = color;
    this.flags[i] = flags;
    this.id[i] = id;
    return i;
  }

  /**
   * Nearest star within `radiusArcsec` of a sky position, optionally near an expected magnitude.
   * The sky index is built on first use and covers the stars present at that moment (the full
   * Gaia + Hipparcos sample); stars appended afterwards — exoplanet hosts — are unique by
   * construction and never need to be found by position.
   */
  findNear(ra: number, dec: number, radiusArcsec: number, expectMag = NaN): number {
    if (!this.decOrder) {
      const order = new Uint32Array(this.count);
      for (let i = 0; i < this.count; i++) order[i] = i;
      order.sort((a, b) => this.dec[a]! - this.dec[b]!);
      this.decOrder = order;
    }
    const order = this.decOrder;
    const rad = radiusArcsec / 3600;
    let lo = 0;
    let hi = order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.dec[order[mid]!]! < dec - rad) lo = mid + 1;
      else hi = mid;
    }
    const cosd = Math.max(1e-6, Math.cos(dec * DEG));
    let best = -1;
    let bestScore = Infinity;
    for (let k = lo; k < order.length; k++) {
      const i = order[k]!;
      if (this.dec[i]! > dec + rad) break;
      let dra = Math.abs(this.ra[i]! - ra);
      if (dra > 180) dra = 360 - dra;
      const sep = Math.hypot(dra * cosd, this.dec[i]! - dec);
      if (sep > rad) continue;
      // Prefer close matches; break ties toward the expected brightness.
      const score = sep / rad + (Number.isFinite(expectMag) ? Math.abs(this.mag[i]! - expectMag) * 0.2 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }
}

function distanceFromParallax(plx: number, err: number): { d: number; prior: boolean } {
  if (plx > 0 && plx / err >= PLX_SNR) return { d: 1000 / plx, prior: false };
  return { d: edsdDistance(plx, err), prior: true };
}

export interface StarBuildStats {
  gaiaBright: number;
  gcns: number;
  hipMerged: number;
  hipOnly: number;
  hipRescued: number;
  droppedNoParallax: number;
  priorDistances: number;
}

/** Load Gaia + Hipparcos into a StarStore and register star names. */
export function loadStars(names: NameRegistry): { store: StarStore; stats: StarBuildStats } {
  const marker = rawPath(`${GAIA_DIR}/COMPLETE.json`);
  if (!existsSync(marker)) throw new Error('Gaia download is incomplete (no COMPLETE.json). Run the download step first.');
  const info = JSON.parse(readFileSync(marker, 'utf8')) as { gLimit: number; expectedRows: number; bright: string[]; gcns: string[]; gcnsCount: number; hip: string[] };
  if (info.gLimit !== GAIA_G_LIMIT) throw new Error(`Gaia raw data was downloaded with G < ${info.gLimit}, but GAIA_G_LIMIT is ${GAIA_G_LIMIT}`);

  const store = new StarStore(info.expectedRows + info.gcnsCount + 130_000);
  const stats: StarBuildStats = { gaiaBright: 0, gcns: 0, hipMerged: 0, hipOnly: 0, hipRescued: 0, droppedNoParallax: 0, priorDistances: 0 };

  // --- Gaia Catalogue of Nearby Stars: complete to 100 pc, with its own distance estimates.
  let gcnsRows = 0;
  for (const file of info.gcns) {
    const t = readCsv(rawPath(file));
    const c = { id: t.col('source_id'), ra: t.col('ra'), dec: t.col('dec'), plx: t.col('parallax'), g: t.col('phot_g_mean_mag'), bp: t.col('phot_bp_mean_mag'), rp: t.col('phot_rp_mean_mag'), d: t.col('dist_50'), wd: t.col('wd_prob') };
    for (const r of t.rows) {
      gcnsRows++;
      const g = num(r[c.g]);
      const plx = num(r[c.plx]);
      let d = num(r[c.d]) * 1000;
      if (!(d > 0)) d = 1000 / plx;
      if (!(d > 0) || !Number.isFinite(g)) continue;
      const bp = num(r[c.bp]);
      const rp = num(r[c.rp]);
      const id = BigInt(r[c.id]!);
      const flags = STAR_SRC_GAIA | STAR_FLAG_NEARBY | (num(r[c.wd]) > 0.5 ? STAR_FLAG_WD : 0);
      store.bySource.set(id, store.add(num(r[c.ra]), num(r[c.dec]), d, g, bp - rp, flags, id));
      stats.gcns++;
    }
  }
  if (gcnsRows !== info.gcnsCount) throw new Error(`GCNS row count mismatch: got ${gcnsRows}, archive reports ${info.gcnsCount}`);

  // --- Gaia DR3 all-sky bright sample.
  interface Pending { ra: number; dec: number; g: number; color: number }
  const pending = new Map<bigint, Pending>(); // bright stars with no Gaia parallax
  let brightRows = 0;
  for (const file of info.bright) {
    const t = readCsv(rawPath(file));
    const c = { id: t.col('source_id'), ra: t.col('ra'), dec: t.col('dec'), plx: t.col('parallax'), err: t.col('parallax_error'), g: t.col('phot_g_mean_mag'), col: t.col('bp_rp') };
    for (const r of t.rows) {
      brightRows++;
      const id = BigInt(r[c.id]!);
      if (store.bySource.has(id)) continue;
      const g = num(r[c.g]);
      const plx = num(r[c.plx]);
      const ra = num(r[c.ra]);
      const dec = num(r[c.dec]);
      const color = num(r[c.col]);
      if (!Number.isFinite(plx)) {
        pending.set(id, { ra, dec, g, color });
        continue;
      }
      const { d, prior } = distanceFromParallax(plx + PLX_ZERO, num(r[c.err]));
      if (prior) stats.priorDistances++;
      store.bySource.set(id, store.add(ra, dec, d, g, color, STAR_SRC_GAIA | (prior ? STAR_FLAG_PRIOR_DIST : 0), id));
      stats.gaiaBright++;
    }
  }
  if (brightRows !== info.expectedRows) {
    throw new Error(`Gaia bright sample is incomplete: ${brightRows} rows on disk, archive count is ${info.expectedRows}. Re-run the download step.`);
  }

  // --- Hipparcos (new reduction for astrometry; main catalogue for V, spectral type, HD number).
  const xmatch = new Map<number, { src: bigint; sep: number }>();
  for (const file of info.hip) {
    const t = readCsv(rawPath(file));
    const c = { src: t.col('source_id'), hip: t.col('original_ext_source_id'), sep: t.col('angular_distance') };
    for (const r of t.rows) {
      const hip = Number(r[c.hip]);
      const sep = num(r[c.sep]);
      const prev = xmatch.get(hip);
      if (!prev || sep < prev.sep) xmatch.set(hip, { src: BigInt(r[c.src]!), sep });
    }
  }
  const main = readVizierTsv(rawPath('hip/hip_main.tsv'));
  const mainInfo = new Map<number, { v: number; sp: string; hd: number }>();
  {
    const c = { hip: main.col('HIP'), v: main.col('Vmag'), sp: main.col('SpType'), hd: main.col('HD') };
    for (const r of main.rows) mainInfo.set(Number(r[c.hip]), { v: num(r[c.v]), sp: (r[c.sp] ?? '').trim(), hd: num(r[c.hd]) });
  }
  const hip2 = readVizierTsv(rawPath('hip/hip2.tsv'));
  {
    const c = { hip: hip2.col('HIP'), ra: hip2.col('RArad'), dec: hip2.col('DErad'), plx: hip2.col('Plx'), err: hip2.col('e_Plx'), pmra: hip2.col('pmRA'), pmde: hip2.col('pmDE'), hp: hip2.col('Hpmag'), bv: hip2.col('B-V') };
    const EPOCH_SHIFT = 2016.0 - 1991.25; // propagate Hipparcos positions to the Gaia DR3 epoch
    for (const r of hip2.rows) {
      const hip = Number(r[c.hip]);
      const plx = num(r[c.plx]);
      const err = num(r[c.err]);
      const xm = xmatch.get(hip);
      let idx = xm ? store.bySource.get(xm.src) : undefined;
      if (idx !== undefined) {
        // Already present from Gaia: keep Gaia astrometry unless only Hipparcos has a significant parallax.
        if (store.flags[idx]! & STAR_FLAG_PRIOR_DIST && plx > 0 && plx / err >= PLX_SNR) {
          store.dist[idx] = 1000 / plx;
          store.flags[idx]! &= ~STAR_FLAG_PRIOR_DIST;
          stats.priorDistances--;
        }
        stats.hipMerged++;
      } else if (Number.isFinite(plx) && Number.isFinite(err)) {
        const { d, prior } = distanceFromParallax(plx, err);
        const pend = xm ? pending.get(xm.src) : undefined;
        if (pend && xm) {
          // In Gaia but without a Gaia parallax: Gaia position/photometry + Hipparcos distance.
          idx = store.add(pend.ra, pend.dec, d, pend.g, pend.color, STAR_SRC_GAIA | (prior ? STAR_FLAG_PRIOR_DIST : 0), xm.src);
          store.bySource.set(xm.src, idx);
          pending.delete(xm.src);
          stats.hipRescued++;
        } else {
          // Not in our Gaia sample at all (typically too bright for Gaia): pure Hipparcos entry.
          const dec0 = num(r[c.dec]);
          const dec = dec0 + (num(r[c.pmde]) * EPOCH_SHIFT) / 3.6e6;
          const ra = num(r[c.ra]) + (num(r[c.pmra]) * EPOCH_SHIFT) / 3.6e6 / Math.max(1e-6, Math.cos(dec0 * DEG));
          const bv = num(r[c.bv]);
          const color = Number.isFinite(bv) ? teffToBpRp(bvToTeff(bv)) : NaN;
          idx = store.add(((ra % 360) + 360) % 360, dec, d, num(r[c.hp]), color, STAR_SRC_HIP | (prior ? STAR_FLAG_PRIOR_DIST : 0), BigInt(hip));
          stats.hipOnly++;
        }
        if (prior) stats.priorDistances++;
      }
      if (idx !== undefined) {
        store.hip[idx] = hip;
        store.byHip.set(hip, idx);
      }
    }
  }
  stats.droppedNoParallax = pending.size;

  registerStarNames(store, names, mainInfo);
  return { store, stats };
}

/** Attach IAU proper names, Bayer/Flamsteed designations and HIP/HD numbers. */
function registerStarNames(store: StarStore, names: NameRegistry, mainInfo: Map<number, { v: number; sp: string; hd: number }>): void {
  const proper = new Map<number, string[]>(); // star index → proper names
  const lines = readFileSync(rawPath('names/IAU-CSN.txt'), 'utf8').split(/\r?\n/);
  let unmatched = 0;
  for (const line of lines) {
    if (!line || line.startsWith('#') || line.startsWith('$')) continue;
    const tail = /\s(-?\d+\.\d+|_)\s+(\S+)\s+(\d+|_)\s+(\d+|_)\s+(\d+\.\d+)\s+(-?\d+\.\d+)\s+\d{4}-\d{2}-\d{2}/.exec(line);
    if (!tail) continue;
    const ascii = line.slice(0, 18).trim();
    const pretty = line.slice(18, 36).trim();
    const hip = tail[3] === '_' ? 0 : Number(tail[3]);
    let idx = hip ? store.byHip.get(hip) : undefined;
    if (idx === undefined) {
      const near = store.findNear(Number(tail[5]), Number(tail[6]), 12, tail[1] === '_' ? NaN : Number(tail[1]));
      if (near >= 0) idx = near;
    }
    if (idx === undefined) {
      unmatched++;
      continue;
    }
    const list = proper.get(idx) ?? [];
    list.push(pretty || ascii);
    if (ascii && ascii !== pretty) list.push(ascii);
    proper.set(idx, list);
  }
  if (unmatched) console.info(`  · ${unmatched} IAU-named stars are outside the star sample (too faint/no distance) and were not attached`);

  const cross = readVizierTsv(rawPath('hip/crossindex.tsv'));
  const bayer = new Map<number, string[]>(); // HIP → designations
  {
    const c = { hip: cross.col('HIP'), fl: cross.col('Fl'), bayer: cross.col('Bayer'), cst: cross.col('Cst') };
    for (const r of cross.rows) {
      const hip = Number(r[c.hip]);
      if (!hip) continue;
      const cst = (r[c.cst] ?? '').trim();
      const list = [...(r[c.bayer]?.trim() ? bayerNames(r[c.bayer]!, cst) : []), ...flamsteedNames(r[c.fl] ?? '', cst)];
      if (list.length) bayer.set(hip, [...(bayer.get(hip) ?? []), ...list]);
    }
  }

  for (let i = 0; i < store.count; i++) {
    const hip = store.hip[i]!;
    const props = proper.get(i);
    if (!hip && !props) continue;
    const info = hip ? mainInfo.get(hip) : undefined;
    const desig = hip ? (bayer.get(hip) ?? []) : [];
    const list = [...(props ?? []), ...desig];
    if (hip) list.push(`HIP ${hip}`);
    if (info && info.hd > 0) list.push(`HD ${info.hd}`);
    const extra: Record<string, string | number> = {};
    if (info?.sp) extra.sp = info.sp;
    if (info && Number.isFinite(info.v)) extra.v = info.v;
    store.nameHandle[i] = names.add({
      kind: 's', ds: 'stars', names: list,
      a: qStarRa(store.ra[i]!), b: qStarDec(store.dec[i]!), c: qStarDist(store.dist[i]!),
      priority: props ? 0 : desig.length ? 1 : 2, extra,
    });
  }
}

/** Quantise the store and write the `stars` dataset tiles. */
export function writeStars(store: StarStore, names: NameRegistry): DatasetManifest {
  const n = store.count;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const lodMag = new Float32Array(n);
  const appMag = new Float32Array(n);
  const data = { ra: new Uint32Array(n), dec: new Uint32Array(n), dist: new Uint16Array(n), mag: new Uint16Array(n), color: new Uint8Array(n), flags: new Uint8Array(n) };
  const nameId = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    data.ra[i] = qStarRa(store.ra[i]!);
    data.dec[i] = qStarDec(store.dec[i]!);
    data.dist[i] = qStarDist(store.dist[i]!);
    data.mag[i] = qStarMag(store.mag[i]!);
    data.color[i] = qStarColor(Number.isFinite(store.color[i]!) ? store.color[i]! : null);
    data.flags[i] = store.flags[i]!;
    // Positions and LOD brightness are computed from the *quantised* values, exactly as the runtime will.
    const d = dqStarDist(data.dist[i]!);
    const ra = dqStarRa(data.ra[i]!) * DEG;
    const dec = dqStarDec(data.dec[i]!) * DEG;
    x[i] = d * Math.cos(dec) * Math.cos(ra);
    y[i] = d * Math.cos(dec) * Math.sin(ra);
    z[i] = d * Math.sin(dec);
    appMag[i] = dqStarMag(data.mag[i]!);
    lodMag[i] = appMag[i]! - 5 * Math.log10(d / 10);
    nameId[i] = names.finalId(store.nameHandle[i]!);
    // Named stars carry their photometry codes in the names table too, so search can build the
    // star's system directly — identical to what the tile would give — without waiting for a tile.
    if (store.nameHandle[i]! >= 0) {
      const e = names.get(store.nameHandle[i]!);
      e.extra = { ...(e.extra ?? {}), q: `${data.mag[i]},${data.color[i]},${data.flags[i]}` };
    }
  }
  return writeDataset({
    id: 'stars', kind: 'stars', title: 'Gaia DR3 + Hipparcos stars', unit: PC, rootHalf: 2 ** 18, capacity: 4096,
    // Tiles are ordered by apparent brightness in our sky (see lib/octree.ts).
    count: n, x, y, z, lodMag, orderKey: appMag, tenPc: 10, columns: STAR_COLUMNS, data, nameId, ids: store.id.subarray(0, n),
  });
}
