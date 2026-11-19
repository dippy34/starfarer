/**
 * Deep-sky objects inside (and around) the Milky Way: star clusters, nebulae,
 * supernova remnants, pulsars and famous black holes.
 *
 * An object is only placed in the 3D universe if a real distance exists for it:
 *   globular clusters  → Harris (1996, 2010 edition)
 *   open clusters      → Hunt & Reffert (2023), reliable sample (CST ≥ 5, CMD class ≥ 0.5)
 *   planetary nebulae  → González-Santamaría et al. (2021), Gaia EDR3 central stars
 *   pulsars            → ATNF pulsar catalogue (Manchester et al. 2005)
 *   famous nebulae/SNR → curated literature values (curated/notable.json)
 * OpenNGC supplies names, types, sizes and Messier numbers. Objects with no
 * distance in any of these are skipped and counted — never invented.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zlibSync } from 'fflate';
import { OUT_DIR, rawPath } from '../lib/http';
import type { NameRegistry } from '../lib/names';
import { num, readVizierTsv, sexToDeg } from '../lib/tables';
import { SkyIndex, openNgcNames, readCsvSemicolon, sepArcsec } from './galaxies';

export type DsoType = 'oc' | 'gc' | 'pn' | 'en' | 'rn' | 'dn' | 'snr' | 'psr' | 'bh' | 'qso';

/** One deep-sky object as shipped to the app. */
export interface DsoRecord {
  /** Display name. */
  n: string;
  t: DsoType;
  ra: number;
  dec: number;
  /** Distance in parsecs (absent only for 'qso', which uses z). */
  d?: number;
  z?: number;
  /** Physical radius in parsecs, when an angular size is known. */
  r?: number;
  /** Apparent visual magnitude, when catalogued. */
  m?: number;
  /** Extras: age (yr), member count, pulsar period (s), black-hole mass (Msun), distance reference… */
  x?: Record<string, string | number>;
}

export interface Notable {
  nebulaDistances: Array<{ match: string; distPc: number; ref: string }>;
  extraObjects: Array<{ names: string[]; type: DsoType; ra: number; dec: number; distPc?: number; z?: number; extra?: Record<string, string | number>; ref: string }>;
  starCompanions: Array<{ star: string; aliases: string[]; companion: Record<string, string | number>; ref: string }>;
  galaxyNotes: Array<{ match: string; aliases: string[]; smbhMassSun: number; jet: number; ref: string }>;
  pulsarNames: Record<string, string[]>;
}

export function loadNotable(): Notable {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, '..', 'curated', 'notable.json'), 'utf8')) as Notable;
}

const OPEN_NGC_TYPES: Record<string, DsoType> = { OCl: 'oc', '*Ass': 'oc', GCl: 'gc', 'Cl+N': 'en', PN: 'pn', HII: 'en', EmN: 'en', Neb: 'en', RfN: 'rn', DrkN: 'dn', SNR: 'snr' };
const normName = (s: string): string => s.replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/^(NGC|IC)\s*0*(\d)/i, '$1 $2').trim().toUpperCase();
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const ARCMIN = Math.PI / 180 / 60;

