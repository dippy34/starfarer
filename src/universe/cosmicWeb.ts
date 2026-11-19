/**
 * The large-scale universe: a deterministic cosmic-web density field and the
 * procedural galaxies that trace it.
 *
 * Two families of level-of-detail cells cover space (all sizes in Mpc):
 *
 *   galaxy levels  — individual galaxies, one magnitude slice of the Schechter
 *                    luminosity function per level. Selectable, flyable-into,
 *                    each with a stable id.
 *   glow levels    — soft particles that carry the unresolved light of the
 *                    web beyond the reach of individual galaxies: three
 *                    levels (cells of 32, 64 and 128 Mpc), each drawn in its
 *                    own shell of distances, trace the filaments and knots
 *                    out to a few hundred megaparsecs. Farther away a sight
 *                    line crosses so many structures that the web averages
 *                    to a blank haze, and only the real surveys remain.
 *
 * Real catalogues override the procedural field: a procedural galaxy that
 * would have been bright enough to be in 2MRS or in the SDSS main sample
 * (inside its footprint) is not generated, and within ~240 Mpc of the Milky
 * Way the density field itself is blended with the real 2MRS density, so
 * faint procedural galaxies gather around the real clusters and walls.
 */
import { DEG, ICRS_TO_GAL } from '../core/astro';
import { datan2, dexp, dlog10, dpow, dsin } from '../core/dmath';
import { hashCell, hashCombine, mix32 } from '../core/hash';
import { Noise3 } from '../core/noise';
import { Rng } from '../core/rng';

/** Comoving radius of the observable universe, Mpc. */
export const UNIVERSE_RADIUS_MPC = 14_260;

// ------------------------------------------------------------------ density field

const web = new Noise3(0x5eb1);
const web2 = new Noise3(0x7c3d);
const web3 = new Noise3(0x91f7);
const warp = new Noise3(0x2a4b);

/** Base wavelength of the web pattern (void-to-void distance), Mpc. */
const WEB_SCALE = 115;
/**
 * How the galaxies are shared between the four environments of the web. Voids
 * fill ~75 % of space but hold only ~8 % of the galaxies; walls ~20 %,
 * filaments ~45 % and the dense knots where filaments thicken ~27 % (the
 * proportions of the simulated cosmic web in Cautun et al. 2014, shifted
 * towards the dense phases because galaxies cluster more strongly than mass).
 * The weights are scaled so that the field has unit mean (measured 1.000 ± 0.003
 * over a (14 Gpc)³ box; the unit tests re-measure it), so procedural galaxy
 * counts follow the luminosity function exactly on average.
 */
const W_VOID = 0.08;
const W_WALL = 0.96;
const W_FIL = 7.8;
const W_KNOT = 9.8;
/** Average of the knot profile along a filament: coarse callers keep the knots' galaxies, smeared along the filament. */
const KNOT_MEAN = 0.478;
/**
 * Procedural matter density relative to the cosmic mean at a comoving position (Mpc).
 * `detail` = smallest scale (Mpc) that matters to the caller; coarser callers get a
 * smoother field so that huge cells are not aliased by structure they cannot resolve.
 */
export function webDensity(x: number, y: number, z: number, detail = 0): number {
  const s = 1 / WEB_SCALE;
  // Domain warp bends the sheets so walls and filaments curve naturally.
  const wx = warp.noise(x * s * 0.6, y * s * 0.6, z * s * 0.6);
  const wy = warp.noise(x * s * 0.6 + 31.4, y * s * 0.6 + 47.2, z * s * 0.6 + 11.8);
  const wz = warp.noise(x * s * 0.6 + 71.1, y * s * 0.6 + 13.9, z * s * 0.6 + 59.3);
  const px = x * s + 0.55 * wx;
  const py = y * s + 0.55 * wy;
  const pz = z * s + 0.55 * wz;

  // Very-large-scale modulation (super-structure): gentle, so the universe stays homogeneous.
  const huge = 1 + 0.38 * web3.noise(x / 640, y / 640, z / 640) + 0.22 * web3.noise(x / 2600 + 9.1, y / 2600 + 3.3, z / 2600 + 5.7);
  if (detail > 220) return Math.max(0.2, huge);

  // Zero-sets of smooth noise are sheets; two sheets meet in curves, three in points.
  const n1 = web.noise(px, py, pz);
  const n2 = web2.noise(px + 17.3, py + 5.1, pz + 29.7);
  const wall = dexp(-(n1 * n1) / 0.0072);
  const fil = wall * dexp(-(n2 * n2) / 0.013);
  const amp = Math.max(0.2, huge);
  if (detail >= 60) return (W_VOID + W_WALL * wall + (W_FIL + W_KNOT * KNOT_MEAN) * fil) * amp;
  const n3 = web3.noise(px * 1.7 + 3.3, py * 1.7 + 41.9, pz * 1.7 + 7.7);
  const knot = fil * dexp(-(n3 * n3) / 0.05);
  // Small-scale clumping into groups along the structure.
  const clump = detail < 12 ? 0.55 + 0.9 * (0.5 + 0.5 * web2.noise(x / 9, y / 9, z / 9)) : 1;
  return (W_VOID + W_WALL * wall + W_FIL * fil + W_KNOT * knot) * clump * amp;
}

