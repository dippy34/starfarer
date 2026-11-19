/**
 * Galaxy and quasar catalogue assembly.
 *
 *   'galaxies' : bright / nearby galaxies with shapes — 2MASS Redshift Survey,
 *                Updated Nearby Galaxy Catalog (redshift-independent distances
 *                for the Local Volume) and OpenNGC galaxies (names, sizes).
 *   'sdss'     : SDSS DR17 spectroscopic galaxies.
 *   'quasars'  : SDSS DR16Q quasars.
 *
 * 3D positions are comoving distances from redshift (Planck 2018 ΛCDM), except
 * where UNGC provides a measured distance.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { ICRS_TO_GAL, DEG, raDecToUnit } from '../../../src/core/astro';
import { comovingDistanceMpc, distanceModulus, redshiftAtComovingMpc } from '../../../src/core/cosmology';
import { mat3MulV } from '../../../src/core/math';
import { MPC } from '../../../src/core/units';
import {
  GALAXY_COLUMNS, GAL_BAND_B, GAL_BAND_K, GAL_BAND_R, GAL_FLAG_AGN, GAL_FLAG_STARBURST, GAL_MORPH_SHIFT, Morph, QUASAR_COLUMNS, SDSS_COLUMNS,
  dqGalMag, dqNameDec, dqNameRa, dqQsoMag, dqRedshift, galaxyLodMag, parseJName, qGalColor, qGalMag, qGalPa, qGalRatio, qGalSize, qNameDec, qNameRa,
  qQsoMag, qRedshift, type DatasetManifest,
} from '../../../src/data/format/schema';
import { RAW_DIR, rawPath } from '../lib/http';
import type { NameRegistry } from '../lib/names';
import type { Notable } from './dso';
import { writeDataset } from '../lib/octree';
import { num, readCsv, readVizierTsv, sexToDeg } from '../lib/tables';
import { join } from 'node:path';

const C_KMS = 299_792.458;
const ROOT_HALF_MPC = 16_384;

/** Heliocentric velocity → Local Group frame (Karachentsev & Makarov 1996). */
export function localGroupVelocity(vHel: number, raDeg: number, decDeg: number): number {
  const g = mat3MulV(ICRS_TO_GAL, raDecToUnit(raDeg, decDeg));
  const l = Math.atan2(g.y, g.x);
  const b = Math.asin(Math.max(-1, Math.min(1, g.z)));
  return vHel - 79 * Math.cos(l) * Math.cos(b) + 296 * Math.sin(l) * Math.cos(b) - 36 * Math.sin(b);
}

/** de Vaucouleurs T-type → stored morphology class. */
export function morphFromT(t: number): number {
  if (!Number.isFinite(t)) return Morph.Unknown;
  if (t <= -4) return Morph.E;
  if (t <= -1) return Morph.S0;
  if (t <= 1) return Morph.Sa;
  if (t <= 3) return Morph.Sb;
  if (t <= 5) return Morph.Sc;
  if (t <= 8) return Morph.Sd;
  if (t <= 11) return Morph.Irr;
  if (t === 15 || t === 16) return Morph.Peculiar;
  return Morph.Unknown;
}

/** Hubble-type string (OpenNGC) → morphology class. */
export function morphFromHubble(h: string): number {
  const s = h.trim();
  if (!s) return Morph.Unknown;
  if (/^(E|cD)/.test(s)) return Morph.E;
  if (/^S0|^SB0|^SAB0/.test(s)) return Morph.S0;
  if (/^(S|SB|SAB)a/.test(s)) return Morph.Sa;
  if (/^(S|SB|SAB)b/.test(s)) return Morph.Sb;
  if (/^(S|SB|SAB)c/.test(s)) return Morph.Sc;
  if (/^(S|SB|SAB)(d|m)/.test(s)) return Morph.Sd;
  if (/^I|^Irr/.test(s)) return Morph.Irr;
  if (/^dE|^dSph/.test(s)) return Morph.DwarfE;
  if (/^S/.test(s)) return Morph.Sb;
  if (/P|pec/i.test(s)) return Morph.Peculiar;
  return Morph.Unknown;
}