export function buildDso(names: NameRegistry): { stats: Record<string, number>; file: { file: string; bytes: number; count: number } } {
  const notable = loadNotable();
  const stats: Record<string, number> = {};
  const out: DsoRecord[] = [];
  const pending: Array<{ rec: DsoRecord; names: string[]; priority: number }> = [];
  const push = (rec: DsoRecord, list: string[], priority: number): void => {
    pending.push({ rec, names: list, priority });
  };

  // ---- Reference distance catalogues.
  interface Ref { name: string; all: string[]; ra: number; dec: number; d: number; used: boolean; x: Record<string, string | number>; rPc?: number; m?: number }
  const harris: Ref[] = [];
  {
    const t = readVizierTsv(rawPath('dso/harris_gc.tsv'));
    const c = { id: t.col('ID'), name: t.col('Name'), ra: t.col('_RAJ2000'), dec: t.col('_DEJ2000'), r: t.col('Rsun'), v: t.col('Vt'), feh: t.col('[Fe/H]'), rh: t.col('Rh') };
    for (const r of t.rows) {
      const d = num(r[c.r]) * 1000;
      if (!(d > 0)) continue;
      const rh = num(r[c.rh]);
      const x: Record<string, string | number> = { src: 'Harris 1996 (2010 ed.)' };
      if (Number.isFinite(num(r[c.feh]))) x.feh = num(r[c.feh]);
      harris.push({ name: r[c.id]!.trim(), all: [r[c.id]!.trim(), (r[c.name] ?? '').trim()].filter(Boolean), ra: num(r[c.ra]), dec: num(r[c.dec]), d, used: false, x, rPc: Number.isFinite(rh) ? rh * ARCMIN * d * 3 : undefined, m: Number.isFinite(num(r[c.v])) ? num(r[c.v]) : undefined });
    }
  }
  const hunt: Ref[] = [];
  let huntRejected = 0;
  {
    const t = readVizierTsv(rawPath('dso/hunt_clusters_v2.tsv'));
    const c = { name: t.col('Name'), all: t.col('AllNames'), type: t.col('Type'), cst: t.col('CST'), cmd: t.col('CMDCl50'), ra: t.col('RA_ICRS'), dec: t.col('DE_ICRS'), d: t.col('dist50'), r50: t.col('r50pc'), n: t.col('N'), age: t.col('logAge50') };
    for (const r of t.rows) {
      const d = num(r[c.d]);
      // Reliable sample defined by Hunt & Reffert (2023): CST ≥ 5σ and CMD class ≥ 0.5; open clusters only.
      if ((r[c.type] ?? '').trim() !== 'o' || !(num(r[c.cst]) >= 5) || !(num(r[c.cmd]) >= 0.5) || !(d > 0)) {
        huntRejected++;
        continue;
      }
      const x: Record<string, string | number> = { src: 'Hunt & Reffert 2023', stars: num(r[c.n]) };
      if (Number.isFinite(num(r[c.age]))) x.age = Math.round(Math.pow(10, num(r[c.age])));
      hunt.push({ name: r[c.name]!.replace(/_/g, ' ').trim(), all: (r[c.all] ?? '').split(',').map((s) => s.replace(/_/g, ' ').trim()).filter(Boolean), ra: num(r[c.ra]), dec: num(r[c.dec]), d, used: false, x, rPc: Number.isFinite(num(r[c.r50])) ? num(r[c.r50]) * 2 : undefined });
    }
  }
  stats.huntClustersRejectedByQualityCut = huntRejected;
  const pne: Ref[] = [];
  {
    const main = readVizierTsv(rawPath('dso/pn_main.tsv'));
    const pos = new Map<string, { name: string; ra: number; dec: number }>();
    const cm = { png: main.col('PNG'), name: main.col('OName'), ra: main.col('RA_ICRS'), dec: main.col('DE_ICRS') };
    for (const r of main.rows) pos.set(r[cm.png]!.trim(), { name: (r[cm.name] ?? '').trim(), ra: num(r[cm.ra]), dec: num(r[cm.dec]) });
    const dist = readVizierTsv(rawPath('dso/pn_dist.tsv'));
    const cd = { png: dist.col('PNG'), d: dist.col('Dist'), rad: dist.col('Radphys'), morph: dist.col('Morph') };
    for (const r of dist.rows) {
      const p = pos.get(r[cd.png]!.trim());
      const d = num(r[cd.d]);
      if (!p || !(d > 0)) continue;
      const x: Record<string, string | number> = { src: 'González-Santamaría+ 2021 (Gaia EDR3)' };
      if ((r[cd.morph] ?? '').trim()) x.morph = r[cd.morph]!.trim();
      pne.push({ name: p.name || r[cd.png]!.trim(), all: [p.name, r[cd.png]!.trim()].filter(Boolean), ra: p.ra, dec: p.dec, d, used: false, x, rPc: Number.isFinite(num(r[cd.rad])) ? num(r[cd.rad]) : undefined });
    }
  }

  const makeIndex = (refs: Ref[]): { byName: Map<string, Ref>; sky: SkyIndex } => {
    const byName = new Map<string, Ref>();
    const sky = new SkyIndex(0.1);
    refs.forEach((ref, i) => {
      for (const n of ref.all) byName.set(normName(n), ref);
      sky.add(ref.ra, ref.dec, i);
    });
    return { byName, sky };
  };
  const find = (refs: Ref[], idx: ReturnType<typeof makeIndex>, list: string[], ra: number, dec: number, radius: number): Ref | undefined => {
    for (const n of list) {
      const hit = idx.byName.get(normName(n));
      if (hit) return hit;
    }
    let best: Ref | undefined;
    let bestSep = radius;
    for (const i of idx.sky.near(ra, dec)) {
      const s = sepArcsec(ra, dec, refs[i]!.ra, refs[i]!.dec);
      if (s < bestSep) {
        bestSep = s;
        best = refs[i];
      }
    }
    return best;
  };
  const harrisIdx = makeIndex(harris);
  const huntIdx = makeIndex(hunt);
  const pnIdx = makeIndex(pne);
  const curated = new Map(notable.nebulaDistances.map((e) => [normName(e.match), e]));

  // ---- OpenNGC objects.
  const skipped: Record<string, number> = {};
  for (const file of ['dso/NGC.csv', 'dso/addendum.csv']) {
    const t = readCsvSemicolon(rawPath(file));
    const col = (n: string): number => t.header.indexOf(n);
    const c = { name: col('Name'), type: col('Type'), ra: col('RA'), dec: col('Dec'), maj: col('MajAx'), b: col('B-Mag'), v: col('V-Mag'), m: col('M'), common: col('Common names') };
    for (const r of t.rows) {
      const type = OPEN_NGC_TYPES[r[c.type] ?? ''];
      if (!type) continue;
      const ra = sexToDeg(r[c.ra] ?? '', true);
      const dec = sexToDeg(r[c.dec] ?? '', false);
      if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
      const list = openNgcNames(r[c.name] ?? '', r[c.m] ?? '', r[c.common] ?? '');
      const famous = Boolean((r[c.m] ?? '').trim() || (r[c.common] ?? '').trim());
      const maj = num(r[c.maj]);
      let ref: Ref | undefined;
      let d = NaN;
      const x: Record<string, string | number> = {};
      if (type === 'gc') ref = find(harris, harrisIdx, list, ra, dec, 150);
      else if (type === 'oc') ref = find(hunt, huntIdx, list, ra, dec, 240);
      else if (type === 'pn') ref = find(pne, pnIdx, list, ra, dec, 40);
      else if ((r[c.type] ?? '') === 'Cl+N') ref = find(hunt, huntIdx, list, ra, dec, 240);
      if (ref) {
        d = ref.d;
        ref.used = true;
        Object.assign(x, ref.x);
        for (const n of ref.all) if (!list.some((l) => normName(l) === normName(n))) list.push(n);
      }
      if (!(d > 0)) {
        for (const n of list) {
          const cur = curated.get(normName(n));
          if (cur) {
            d = cur.distPc;
            x.src = cur.ref;
            break;
          }
        }
      }
      if (!(d > 0)) {
        skipped[r[c.type]!] = (skipped[r[c.type]!] ?? 0) + 1;
        continue;
      }
      const rec: DsoRecord = { n: list[0]!, t: type, ra: round(ra, 5), dec: round(dec, 5), d: round(d, 1), x };
      if (Number.isFinite(maj) && maj > 0) rec.r = round((maj / 2) * ARCMIN * d, 3);
      else if (ref?.rPc) rec.r = round(ref.rPc, 3);
      const mag = Number.isFinite(num(r[c.v])) ? num(r[c.v]) : Number.isFinite(num(r[c.b])) ? num(r[c.b]) : ref?.m;
      if (mag !== undefined && Number.isFinite(mag)) rec.m = mag;
      push(rec, list, famous ? 0 : 1);
    }
  }
  for (const [k, v] of Object.entries(skipped)) stats[`openNgcSkippedNoDistance_${k}`] = v;

  // ---- Catalogue objects that OpenNGC does not list.
  for (const ref of harris) {
    if (ref.used) continue;
    const rec: DsoRecord = { n: ref.all[1] ?? ref.name, t: 'gc', ra: round(ref.ra, 5), dec: round(ref.dec, 5), d: round(ref.d, 1), x: ref.x };
    if (ref.rPc) rec.r = round(ref.rPc, 3);
    if (ref.m !== undefined) rec.m = ref.m;
    push(rec, ref.all, 2);
  }
  for (const ref of hunt) {
    if (ref.used) continue;
    const rec: DsoRecord = { n: ref.name, t: 'oc', ra: round(ref.ra, 5), dec: round(ref.dec, 5), d: round(ref.d, 1), x: ref.x };
    if (ref.rPc) rec.r = round(ref.rPc, 3);
    push(rec, [ref.name, ...ref.all.slice(0, 4)], /^(Melotte|Collinder|Hyades|Pleiades|Trumpler|Stock|Blanco)/i.test(ref.name) ? 1 : 2);
  }
  for (const ref of pne) {
    if (ref.used) continue;
    const rec: DsoRecord = { n: ref.name, t: 'pn', ra: round(ref.ra, 4), dec: round(ref.dec, 4), d: round(ref.d, 1), x: ref.x };
    if (ref.rPc) rec.r = round(ref.rPc, 4);
    push(rec, ref.all, 2);
  }

  // ---- Pulsars (ATNF catalogue via VizieR B/psr).
  {
    const t = readVizierTsv(rawPath('dso/pulsars.tsv'));
    const c = { j: t.col('PSRJ'), ra: t.col('_RAJ2000'), dec: t.col('_DEJ2000'), p: t.col('P0'), d: t.col('Dist'), age: t.col('Age'), b: t.col('Bsurf'), assoc: t.col('Assoc') };
    let noDist = 0;
    for (const r of t.rows) {
      const d = num(r[c.d]) * 1000;
      const ra = num(r[c.ra]);
      const dec = num(r[c.dec]);
      if (!(d > 0) || !Number.isFinite(ra) || !Number.isFinite(dec)) {
        noDist++;
        continue;
      }
      const j = r[c.j]!.trim();
      const nick = notable.pulsarNames[j.replace(/^J/, 'J')] ?? [];
      const x: Record<string, string | number> = { src: 'ATNF Pulsar Catalogue' };
      if (Number.isFinite(num(r[c.p]))) x.period = num(r[c.p]);
      if (num(r[c.age]) > 0) x.age = num(r[c.age]);
      if (num(r[c.b]) > 0) x.bfield = num(r[c.b]);
      const snr = /SNR:([^,[\]]+)/.exec(r[c.assoc] ?? '');
      if (snr) x.assoc = snr[1]!.replace(/_/g, ' ');
      push({ n: nick[0] ?? `PSR ${j}`, t: 'psr', ra: round(ra, 5), dec: round(dec, 5), d: round(d, 1), x }, [...nick, `PSR ${j}`], nick.length ? 0 : 2);
    }
    stats.pulsarsSkippedNoDistance = noDist;
  }

  // ---- Curated famous objects (black holes, a few supernova remnants, 3C 273).
  for (const e of notable.extraObjects) {
    const rec: DsoRecord = { n: e.names[0]!, t: e.type, ra: e.ra, dec: e.dec, x: { ...(e.extra ?? {}), src: e.ref } };
    if (e.distPc) rec.d = e.distPc;
    if (e.z) rec.z = e.z;
    const sizeArcmin = e.extra?.sizeArcmin;
    if (typeof sizeArcmin === 'number' && e.distPc) rec.r = round((sizeArcmin / 2) * ARCMIN * e.distPc, 3);
    push(rec, e.names, 0);
  }

  // Stable order: by type then name, so rebuilding does not shuffle indices needlessly.
  pending.sort((p, q) => p.rec.t.localeCompare(q.rec.t) || p.rec.n.localeCompare(q.rec.n) || p.rec.ra - q.rec.ra);
  pending.forEach((p, i) => {
    out.push(p.rec);
    names.add({ kind: 'd', ds: 'dso', names: p.names, a: i, b: 0, c: 0, priority: p.priority });
    stats[`dso_${p.rec.t}`] = (stats[`dso_${p.rec.t}`] ?? 0) + 1;
  });
  const bytes = zlibSync(new TextEncoder().encode(JSON.stringify(out)), { level: 9, mem: 12 });
  writeFileSync(join(OUT_DIR, 'dso.bin'), bytes);
  console.info(`  ✓ dso: ${out.length} deep-sky objects (${(bytes.byteLength / 1e3).toFixed(0)} kB)`);
  return { stats, file: { file: 'dso.bin', bytes: bytes.byteLength, count: out.length } };
}