/** Real large-scale-structure data produced by the catalog pipeline (lss.bin). */
export class LssData {
  readonly n: number;
  readonly half: number;
  readonly grid: Uint8Array;
  readonly maskW: number;
  readonly maskH: number;
  readonly mask: Uint8Array;

  constructor(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x3153534c) throw new Error('bad LSS file');
    this.n = view.getUint32(4, true);
    this.half = view.getFloat32(8, true);
    this.maskW = view.getUint32(12, true);
    this.maskH = view.getUint32(16, true);
    const g = this.n * this.n * this.n;
    this.grid = bytes.subarray(24, 24 + g);
    this.mask = bytes.subarray(24 + g, 24 + g + this.maskW * this.maskH);
  }

  /** log2 of the real density relative to the mean (trilinear), or null outside the grid. */
  logDensity(x: number, y: number, z: number): number | null {
    const n = this.n;
    const c = (2 * this.half) / n;
    const gx = (x + this.half) / c - 0.5;
    const gy = (y + this.half) / c - 0.5;
    const gz = (z + this.half) / c - 0.5;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= n - 1 || gy >= n - 1 || gz >= n - 1) return null;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fy = gy - iy;
    const fz = gz - iz;
    const at = (a: number, b: number, d: number): number => this.grid[(d * n + b) * n + a]!;
    const x00 = at(ix, iy, iz) * (1 - fx) + at(ix + 1, iy, iz) * fx;
    const x10 = at(ix, iy + 1, iz) * (1 - fx) + at(ix + 1, iy + 1, iz) * fx;
    const x01 = at(ix, iy, iz + 1) * (1 - fx) + at(ix + 1, iy, iz + 1) * fx;
    const x11 = at(ix, iy + 1, iz + 1) * (1 - fx) + at(ix + 1, iy + 1, iz + 1) * fx;
    const v = (x00 * (1 - fy) + x10 * fy) * (1 - fz) + (x01 * (1 - fy) + x11 * fy) * fz;
    return (v - 96) / 16;
  }

  /** Is this sky direction inside the SDSS main-sample footprint? (dx, dy, dz need not be normalised.) */
  inSdss(dx: number, dy: number, dz: number): boolean {
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r === 0) return false;
    let ra = datan2(dy, dx) / DEG;
    if (ra < 0) ra += 360;
    const mx = Math.min(this.maskW - 1, Math.floor((ra / 360) * this.maskW));
    const my = Math.min(this.maskH - 1, Math.floor(((dz / r + 1) / 2) * this.maskH));
    return this.mask[my * this.maskW + mx] === 1;
  }
}

/** Catalogue completeness limits (from the manifest) used to avoid duplicating real galaxies. */
export interface GalaxySuppression {
  lss: LssData;
  /** 2MRS limit expressed as a pseudo-r magnitude, and its zone-of-avoidance half-width in degrees. */
  twoMrsLimit: number;
  avoidanceDeg: number;
  /** SDSS main-sample limit (r). */
  sdssLimit: number;
}

/** Sine of galactic latitude of a direction from the Sun. */
function sinGalLat(x: number, y: number, z: number): number {
  const r = Math.sqrt(x * x + y * y + z * z) || 1;
  return (ICRS_TO_GAL[6] * x + ICRS_TO_GAL[7] * y + ICRS_TO_GAL[8] * z) / r;
}

