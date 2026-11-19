/**
 * Procedural star field of a galaxy.
 *
 * Stars are generated in deterministic cells of a multi-level grid fixed to
 * the galaxy. Each level holds one 1-magnitude slice of the luminosity
 * function in cells sized so that a cell near a Sun-like neighbourhood holds
 * a few dozen stars: rare supergiants live in kiloparsec cells that are
 * needed from far away, abundant red dwarfs in 8 pc cells that are only
 * needed nearby. Nothing is stored — a cell's contents are a pure function of
 * (galaxy seed, level, cell coordinates).
 *
 * In the Milky Way the generator leaves out every star the real catalogues
 * already contain (apparent G < limit from the Sun, or inside the
 * volume-complete 100 pc sphere), so real and procedural stars tile space
 * without overlap or gaps.
 */
import { dlog, dlog10, dpow } from '../core/dmath';
import { hashCell, hashCombine } from '../core/hash';
import { Rng } from '../core/rng';
import { POP_MID, POP_OLD, POP_YOUNG, galaxyDensity, galaxyDensityBound } from './galaxy';
import { mainSequenceTeff } from './star';
import type { GalaxyModel, StarType } from './types';

export const STAR_LEVELS = 24;
/** Bright edge of level 0 (absolute G magnitude); each level spans one magnitude. */
export const STAR_LEVEL0_MAG = -8.5;
/** Local stellar number density the level table is tuned for (stars / pc³). */
const SOLAR_DENSITY = 0.14;
/** Hard cap on candidates per cell (only reached in galactic nuclei). */
const MAX_CANDIDATES = 4000;

export const STAR_TYPE_CODES: StarType[] = ['main', 'subgiant', 'giant', 'supergiant', 'whitedwarf', 'neutron', 'pulsar', 'blackhole', 'browndwarf'];
const T_MAIN = 0;
const T_SUB = 1;
const T_GIANT = 2;
const T_SUPER = 3;
const T_WD = 4;
const T_NS = 5;
const T_PSR = 6;
const T_BH = 7;

/** log10 of the local luminosity function Φ(M) in stars / pc³ / mag (Jahreiß & Wielen 1997; Gaia GCNS), piecewise linear. */
const LF: Array<[number, number]> = [
  [-9, -10.2], [-8, -9.5], [-6, -8.0], [-4, -6.6], [-2, -5.4], [0, -4.0], [1, -3.5], [2, -3.2], [3, -2.9], [4, -2.6], [5, -2.45],
  [6, -2.4], [8, -2.4], [10, -2.1], [12, -1.9], [13, -1.95], [14, -2.1], [16, -2.4],
];

function lfLog(m: number): number {
  if (m <= LF[0]![0]) return LF[0]![1];
  for (let i = 1; i < LF.length; i++) {
    if (m <= LF[i]![0]) {
      const [m0, v0] = LF[i - 1]!;
      const [m1, v1] = LF[i]!;
      return v0 + ((v1 - v0) * (m - m0)) / (m1 - m0);
    }
  }
  return LF[LF.length - 1]![1];
}

export interface StarLevel {
  /** Absolute-magnitude slice [magLo, magHi). */
  magLo: number;
  magHi: number;
  /** Fraction of all stars that fall in this slice. */
  fraction: number;
  /** Cell edge in parsecs (a power of two). */
  cell: number;
  /** Population class (controls scale height and arm confinement). */
  pop: number;
}

function buildLevels(): StarLevel[] {
  const levels: StarLevel[] = [];
  for (let l = 0; l < STAR_LEVELS; l++) {
    const magLo = STAR_LEVEL0_MAG + l;
    const mid = magLo + 0.5;
    const fraction = dpow(10, lfLog(mid)) / 0.1;
    const pop = magLo < -2.5 ? POP_YOUNG : magLo < 3.5 ? POP_MID : POP_OLD;
    const thick = pop === POP_YOUNG ? 150 : pop === POP_MID ? 420 : 700; // 2 × scale height, pc
    // Volume holding ~48 stars at solar density, corrected for the disc being thinner than big cells.
    let cell = dpow(48 / (SOLAR_DENSITY * fraction), 1 / 3);
    if (cell > thick) cell = Math.sqrt(48 / (SOLAR_DENSITY * fraction * thick));
    const pow2 = Math.round(dlog(cell) / 0.6931471805599453);
    levels.push({ magLo, magHi: magLo + 1, fraction, pop, cell: Math.max(8, Math.min(16384, 2 ** pow2)) });
  }
  return levels;
}

