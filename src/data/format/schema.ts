/**
 * Dataset schemas and quantisation rules for the real-catalog tiles.
 * Shared by the build pipeline (quantise) and the runtime worker (dequantise),
 * so a value always decodes to exactly what the builder intended.
 *
 * All catalog objects are stored the way they were observed — sky position
 * plus distance (or redshift) from the Sun — so the real sky is reproduced
 * exactly, and quantisation error lands on the (far less certain) distance.
 */
import type { ColumnSpec } from './tileFormat';

export type DatasetKind = 'stars' | 'galaxies' | 'quasars';

/** Octree node table of one dataset (parallel arrays keep the manifest small). */
export interface NodeTable {
  /** Octant path from the root: '' = root, '37' = child 3 then child 7 (bit0 = +x, bit1 = +y, bit2 = +z). */
  path: string[];
  /** Number of objects in each node. */
  count: number[];
  /** Brightest (smallest) absolute LOD magnitude in each node. */
  mag: number[];
  /**
   * Star datasets only (tiles ordered by apparent brightness in our sky): the brightest apparent
   * magnitude in each node as seen from the Sun, and the median distance of its objects from the
   * Sun (position units). They tell the runtime how bright the node looks from near the Sun
   * (exactly) and from further afield (approximately).
   */
  app?: number[];
  med?: number[];
  /** Compressed size in bytes (for download accounting). */
  bytes: number[];
}

export interface DatasetManifest {
  id: string;
  kind: DatasetKind;
  /** Human-readable title for attribution panels. */
  title: string;
  /** Metres per position unit used by decoded chunks (parsec for stars, megaparsec for galaxies). */
  unit: number;
  /** Half edge length of the root octree cube, in units, centred on the Sun. */
  rootHalf: number;
  capacity: number;
  count: number;
  /** True if `<path>.id` sidecars with 64-bit catalogue ids exist. */
  hasIds: boolean;
  columns: ColumnSpec[];
  nodes: NodeTable;
}

export interface Manifest {
  version: number;
  /** ISO date of the catalog build. */
  built: string;
  datasets: DatasetManifest[];
  /** Total real objects by category, for the About panel. */
  totals: Record<string, number>;
  /** Names-table chunks: chunk 0 is part of the first-launch download, the rest load lazily. */
  names: Array<{ file: string; count: number; bytes: number }>;
  /** Other static files (exoplanets, deep-sky objects, Solar System, constellations, density grid). */
  files: Record<string, { file: string; bytes: number; count?: number }>;
  /** Catalogue completeness limits the procedural generator needs to avoid duplicating real objects. */
  params: Record<string, number>;
  /** Files fetched before the start button is enabled. */
  initial: string[];
  /** Total size of everything under data/, bytes. */
  totalBytes: number;
}

export const STAR_COLUMNS: ColumnSpec[] = [
  { name: 'ra', type: 'u32', delta: true },
  { name: 'dec', type: 'u32' },
  { name: 'dist', type: 'u16' },
  { name: 'mag', type: 'u16' },
  { name: 'color', type: 'u8' },
  { name: 'flags', type: 'u8' },
];

/** Bright/nearby galaxies (2MRS, UNGC, OpenNGC) carry shape columns. */
export const GALAXY_COLUMNS: ColumnSpec[] = [
  { name: 'ra', type: 'u24', delta: true },
  { name: 'dec', type: 'u24' },
  { name: 'z', type: 'u16' },
  { name: 'mag', type: 'u8' },
  { name: 'color', type: 'u8' },
  { name: 'flags', type: 'u8' },
  { name: 'size', type: 'u8' },
  { name: 'ratio', type: 'u8' },
  { name: 'pa', type: 'u8' },
];

export const SDSS_COLUMNS: ColumnSpec[] = GALAXY_COLUMNS.slice(0, 6);

export const QUASAR_COLUMNS: ColumnSpec[] = [
  { name: 'ra', type: 'u24', delta: true },
  { name: 'dec', type: 'u24' },
  { name: 'z', type: 'u16' },
  { name: 'mag', type: 'u8' },
];

// ---------------------------------------------------------------- star flags
export const STAR_SRC_MASK = 0x03;
export const STAR_SRC_GAIA = 0;
export const STAR_SRC_HIP = 1;
export const STAR_SRC_EXO = 2;
export const STAR_FLAG_NEARBY = 0x04; // member of the Gaia Catalogue of Nearby Stars
export const STAR_FLAG_WD = 0x08; // white-dwarf candidate (GCNS wd_prob > 0.5)
export const STAR_FLAG_PLANETS = 0x10; // confirmed exoplanet host
export const STAR_FLAG_PRIOR_DIST = 0x20; // low-S/N parallax: distance is a prior-based estimate