/** Density used for placing objects: procedural field, blended toward the real field near the Milky Way. */
export function blendedDensity(x: number, y: number, z: number, detail: number, sup: GalaxySuppression | null): number {
  const proc = webDensity(x, y, z, detail);
  if (!sup) return proc;
  const r = Math.sqrt(x * x + y * y + z * z);
  const edge = sup.lss.half * 0.92;
  if (r >= edge) return proc;
  const real = sup.lss.logDensity(x, y, z);
  if (real === null) return proc;
  // Trust the real field less toward the edge of the grid and inside the zone of avoidance.
  const t = Math.min(1, (edge - r) / (edge * 0.35));
  const zoa = Math.min(1, Math.abs(sinGalLat(x, y, z)) / 0.14);
  const w = t * t * (3 - 2 * t) * zoa;
  if (w <= 0) return proc;
  // Geometric blend: ρ = ρ_proc^(1−w) · ρ_real^w.
  return dpow(Math.max(proc, 1e-4), 1 - w) * dpow(2, real * w);
}

// ------------------------------------------------------------------------ levels

export interface WebLevel {
  /** True for glow (aggregate) levels, false for individual galaxies. */
  glow: boolean;
  /** Absolute r-magnitude slice (galaxies); a nominal value for glow particles. */
  magLo: number;
  magHi: number;
  /** Cell edge, Mpc. */
  cell: number;
  /** Mean number density, objects per Mpc³. */
  density: number;
}

/** Schechter luminosity function (r band, h = 0.68): φ* = 0.005 Mpc⁻³, M* = −21.2, α = −1.25. */
function schechter(m: number): number {
  const x = dpow(10, -0.4 * (m + 21.2));
  return 0.921034 * 0.005 * dpow(x, -0.25) * dexp(-x);
}

export const GALAXY_LEVELS = 12;
export const GLOW_LEVELS = 3;
/** Mean glow particles per cell: enough to draw a filament as a continuous thread of small soft dots. */
const GLOW_PER_CELL = 560;
/** Nominal absolute magnitude recorded for glow particles (they are drawn by surface brightness, not by magnitude). */
const GLOW_MAG = -22;

function buildLevels(): WebLevel[] {
  const out: WebLevel[] = [];
  // Galaxy levels: M from −24 to −12 in 1-mag slices, brightest first.
  for (let l = 0; l < GALAXY_LEVELS; l++) {
    const magLo = -24 + l;
    const density = schechter(magLo + 0.5);
    const ideal = dpow(48 / density, 1 / 3);
    const cell = ideal > 256 ? 512 : ideal > 48 ? 64 : ideal > 22 ? 32 : ideal > 12 ? 16 : 8;
    out.push({ glow: false, magLo, magHi: magLo + 1, cell, density });
  }
  // Glow levels: cells doubling from 32 Mpc.
  for (let a = 0; a < GLOW_LEVELS; a++) {
    const cell = 32 * 2 ** a;
    out.push({ glow: true, magLo: GLOW_MAG, magHi: GLOW_MAG, cell, density: GLOW_PER_CELL / (cell * cell * cell) });
  }
  return out;
}

/** Level table: indices 0…11 are galaxy levels, 12…14 glow levels. */
export const WEB_LEVELS: WebLevel[] = buildLevels();

export interface GalaxyCell {
  level: number;
  ix: number;
  iy: number;
  iz: number;
  count: number;
  /** Offsets from the cell centre, Mpc. */
  pos: Float32Array;
  absMag: Float32Array;
  /** Candidate index within the cell (stable part of the id). */
  index: Uint32Array;
  seed: Uint32Array;
  /**
   * Galaxies: bit 0 = quasar, bit 1 = red (quiescent) galaxy.
   * Glow particles: the local density on a log scale (64 = cosmic mean, +48 per doubling), used to tint them.
   */
  flags: Uint8Array;
}

export const GAL_FLAG_QUASAR = 1;
export const GAL_FLAG_RED = 2;

export function galaxyId(level: number, ix: number, iy: number, iz: number, index: number): string {
  return `g:${level}:${ix}:${iy}:${iz}:${index}`;
}

export function parseGalaxyId(id: string): { level: number; ix: number; iy: number; iz: number; index: number } | null {
  const m = /^g:(\d+):(-?\d+):(-?\d+):(-?\d+):(\d+)$/.exec(id);
  return m ? { level: Number(m[1]), ix: Number(m[2]), iy: Number(m[3]), iz: Number(m[4]), index: Number(m[5]) } : null;
}

const SUB = 6; // sub-cells per axis used to shape the density inside a cell
const MAX_PER_CELL = 9000;
const H0_OVER_C = 67.66 / 299_792.458; // per Mpc

/**
 * Generate one cosmic-web cell. Cell (ix, iy, iz) spans [i, i+1) × cell size
 * from the origin (the Sun). Deterministic in (level, ix, iy, iz) and the
 * suppression data.
 */