export const STAR_LEVEL_TABLE: StarLevel[] = buildLevels();

/** Where the Sun is in a galaxy's local frame, and what the real catalogues already cover around it. */
export interface CatalogSuppression {
  /** Sun position in galaxy-local parsecs. */
  sunX: number;
  sunY: number;
  sunZ: number;
  /** Real catalogue is complete brighter than this apparent G magnitude (seen from the Sun)… */
  gLimit: number;
  /** …and for every star inside this radius (pc). */
  nearRadius: number;
}

export interface StarCell {
  level: number;
  ix: number;
  iy: number;
  iz: number;
  count: number;
  /** World-axis offsets from the cell centre, parsecs (x, y, z per star). */
  pos: Float32Array;
  absMag: Float32Array;
  teff: Float32Array;
  type: Uint8Array;
  /** Candidate index within the cell (stable part of the star id). */
  index: Uint16Array;
  seed: Uint32Array;
}

/** Stable id of a procedural star. */
export function starId(galaxyId: string, level: number, ix: number, iy: number, iz: number, index: number): string {
  return `${galaxyId}/s${level}.${ix}.${iy}.${iz}.${index}`;
}

export function parseStarId(id: string): { galaxyId: string; level: number; ix: number; iy: number; iz: number; index: number } | null {
  const m = /^(.*)\/s(\d+)\.(-?\d+)\.(-?\d+)\.(-?\d+)\.(\d+)$/.exec(id);
  if (!m) return null;
  return { galaxyId: m[1]!, level: Number(m[2]), ix: Number(m[3]), iy: Number(m[4]), iz: Number(m[5]), index: Number(m[6]) };
}

/** Draw a star (type + temperature) for a given absolute magnitude from the Hertzsprung–Russell diagram. */
function sampleStar(rng: Rng, absMag: number, oldOnly: boolean): { type: number; teff: number } {
  const u = rng.next();
  const jitter = 1 + 0.06 * (rng.next() - 0.5);
  if (absMag < -5.5) {
    if (oldOnly || u > 0.85) return { type: T_SUPER, teff: rng.range(5500, 9000) };
    if (u < 0.55) return { type: T_SUPER, teff: rng.range(18000, 42000) };
    return { type: T_SUPER, teff: rng.range(3400, 4300) };
  }
  if (absMag < -2.5) {
    if (!oldOnly && u < 0.7) return { type: T_MAIN, teff: mainSequenceTeff(absMag) * jitter };
    return { type: absMag < -3.5 ? T_SUPER : T_GIANT, teff: rng.range(3600, 4700) };
  }
  if (absMag < 0.2) {
    if (!oldOnly && u < 0.55) return { type: T_MAIN, teff: mainSequenceTeff(absMag) * jitter };
    return { type: T_GIANT, teff: rng.range(3900, 5000) };
  }
  if (absMag < 2) {
    if (!oldOnly && u < 0.45) return { type: T_MAIN, teff: mainSequenceTeff(absMag) * jitter };
    return { type: T_GIANT, teff: rng.range(4500, 5100) }; // red clump
  }
  if (absMag < 3.5) {
    if (u < 0.8 && !oldOnly) return { type: T_MAIN, teff: mainSequenceTeff(absMag) * jitter };
    return { type: T_SUB, teff: rng.range(4900, 5700) };
  }
  if (absMag < 9.5) return { type: T_MAIN, teff: mainSequenceTeff(absMag) * jitter };
  // Faint end: red dwarfs, white dwarfs, and a sprinkle of compact objects whose faint
  // glow (hot surface / accretion) we place here so that they can be found by explorers.
  if (u < 0.09) return { type: T_WD, teff: 4500 * dpow(5.5, rng.next() * rng.next()) };
  if (u < 0.092) return { type: T_NS, teff: 600000 };
  if (u < 0.0935) return { type: T_PSR, teff: 800000 };
  if (u < 0.095) return { type: T_BH, teff: 0 };
  return { type: T_MAIN, teff: mainSequenceTeff(absMag) * jitter };
}