// -------------------------------------------------------------- galaxy flags
export const GAL_BAND_MASK = 0x03;
export const GAL_BAND_R = 0; // SDSS r (AB)
export const GAL_BAND_K = 1; // 2MASS Ks (Vega)
export const GAL_BAND_B = 2; // Johnson B
export const GAL_MORPH_SHIFT = 2;
export const GAL_MORPH_MASK = 0x0f;
export const GAL_FLAG_AGN = 0x40;
export const GAL_FLAG_STARBURST = 0x80;

/** Morphology classes stored in galaxy flags. */
export const Morph = {
  Unknown: 0,
  E: 1,
  S0: 2,
  Sa: 3,
  Sb: 4,
  Sc: 5,
  Sd: 6,
  Irr: 7,
  DwarfE: 8,
  DwarfIrr: 9,
  Peculiar: 10,
} as const;
export type MorphCode = (typeof Morph)[keyof typeof Morph];

// ------------------------------------------------------------- quantisation
const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

/** Star right ascension in micro-degrees. */
export const qStarRa = (raDeg: number): number => clampInt((((raDeg % 360) + 360) % 360) * 1e6, 0, 359_999_999);
export const dqStarRa = (code: number): number => code / 1e6;
/** Star declination, micro-degrees offset by +90°. */
export const qStarDec = (decDeg: number): number => clampInt((decDeg + 90) * 1e6, 0, 180_000_000);
export const dqStarDec = (code: number): number => code / 1e6 - 90;
/** Star distance: 16-bit log scale covering 0.1 pc … 316 kpc (0.023 % steps). */
export const qStarDist = (pc: number): number => clampInt(((Math.log10(pc) + 1) / 6.5) * 65535, 0, 65535);
export const dqStarDist = (code: number): number => Math.pow(10, (code / 65535) * 6.5 - 1);
/** Apparent G magnitude in millimagnitudes, offset by +2. */
export const qStarMag = (mag: number): number => clampInt((mag + 2) * 1000, 0, 65535);
export const dqStarMag = (code: number): number => code / 1000 - 2;
/** BP−RP colour index, 0.025 mag steps from −1; 255 = unknown. */
export const qStarColor = (bpRp: number | null): number => (bpRp === null || !Number.isFinite(bpRp) ? 255 : clampInt((bpRp + 1) * 40, 0, 254));
export const dqStarColor = (code: number): number | null => (code === 255 ? null : code / 40 - 1);

/**
 * Extragalactic sky positions are stored exactly as they appear in IAU
 * "Jhhmmss.ss±ddmmss.s" designations — RA truncated to 0.01 s of time, Dec
 * truncated to 0.1″ — so SDSS / 2MASX names can be regenerated from position
 * alone and need no per-object id storage.
 */
export const qNameRa = (raDeg: number): number => Math.min(8_639_999, Math.max(0, Math.floor((((raDeg % 360) + 360) % 360) * 24_000 + 1e-7)));
export const qNameDec = (decDeg: number): number => {
  const a = Math.min(3_240_000, Math.floor(Math.abs(decDeg) * 36_000 + 1e-7));
  return 3_240_000 + (decDeg < 0 ? -a : a);
};
/** Decoded to the centre of the truncation bin. */
export const dqNameRa = (code: number): number => (code + 0.5) / 24_000;
export const dqNameDec = (code: number): number => {
  const s = code - 3_240_000;
  return s < 0 ? (s - 0.5) / 36_000 : (s + 0.5) / 36_000;
};

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/** "hhmmss.ss±ddmmss.s" from the quantised name coordinates. */
export function jName(raCode: number, decCode: number): string {
  const hh = Math.floor(raCode / 360_000);
  const mm = Math.floor((raCode % 360_000) / 6000);
  const ss = raCode % 6000;
  const s = decCode - 3_240_000;
  const a = Math.abs(s);
  const dd = Math.floor(a / 36_000);
  const dm = Math.floor((a % 36_000) / 600);
  const ds = a % 600;
  return `${pad(hh, 2)}${pad(mm, 2)}${pad(Math.floor(ss / 100), 2)}.${pad(ss % 100, 2)}${s < 0 ? '-' : '+'}${pad(dd, 2)}${pad(dm, 2)}${pad(Math.floor(ds / 10), 2)}.${ds % 10}`;
}