export function generateGalaxyCell(level: number, ix: number, iy: number, iz: number, sup: GalaxySuppression | null): GalaxyCell {
  const L = WEB_LEVELS[level]!;
  const size = L.cell;
  const cx = (ix + 0.5) * size;
  const cy = (iy + 0.5) * size;
  const cz = (iz + 0.5) * size;
  const empty: GalaxyCell = { level, ix, iy, iz, count: 0, pos: new Float32Array(0), absMag: new Float32Array(0), index: new Uint32Array(0), seed: new Uint32Array(0), flags: new Uint8Array(0) };

  // Entirely outside the observable universe?
  const nx = Math.max(0, Math.abs(cx) - size / 2);
  const ny = Math.max(0, Math.abs(cy) - size / 2);
  const nz = Math.max(0, Math.abs(cz) - size / 2);
  if (nx * nx + ny * ny + nz * nz > UNIVERSE_RADIUS_MPC * UNIVERSE_RADIUS_MPC) return empty;

  const cellSeed = hashCell(L.glow ? 0x610e : 0x6a1c, level, ix, iy, iz);
  const rng = new Rng(cellSeed);
  const sub = size / SUB;
  const perSub = L.density * sub * sub * sub;
  const pos: number[] = [];
  const mags: number[] = [];
  const idx: number[] = [];
  const seeds: number[] = [];
  const flags: number[] = [];
  let candidate = 0;

  for (let sz = 0; sz < SUB; sz++) {
    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) {
        // Jittered probe of the density inside the sub-cell.
        const qx = cx + (sx + rng.next() - SUB / 2) * sub;
        const qy = cy + (sy + rng.next() - SUB / 2) * sub;
        const qz = cz + (sz + rng.next() - SUB / 2) * sub;
        const rho = blendedDensity(qx, qy, qz, sub, sup);
        const n = Math.min(400, rng.poisson(perSub * rho));
        for (let k = 0; k < n && pos.length < MAX_PER_CELL * 3; k++) {
          const c = candidate++;
          const x = cx + (sx + rng.next() - SUB / 2) * sub;
          const y = cy + (sy + rng.next() - SUB / 2) * sub;
          const z = cz + (sz + rng.next() - SUB / 2) * sub;
          const um = rng.next();
          const r2 = x * x + y * y + z * z;
          if (r2 > UNIVERSE_RADIUS_MPC * UNIVERSE_RADIUS_MPC) continue;
          const seed = hashCombine(cellSeed, c);
          let m = L.magLo;
          let flag = 0;
          if (L.glow) flag = Math.max(0, Math.min(255, Math.round(64 + 159.45 * dlog10(Math.max(rho, 0.01)))));
          else {
            m = L.magLo + um;
            const h = mix32(seed ^ 0x9e37);
            // Luminous galaxies are mostly red-sequence; faint ones mostly blue. Dense regions redden them.
            const pRed = Math.min(0.92, Math.max(0.08, 0.45 - 0.11 * (m + 20.5) + 0.12 * Math.min(2, dlog10(Math.max(rho, 0.1)))));
            if ((h & 0xffff) / 65536 < pRed) flag |= GAL_FLAG_RED;
            if (m < -20.5 && ((h >>> 16) & 0xffff) / 65536 < 0.004) flag |= GAL_FLAG_QUASAR;
            if (sup) {
              // Would a real survey have catalogued this galaxy? Then the real catalogue is the truth here.
              const d = Math.sqrt(r2);
              const zr = d * H0_OVER_C;
              const apparent = m + 5 * dlog10(Math.max(d, 1e-3) * (1 + zr) * 1e5);
              if (apparent < sup.twoMrsLimit && Math.abs(sinGalLat(x, y, z)) > dsin(sup.avoidanceDeg * DEG)) continue;
              if (apparent < sup.sdssLimit && zr < 0.3 && sup.lss.inSdss(x, y, z)) continue;
            }
          }
          pos.push(x - cx, y - cy, z - cz);
          mags.push(m);
          idx.push(c);
          seeds.push(seed);
          flags.push(flag);
        }
      }
    }
  }
  return { level, ix, iy, iz, count: mags.length, pos: Float32Array.from(pos), absMag: Float32Array.from(mags), index: Uint32Array.from(idx), seed: Uint32Array.from(seeds), flags: Uint8Array.from(flags) };
}

/** Radius (Mpc) out to which a level needs to be populated for an apparent-magnitude limit. */
export function webLevelRadius(level: number, magLimit: number): number {
  const L = WEB_LEVELS[level]!;
  if (L.glow) return 3.4 * L.cell;
  return dpow(10, (magLimit - L.magLo) / 5 - 5);
}