/**
 * Generate one star cell. Coordinates are integer cell indices in the
 * galaxy-local grid of the level (cell (0,0,0) has its corner at the centre).
 */
export function generateStarCell(g: GalaxyModel, level: number, ix: number, iy: number, iz: number, suppress: CatalogSuppression | null): StarCell {
  const L = STAR_LEVEL_TABLE[level]!;
  const size = L.cell;
  const half = size / 2;
  // Cell centre in galaxy-local parsecs.
  const cx = (ix + 0.5) * size;
  const cy = (iy + 0.5) * size;
  const cz = (iz + 0.5) * size;
  const empty: StarCell = { level, ix, iy, iz, count: 0, pos: new Float32Array(0), absMag: new Float32Array(0), teff: new Float32Array(0), type: new Uint8Array(0), index: new Uint16Array(0), seed: new Uint32Array(0) };

  const bound = galaxyDensityBound(g, cx / 1000, cy / 1000, cz / 1000, half / 1000, L.pop);
  const lambda = g.density0 * L.fraction * bound * size * size * size;
  if (lambda < 0.002) return empty;

  const cellSeed = hashCell(g.seed, level, ix, iy, iz);
  const rng = new Rng(cellSeed);
  const candidates = Math.min(MAX_CANDIDATES, rng.poisson(lambda));
  if (candidates === 0) return empty;

  const oldOnly = g.type === 'elliptical' || g.type === 'lenticular' || g.type === 'dwarf';
  const pos = new Float32Array(candidates * 3);
  const absMag = new Float32Array(candidates);
  const teff = new Float32Array(candidates);
  const type = new Uint8Array(candidates);
  const index = new Uint16Array(candidates);
  const seed = new Uint32Array(candidates);
  const b = g.basis;
  let n = 0;
  for (let c = 0; c < candidates; c++) {
    // Always draw the same number of randoms per candidate so acceptance never shifts later stars.
    const ux = rng.next();
    const uy = rng.next();
    const uz = rng.next();
    const accept = rng.next();
    const um = rng.next();
    const starSeed = hashCombine(cellSeed, c);
    const lx = cx + (ux - 0.5) * size;
    const ly = cy + (uy - 0.5) * size;
    const lz = cz + (uz - 0.5) * size;
    if (accept * bound > galaxyDensity(g, lx / 1000, ly / 1000, lz / 1000, L.pop)) continue;
    const m = L.magLo + um;
    if (suppress) {
      const dx = lx - suppress.sunX;
      const dy = ly - suppress.sunY;
      const dz = lz - suppress.sunZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < suppress.nearRadius * suppress.nearRadius) continue;
      // Apparent magnitude from the Sun: m = M + 5·log10(d / 10 pc).
      if (m + 2.5 * dlog10(d2) - 5 < suppress.gLimit) continue;
    }
    const s = sampleStar(new Rng(starSeed), m, oldOnly);
    // Compact objects glow faintly; keep them at the dim end of the slice.
    const ox = lx - cx;
    const oy = ly - cy;
    const oz = lz - cz;
    pos[n * 3] = b[0] * ox + b[3] * oy + b[6] * oz;
    pos[n * 3 + 1] = b[1] * ox + b[4] * oy + b[7] * oz;
    pos[n * 3 + 2] = b[2] * ox + b[5] * oy + b[8] * oz;
    absMag[n] = m;
    teff[n] = s.teff;
    type[n] = s.type;
    index[n] = c;
    seed[n] = starSeed;
    n++;
  }
  return { level, ix, iy, iz, count: n, pos: pos.subarray(0, n * 3), absMag: absMag.subarray(0, n), teff: teff.subarray(0, n), type: type.subarray(0, n), index: index.subarray(0, n), seed: seed.subarray(0, n) };
}

/**
 * A block of k × k × k neighbouring cells of one level, merged for transport
 * and drawing. Bright levels are needed out to many cell widths, so the
 * runtime asks for whole blocks sized to the visibility radius instead of
 * thousands of single cells. The stars themselves are exactly those of the
 * individual cells: ids and canonical positions do not depend on the block size.
 */