interface NearGalaxy {
  ra: number;
  dec: number;
  /** Equivalent cosmological redshift (from v_LG, or from a measured distance). */
  z: number;
  mag: number | null;
  band: number;
  color: number | null;
  morph: number;
  sizeArcmin: number | null;
  ratio: number | null;
  pa: number | null;
  names: string[];
  priority: number;
  /** Designation style for unnamed entries: 1 = 2MASX J-name. */
  twoMass: boolean;
  extra: Record<string, string | number>;
}

/**
 * Sky hash for positional cross-matching: declination bands of `cellDeg`,
 * each split into RA cells of the same angular width at the band centre.
 * `near` returns everything in the 3×3 neighbourhood, so matches up to
 * `cellDeg` away are always found.
 */
export class SkyIndex {
  private readonly cells = new Map<number, number[]>();
  constructor(private readonly cellDeg: number) {}
  private band(dec: number): number {
    return Math.floor((dec + 90) / this.cellDeg);
  }
  private cellsInBand(band: number): number {
    const c = Math.max(0.01, Math.cos(((band + 0.5) * this.cellDeg - 90) * DEG));
    return Math.max(1, Math.floor((360 * c) / this.cellDeg));
  }
  private raCell(ra: number, band: number): number {
    const n = this.cellsInBand(band);
    return Math.min(n - 1, Math.floor((ra / 360) * n));
  }
  add(ra: number, dec: number, i: number): void {
    const b = this.band(dec);
    const k = b * 100_000 + this.raCell(ra, b);
    const list = this.cells.get(k);
    if (list) list.push(i);
    else this.cells.set(k, [i]);
  }
  /** Indices of candidates around (ra, dec); callers do the exact separation test. */
  near(ra: number, dec: number): number[] {
    const out: number[] = [];
    const b0 = this.band(dec);
    for (let b = b0 - 1; b <= b0 + 1; b++) {
      const n = this.cellsInBand(b);
      const rc = this.raCell(ra, b);
      const seen = new Set<number>();
      for (let dr = -1; dr <= 1; dr++) {
        const cell = (((rc + dr) % n) + n) % n;
        if (seen.has(cell)) continue;
        seen.add(cell);
        const list = this.cells.get(b * 100_000 + cell);
        if (list) for (const i of list) out.push(i);
      }
    }
    return out;
  }
}

export function sepArcsec(ra1: number, dec1: number, ra2: number, dec2: number): number {
  let dra = Math.abs(ra1 - ra2);
  if (dra > 180) dra = 360 - dra;
  return Math.hypot(dra * Math.cos(((dec1 + dec2) / 2) * DEG), dec1 - dec2) * 3600;
}

const prettyCat = (cat: string): string =>
  cat
    .replace(/_/g, ' ')
    .replace(/^MESSIER 0*/, 'M ')
    .replace(/^(NGC|IC|UGC|PGC|ESO|MCG|CGCG|UGCA) 0+/, '$1 ')
    .trim();

export interface GalaxyNote {
  /** Galaxy position codes [ra, dec, z] linking the note to its tile object. */
  key: [number, number, number];
  smbhMassSun: number;
  jet: number;
  ref: string;
}

export interface GalaxyBuildResult {
  manifests: DatasetManifest[];
  stats: Record<string, number>;
  /** Quantised SDSS columns, reused to derive the survey footprint mask. */
  sdss: { ra: Uint32Array; dec: Uint32Array; z: Uint16Array; mag: Uint8Array; count: number };
  notes: GalaxyNote[];
}