/** 2MASS extended-source style "hhmmssss±ddmmsss" (same digits, no decimal points). */
export function twoMassName(raCode: number, decCode: number): string {
  return jName(raCode, decCode).replace(/\./g, '');
}

/** Parse "hhmmss.ss±ddmmss.s" (or the 2MASS form without dots) into name-coordinate codes. */
export function parseJName(name: string): { ra: number; dec: number } | null {
  const m = /^J?(\d{2})(\d{2})(\d{2})\.?(\d{2})([+-])(\d{2})(\d{2})(\d{2})\.?(\d)$/.exec(name.trim());
  if (!m) return null;
  const ra = Number(m[1]) * 360_000 + Number(m[2]) * 6000 + Number(m[3]) * 100 + Number(m[4]);
  const a = Number(m[6]) * 36_000 + Number(m[7]) * 600 + Number(m[8]) * 10 + Number(m[9]);
  return { ra, dec: 3_240_000 + (m[5] === '-' ? -a : a) };
}

/** Redshift on a cubic 16-bit scale: fine steps nearby (Δz ≈ 7e-6 at z = 0.02), coarse far away, max z = 8. */
export const qRedshift = (z: number): number => clampInt(65535 * Math.cbrt(Math.max(0, z) / 8), 0, 65535);
export const dqRedshift = (code: number): number => {
  const t = code / 65535;
  return 8 * t * t * t;
};

/** Galaxy apparent magnitude, 0.1 mag steps from −1.5; 255 = unknown. */
export const qGalMag = (mag: number | null): number => (mag === null || !Number.isFinite(mag) ? 255 : clampInt((mag + 1.5) * 10, 0, 254));
export const dqGalMag = (code: number): number | null => (code === 255 ? null : code / 10 - 1.5);
/** Galaxy colour index (g−r, or J−K), 0.01 mag steps from −0.5; 255 = unknown. */
export const qGalColor = (c: number | null): number => (c === null || !Number.isFinite(c) ? 255 : clampInt((c + 0.5) * 100, 0, 254));
export const dqGalColor = (code: number): number | null => (code === 255 ? null : code / 100 - 0.5);
/** Angular major-axis diameter in arcminutes, log scale (4.7 % steps, 0.03′ … 3800′); 255 = unknown. */
export const qGalSize = (arcmin: number | null): number => (arcmin === null || !(arcmin > 0) ? 255 : clampInt((Math.log10(arcmin) + 1.5) * 50, 0, 254));
export const dqGalSize = (code: number): number | null => (code === 255 ? null : Math.pow(10, code / 50 - 1.5));
/** Axis ratio b/a in 1/250 steps; 255 = unknown. */
export const qGalRatio = (r: number | null): number => (r === null || !Number.isFinite(r) ? 255 : clampInt(r * 250, 0, 250));
export const dqGalRatio = (code: number): number | null => (code === 255 ? null : code / 250);
/** Position angle (degrees east of north, 0–180) in 0.72° steps; 255 = unknown. */
export const qGalPa = (deg: number | null): number => (deg === null || !Number.isFinite(deg) ? 255 : clampInt(((((deg % 180) + 180) % 180) / 180) * 250, 0, 250));
export const dqGalPa = (code: number): number | null => (code === 255 ? null : (code / 250) * 180);
/** Quasar apparent i magnitude, 0.1 mag steps from 10; 255 = unknown. */
export const qQsoMag = (mag: number | null): number => (mag === null || !Number.isFinite(mag) || mag <= 0 ? 255 : clampInt((mag - 10) * 10, 0, 254));
export const dqQsoMag = (code: number): number | null => (code === 255 ? null : code / 10 + 10);

/**
 * "LOD magnitude": a rough r-band-equivalent absolute magnitude used to order
 * objects by intrinsic brightness (which octree level they live on) and to
 * size point sprites. Not shown to users — the data overlay shows the
 * catalogued apparent magnitude in its own band.
 */
export function galaxyLodMag(mag: number | null, band: number, distanceModulus: number): number {
  if (mag === null) return -17.5; // unknown brightness: assume a modest galaxy
  const toR = band === GAL_BAND_K ? 2.7 : band === GAL_BAND_B ? -0.9 : 0;
  return mag + toR - distanceModulus;
}

/** Tile file path (relative to data/) for an octree node. */
export const tilePath = (datasetId: string, path: string): string => `${datasetId}/r${path}.bin`;
export const idPath = (datasetId: string, path: string): string => `${datasetId}/r${path}.id`;