export interface StarBlock {
  level: number;
  /** Block edge in cells; block (bx, by, bz) covers cells [bx·k, bx·k + k) on each axis. */
  k: number;
  bx: number;
  by: number;
  bz: number;
  count: number;
  /** World-axis offsets from the block centre, parsecs — used for drawing and picking. */
  pos: Float32Array;
  /** Cell of each star (ix, iy, iz): with `index` it forms the stable id… */
  cell: Int32Array;
  /** …and with this world-axis offset from the cell centre (parsecs, exactly as generated) its canonical position. */
  local: Float32Array;
  absMag: Float32Array;
  teff: Float32Array;
  type: Uint8Array;
  index: Uint16Array;
  seed: Uint32Array;
}

export function generateStarBlock(g: GalaxyModel, level: number, k: number, bx: number, by: number, bz: number, suppress: CatalogSuppression | null): StarBlock {
  const size = STAR_LEVEL_TABLE[level]!.cell;
  const cells: StarCell[] = [];
  let total = 0;
  for (let dz = 0; dz < k; dz++) {
    for (let dy = 0; dy < k; dy++) {
      for (let dx = 0; dx < k; dx++) {
        const c = generateStarCell(g, level, bx * k + dx, by * k + dy, bz * k + dz, suppress);
        if (c.count > 0) {
          cells.push(c);
          total += c.count;
        }
      }
    }
  }
  const out: StarBlock = {
    level, k, bx, by, bz, count: total, pos: new Float32Array(total * 3), cell: new Int32Array(total * 3), local: new Float32Array(total * 3),
    absMag: new Float32Array(total), teff: new Float32Array(total), type: new Uint8Array(total), index: new Uint16Array(total), seed: new Uint32Array(total),
  };
  const b = g.basis;
  const mid = (k - 1) / 2;
  let n = 0;
  for (const c of cells) {
    // Cell centre relative to the block centre: galaxy-local parsecs, then world axes.
    const lx = (c.ix - bx * k - mid) * size;
    const ly = (c.iy - by * k - mid) * size;
    const lz = (c.iz - bz * k - mid) * size;
    const wx = b[0] * lx + b[3] * ly + b[6] * lz;
    const wy = b[1] * lx + b[4] * ly + b[7] * lz;
    const wz = b[2] * lx + b[5] * ly + b[8] * lz;
    for (let i = 0; i < c.count; i++, n++) {
      out.pos[n * 3] = c.pos[i * 3]! + wx;
      out.pos[n * 3 + 1] = c.pos[i * 3 + 1]! + wy;
      out.pos[n * 3 + 2] = c.pos[i * 3 + 2]! + wz;
      out.local[n * 3] = c.pos[i * 3]!;
      out.local[n * 3 + 1] = c.pos[i * 3 + 1]!;
      out.local[n * 3 + 2] = c.pos[i * 3 + 2]!;
      out.cell[n * 3] = c.ix;
      out.cell[n * 3 + 1] = c.iy;
      out.cell[n * 3 + 2] = c.iz;
      out.absMag[n] = c.absMag[i]!;
      out.teff[n] = c.teff[i]!;
      out.type[n] = c.type[i]!;
      out.index[n] = c.index[i]!;
      out.seed[n] = c.seed[i]!;
    }
  }
  return out;
}

/** Visibility radius (pc) of a level for a given apparent-magnitude limit. */
export function levelRadius(level: number, magLimit: number): number {
  return 10 * dpow(10, (magLimit - STAR_LEVEL_TABLE[level]!.magLo) / 5);
}

/**
 * Expected number of visible procedural stars around a point of relative
 * density `rhoRel` (in units of `density0`) for a magnitude limit — used to
 * pick the limit that fits the point budget in dense regions.
 */
export function expectedStarCount(g: GalaxyModel, rhoRel: number, magLimit: number): number {
  let total = 0;
  for (let l = 0; l < STAR_LEVELS; l++) {
    const L = STAR_LEVEL_TABLE[l]!;
    const r = levelRadius(l, magLimit);
    // Discs are thin: beyond a few scale heights the sampled volume grows like r², not r³.
    const thick = g.hz * 1000 * (L.pop === POP_YOUNG ? 0.5 : L.pop === POP_MID ? 1.4 : 2.3);
    const volume = g.bulgeFrac >= 1 || r < thick ? (4 / 3) * Math.PI * r * r * r : Math.PI * r * r * 2 * thick;
    total += g.density0 * rhoRel * L.fraction * volume * 0.35;
  }
  return total;
}