export function buildGalaxies(names: NameRegistry, notable: Notable, finalizeNames: () => void): GalaxyBuildResult {
  const stats: Record<string, number> = {};
  const near: NearGalaxy[] = [];
  const index = new SkyIndex(0.05);

  // ---- 2MASS Redshift Survey (Huchra et al. 2012).
  const t2 = readVizierTsv(rawPath('gal/2mrs.tsv'));
  {
    const c = { id: t2.col('ID'), ra: t2.col('RAJ2000'), dec: t2.col('DEJ2000'), k: t2.col('Ktmag'), j: t2.col('Jtmag'), rext: t2.col('Rext'), ba: t2.col('b/a'), type: t2.col('type'), cz: t2.col('cz'), cat: t2.col('CAT') };
    for (const r of t2.rows) {
      const ra = num(r[c.ra]);
      const dec = num(r[c.dec]);
      const cz = num(r[c.cz]);
      if (!Number.isFinite(ra) || !Number.isFinite(cz)) continue;
      const k = num(r[c.k]);
      const j = num(r[c.j]);
      const rext = num(r[c.rext]);
      const cat = prettyCat(r[c.cat] ?? '');
      const g: NearGalaxy = {
        ra, dec, z: localGroupVelocity(cz, ra, dec) / C_KMS,
        mag: Number.isFinite(k) ? k : null, band: GAL_BAND_K, color: Number.isFinite(k) && Number.isFinite(j) ? j - k : null,
        morph: morphFromT(parseInt(r[c.type] ?? '', 10)),
        sizeArcmin: Number.isFinite(rext) ? (2 * Math.pow(10, rext)) / 60 : null,
        ratio: Number.isFinite(num(r[c.ba])) ? num(r[c.ba]) : null, pa: null,
        names: cat ? [cat] : [], priority: 2, twoMass: true, extra: { cz },
      };
      index.add(ra, dec, near.length);
      near.push(g);
    }
  }
  stats.twoMrs = near.length;

  const findNear = (ra: number, dec: number, radiusArcsec: number): number => {
    let best = -1;
    let bestSep = radiusArcsec;
    for (const i of index.near(ra, dec)) {
      const s = sepArcsec(ra, dec, near[i]!.ra, near[i]!.dec);
      if (s < bestSep) {
        bestSep = s;
        best = i;
      }
    }
    return best;
  };

  // ---- Updated Nearby Galaxy Catalog (Karachentsev et al. 2013): measured distances.
  const tu = readVizierTsv(rawPath('gal/ungc.tsv'));
  {
    const c = { name: tu.col('Name'), ra: tu.col('_RAJ2000'), dec: tu.col('_DEJ2000'), a26: tu.col('a26'), ba: tu.col('b/a'), b: tu.col('Bmag'), k: tu.col('Kmag'), tt: tu.col('TT'), d: tu.col('Dist'), method: tu.col('f_Dist') };
    let added = 0;
    let merged = 0;
    for (const r of tu.rows) {
      const ra = num(r[c.ra]);
      const dec = num(r[c.dec]);
      const d = num(r[c.d]);
      if (!Number.isFinite(ra) || !(d >= 0.02)) continue; // d < 20 kpc is the Milky Way itself
      const name = (r[c.name] ?? '').replace(/([A-Za-z])(\d)/, '$1 $2').trim();
      const z = redshiftAtComovingMpc(d);
      const a26 = num(r[c.a26]);
      const hit = findNear(ra, dec, Math.min(170, Math.max(60, Number.isFinite(a26) ? a26 * 12 : 60)));
      const extra = { dist: d, distMethod: (r[c.method] ?? '').trim() };
      if (hit >= 0) {
        const g = near[hit]!;
        g.z = z;
        Object.assign(g.extra, extra);
        if (name) g.names.push(name);
        merged++;
      } else {
        const b = num(r[c.b]);
        const k = num(r[c.k]);
        index.add(ra, dec, near.length);
        near.push({
          ra, dec, z, mag: Number.isFinite(b) ? b : Number.isFinite(k) ? k : null, band: Number.isFinite(b) ? GAL_BAND_B : GAL_BAND_K, color: null,
          morph: num(r[c.tt]) >= 9 ? Morph.DwarfIrr : num(r[c.tt]) <= -1 && d < 12 ? Morph.DwarfE : morphFromT(num(r[c.tt])),
          sizeArcmin: Number.isFinite(a26) ? a26 : null, ratio: Number.isFinite(num(r[c.ba])) ? num(r[c.ba]) : null, pa: null,
          names: name ? [name] : [], priority: 2, twoMass: false, extra,
        });
        added++;
      }
    }
    stats.ungcAdded = added;
    stats.ungcMerged = merged;
  }

  // ---- OpenNGC galaxies: names, Messier numbers, sizes, position angles.
  let ngcAdded = 0;
  let ngcMerged = 0;
  let ngcNoDistance = 0;
  for (const file of ['dso/NGC.csv', 'dso/addendum.csv']) {
    const lines = (readCsvSemicolon(rawPath(file)));
    const h = lines.header;
    const col = (n: string): number => h.indexOf(n);
    const c = { name: col('Name'), type: col('Type'), ra: col('RA'), dec: col('Dec'), maj: col('MajAx'), min: col('MinAx'), pa: col('PosAng'), b: col('B-Mag'), v: col('V-Mag'), hubble: col('Hubble'), rv: col('RadVel'), z: col('Redshift'), m: col('M'), common: col('Common names') };
    for (const r of lines.rows) {
      const type = r[c.type] ?? '';
      if (!/^G($|Pair|Trpl|Group)/.test(type)) continue;
      const ra = sexToDeg(r[c.ra] ?? '', true);
      const dec = sexToDeg(r[c.dec] ?? '', false);
      if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
      const list = openNgcNames(r[c.name] ?? '', r[c.m] ?? '', r[c.common] ?? '');
      const famous = Boolean((r[c.m] ?? '').trim() || (r[c.common] ?? '').trim());
      const maj = num(r[c.maj]);
      const min = num(r[c.min]);
      const pa = num(r[c.pa]);
      const hit = findNear(ra, dec, Math.min(170, Math.max(45, Number.isFinite(maj) ? maj * 8 : 45)));
      if (hit >= 0) {
        const g = near[hit]!;
        g.names = [...list, ...g.names];
        g.priority = Math.min(g.priority, famous ? 0 : 1);
        if (Number.isFinite(maj)) g.sizeArcmin = maj;
        if (Number.isFinite(maj) && Number.isFinite(min) && maj > 0) g.ratio = min / maj;
        if (Number.isFinite(pa)) g.pa = pa;
        if (g.morph === Morph.Unknown) g.morph = morphFromHubble(r[c.hubble] ?? '');
        if ((r[c.hubble] ?? '').trim()) g.extra.hubble = (r[c.hubble] ?? '').trim();
        ngcMerged++;
        continue;
      }
      const rv = num(r[c.rv]);
      const vlg = Number.isFinite(rv) ? localGroupVelocity(rv, ra, dec) : NaN;
      // Without a match, an OpenNGC galaxy needs a redshift clearly in the Hubble flow to be placed in 3D.
      if (!(vlg > 300)) {
        ngcNoDistance++;
        continue;
      }
      const b = num(r[c.b]);
      const v = num(r[c.v]);
      index.add(ra, dec, near.length);
      near.push({
        ra, dec, z: vlg / C_KMS, mag: Number.isFinite(b) ? b : Number.isFinite(v) ? v + 0.8 : null, band: GAL_BAND_B, color: null,
        morph: morphFromHubble(r[c.hubble] ?? ''), sizeArcmin: Number.isFinite(maj) ? maj : null,
        ratio: Number.isFinite(maj) && Number.isFinite(min) && maj > 0 ? min / maj : null, pa: Number.isFinite(pa) ? pa : null,
        names: list, priority: famous ? 0 : 1, twoMass: false, extra: (r[c.hubble] ?? '').trim() ? { hubble: (r[c.hubble] ?? '').trim(), cz: rv } : { cz: rv },
      });
      ngcAdded++;
    }
  }
  stats.openNgcMerged = ngcMerged;
  stats.openNgcAdded = ngcAdded;
  stats.openNgcGalaxiesWithoutDistance = ngcNoDistance;

  // 2MRS galaxies whose Local-Group-frame velocity is too small for a Hubble-flow distance and
  // that have no measured (UNGC) distance cannot be placed honestly.
  const placed = near.filter((g) => g.z > 0 && (g.extra.dist !== undefined || g.z * C_KMS > 300));
  stats.nearDroppedNoDistance = near.length - placed.length;
  stats.near = placed.length;

  // ---- SDSS DR17 spectroscopic galaxies.
  const sdssFiles = readdirSync(join(RAW_DIR, 'gal')).filter((f) => /^sdss_\d+\.csv$/.test(f)).sort();
  if (sdssFiles.length < 80) throw new Error(`SDSS download looks incomplete: only ${sdssFiles.length} chunk files`);
  const placedIndex = new SkyIndex(0.05);
  placed.forEach((g, i) => placedIndex.add(g.ra, g.dec, i));
  const cap = 2_800_000;
  const s = { ra: new Uint32Array(cap), dec: new Uint32Array(cap), z: new Uint16Array(cap), mag: new Uint8Array(cap), color: new Uint8Array(cap), flags: new Uint8Array(cap) };
  let ns = 0;
  let sdssDup = 0;
  let sdssRows = 0;
  for (const file of sdssFiles) {
    const t = readCsv(rawPath(`gal/${file}`));
    if (t.rows.length === 0) continue;
    const c = { ra: t.col('ra'), dec: t.col('dec'), z: t.col('z'), g: t.col('modelMag_g'), r: t.col('modelMag_r'), petro: t.col('petroMag_r'), ext: t.col('extinction_r'), sub: t.col('subClass') };
    for (const r of t.rows) {
      sdssRows++;
      const ra = num(r[c.ra]);
      const dec = num(r[c.dec]);
      const z = num(r[c.z]);
      if (!Number.isFinite(ra) || !Number.isFinite(dec) || !(z > 0.0005)) continue;
      // Drop the SDSS copy of a galaxy that is already in the bright/nearby set.
      let dup = false;
      for (const i of placedIndex.near(ra, dec)) {
        const g = placed[i]!;
        if (sepArcsec(ra, dec, g.ra, g.dec) < 6 && Math.abs(z - g.z) < 0.003) dup = true;
      }
      if (dup) {
        sdssDup++;
        continue;
      }
      const ext = num(r[c.ext]);
      const e = Number.isFinite(ext) ? ext : 0;
      const petro = num(r[c.petro]);
      const mr = num(r[c.r]);
      const mg = num(r[c.g]);
      // Extinction-corrected Petrosian r (falls back to model r); colour from model magnitudes.
      const mag = petro > 5 && petro < 26 ? petro - e : mr > 5 && mr < 26 ? mr - e : null;
      const color = mg > 5 && mg < 30 && mr > 5 && mr < 30 ? mg - mr - 0.379 * e : null;
      const sub = r[c.sub] ?? '';
      s.ra[ns] = qNameRa(ra);
      s.dec[ns] = qNameDec(dec);
      s.z[ns] = qRedshift(z);
      s.mag[ns] = qGalMag(mag);
      s.color[ns] = qGalColor(color !== null && color > -0.5 && color < 2 ? color : null);
      s.flags[ns] = GAL_BAND_R | (/AGN|BROADLINE/.test(sub) ? GAL_FLAG_AGN : 0) | (/STARBURST|STARFORMING/.test(sub) ? GAL_FLAG_STARBURST : 0);
      ns++;
    }
  }
  stats.sdssRows = sdssRows;
  stats.sdss = ns;
  stats.sdssDuplicatesOfNear = sdssDup;

  // ---- SDSS DR16Q quasars (Lyke et al. 2020).
  const qsoFiles = readdirSync(join(RAW_DIR, 'qso')).filter((f) => f.endsWith('.tsv')).sort();
  if (qsoFiles.length !== 12) throw new Error(`DR16Q download incomplete: ${qsoFiles.length}/12 strips`);
  const qcap = 800_000;
  const q = { ra: new Uint32Array(qcap), dec: new Uint32Array(qcap), z: new Uint16Array(qcap), mag: new Uint8Array(qcap) };
  let nq = 0;
  let qsoBad = 0;
  for (const file of qsoFiles) {
    const t = readVizierTsv(rawPath(`qso/${file}`));
    const c = { name: t.col('SDSS'), z: t.col('z'), i: t.col('imag') };
    for (const r of t.rows) {
      const codes = parseJName(r[c.name] ?? '');
      const z = num(r[c.z]);
      if (!codes || !(z > 0.001) || z > 7.9) {
        qsoBad++;
        continue;
      }
      q.ra[nq] = codes.ra;
      q.dec[nq] = codes.dec;
      q.z[nq] = qRedshift(z);
      q.mag[nq] = qQsoMag(num(r[c.i]));
      nq++;
    }
  }
  stats.quasars = nq;
  stats.quasarsSkippedBadRedshift = qsoBad;

  // ---- Curated notes on famous galaxies (measured black-hole masses, jets).
  const notes: GalaxyNote[] = [];
  for (const note of notable.galaxyNotes) {
    const g = placed.find((p) => p.names.includes(note.match));
    if (!g) {
      console.warn(`  ! curated galaxy ${note.match} not found in the galaxy sample — note skipped`);
      continue;
    }
    g.names = [...g.names, ...note.aliases];
    g.priority = 0;
    notes.push({ key: [qNameRa(g.ra), qNameDec(g.dec), Math.max(1, qRedshift(g.z))], smbhMassSun: note.smbhMassSun, jet: note.jet, ref: note.ref });
  }

  // ---- Names for the bright/nearby set, then quantise and write everything.
  const nearHandles = placed.map((g) => {
    if (g.names.length === 0) return -1;
    const extra: Record<string, string | number> = { ...g.extra };
    if (typeof extra.cz === 'number' && !Number.isFinite(extra.cz)) delete extra.cz;
    return names.add({ kind: 'g', ds: 'galaxies', names: g.names, a: qNameRa(g.ra), b: qNameDec(g.dec), c: Math.max(1, qRedshift(g.z)), priority: g.priority, extra });
  });
  finalizeNames();

  const manifests: DatasetManifest[] = [];

  const positions = (n: number, ra: Uint32Array, dec: Uint32Array, zc: Uint16Array, lod: (i: number, dm: number) => number): { x: Float64Array; y: Float64Array; z: Float64Array; lodMag: Float32Array } => {
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const zz = new Float64Array(n);
    const lodMag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const zr = dqRedshift(zc[i]!);
      const d = comovingDistanceMpc(zr);
      const u = raDecToUnit(dqNameRa(ra[i]!), dqNameDec(dec[i]!));
      x[i] = u.x * d;
      y[i] = u.y * d;
      zz[i] = u.z * d;
      lodMag[i] = lod(i, distanceModulus(zr));
    }
    return { x, y, z: zz, lodMag };
  };

  {
    const n = placed.length;
    const d = { ra: new Uint32Array(n), dec: new Uint32Array(n), z: new Uint16Array(n), mag: new Uint8Array(n), color: new Uint8Array(n), flags: new Uint8Array(n), size: new Uint8Array(n), ratio: new Uint8Array(n), pa: new Uint8Array(n) };
    const nameId = new Int32Array(n);
    placed.forEach((g, i) => {
      d.ra[i] = qNameRa(g.ra);
      d.dec[i] = qNameDec(g.dec);
      d.z[i] = Math.max(1, qRedshift(g.z));
      d.mag[i] = qGalMag(g.mag);
      d.color[i] = qGalColor(g.color);
      d.flags[i] = g.band | (g.morph << GAL_MORPH_SHIFT);
      d.size[i] = qGalSize(g.sizeArcmin);
      d.ratio[i] = qGalRatio(g.ratio);
      d.pa[i] = qGalPa(g.pa);
      nameId[i] = names.finalId(nearHandles[i]!);
      // Same idea as for stars: enough codes in the names table to rebuild the galaxy model from a search hit.
      if (nearHandles[i]! >= 0) {
        const e = names.get(nearHandles[i]!);
        e.extra = { ...(e.extra ?? {}), q: `${d.mag[i]},${d.color[i]},${d.flags[i]},${d.size[i]},${d.ratio[i]},${d.pa[i]}` };
      }
    });
    const p = positions(n, d.ra, d.dec, d.z, (i, dm) => galaxyLodMag(dqGalMag(d.mag[i]!), d.flags[i]! & 3, dm));
    manifests.push(writeDataset({ id: 'galaxies', kind: 'galaxies', title: '2MRS + UNGC + OpenNGC galaxies', unit: MPC, rootHalf: ROOT_HALF_MPC, capacity: 4096, count: n, ...p, columns: GALAXY_COLUMNS, data: d, nameId }));
  }
  {
    const d = { ra: s.ra.subarray(0, ns), dec: s.dec.subarray(0, ns), z: s.z.subarray(0, ns), mag: s.mag.subarray(0, ns), color: s.color.subarray(0, ns), flags: s.flags.subarray(0, ns) };
    const p = positions(ns, d.ra, d.dec, d.z, (i, dm) => galaxyLodMag(dqGalMag(d.mag[i]!), GAL_BAND_R, dm));
    manifests.push(writeDataset({ id: 'sdss', kind: 'galaxies', title: 'SDSS DR17 spectroscopic galaxies', unit: MPC, rootHalf: ROOT_HALF_MPC, capacity: 4096, count: ns, ...p, columns: SDSS_COLUMNS, data: d, nameId: new Int32Array(ns).fill(-1) }));
  }
  {
    const d = { ra: q.ra.subarray(0, nq), dec: q.dec.subarray(0, nq), z: q.z.subarray(0, nq), mag: q.mag.subarray(0, nq) };
    const p = positions(nq, d.ra, d.dec, d.z, (i, dm) => (dqQsoMag(d.mag[i]!) ?? 20.5) - dm);
    manifests.push(writeDataset({ id: 'quasars', kind: 'quasars', title: 'SDSS DR16Q quasars', unit: MPC, rootHalf: ROOT_HALF_MPC, capacity: 4096, count: nq, ...p, columns: QUASAR_COLUMNS, data: d, nameId: new Int32Array(nq).fill(-1) }));
  }
  return { manifests, stats, sdss: { ra: s.ra, dec: s.dec, z: s.z, mag: s.mag, count: ns }, notes };
}

/** OpenNGC uses ';' separators and no quoting. */
export function readCsvSemicolon(path: string): { header: string[]; rows: string[][] } {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  return { header: lines[0]!.split(';'), rows: lines.slice(1).map((l) => l.split(';')) };
}

/** Display names for an OpenNGC row: common names, Messier number, then the NGC/IC designation. */
export function openNgcNames(name: string, messier: string, common: string): string[] {
  const out: string[] = [];
  for (const cn of common.split(',')) if (cn.trim()) out.push(cn.trim());
  const m = parseInt(messier, 10);
  if (Number.isFinite(m) && m > 0) out.push(`M ${m}`, `Messier ${m}`, `M${m}`);
  const d = /^(NGC|IC)0*(\d+)\s*([A-Za-z]*)\s*(NED\d+)?$/.exec(name.trim());
  if (d) {
    out.push(`${d[1]} ${d[2]}${d[3] ?? ''}`);
    out.push(`${d[1]}${d[2]}${d[3] ?? ''}`);
  } else if (name.trim()) {
    out.push(name.trim().replace(/^([A-Za-z]+)0*(\d)/, '$1 $2'));
  }
  return out;
}
