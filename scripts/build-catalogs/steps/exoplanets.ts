/**
 * NASA Exoplanet Archive (Planetary Systems Composite Parameters): every
 * confirmed planet, grouped by host star and linked to the star catalogue.
 *
 * Host matching order: Gaia DR3 id → Hipparcos number → sky position. Hosts
 * that are not in the star sample (fainter than the Gaia cut and beyond
 * 100 pc — most Kepler hosts) are added from the archive's own stellar
 * parameters, provided the archive lists a distance.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zlibSync } from 'fflate';
import { teffToBpRp } from '../../../src/core/color';
import { STAR_FLAG_PLANETS, STAR_SRC_EXO, qStarDec, qStarDist, qStarRa } from '../../../src/data/format/schema';
import { OUT_DIR, rawPath } from '../lib/http';
import type { NameRegistry } from '../lib/names';
import { num, readCsv } from '../lib/tables';
import type { StarStore } from './stars';

/** Planet row shipped to the app (undefined = not measured). */
export interface ExoPlanetRecord {
  name: string;
  letter: string;
  /** Orbital period, days. */
  per?: number;
  /** Semi-major axis, AU. */
  a?: number;
  ecc?: number;
  /** Inclination, degrees. */
  inc?: number;
  /** Argument of periastron, degrees. */
  w?: number;
  /** Radius, Earth radii. */
  r?: number;
  /** Mass (or M·sin i), Earth masses. */
  m?: number;
  /** What `m` is: "Mass", "Msini", "M-R relationship"… */
  mProv?: string;
  /** Equilibrium temperature, K. */
  teq?: number;
  /** Insolation, Earth units. */
  insol?: number;
  method: string;
  year?: number;
  facility?: string;
}

export interface ExoHostRecord {
  name: string;
  /** Star position codes [ra, dec, dist] — the key that links to the star tile object. */
  key: [number, number, number];
  teff?: number;
  /** Stellar radius / mass in solar units, log10 luminosity (solar). */
  rad?: number;
  mass?: number;
  lum?: number;
  spt?: string;
  /** Age, Gyr. */
  age?: number;
  /** Number of stars in the system; circumbinary flag. */
  stars: number;
  cb: boolean;
  planets: ExoPlanetRecord[];
}

const opt = (v: number, digits = 6): number | undefined => (Number.isFinite(v) ? Number(v.toPrecision(digits)) : undefined);

export function buildExoplanets(store: StarStore, names: NameRegistry): { stats: Record<string, number>; file: { file: string; bytes: number; count: number } } {
  const t = readCsv(rawPath('exo/pscomppars.csv'));
  const c = Object.fromEntries(t.header.map((h, i) => [h, i])) as Record<string, number>;
  const need = ['pl_name', 'hostname', 'gaia_dr3_id', 'hip_name', 'ra', 'dec', 'sy_dist', 'pl_orbper', 'pl_rade'];
  for (const n of need) if (c[n] === undefined) throw new Error(`Exoplanet Archive table is missing column ${n}`);

  const hosts = new Map<string, { rows: string[][] }>();
  for (const r of t.rows) {
    const h = r[c.hostname!]!;
    const e = hosts.get(h);
    if (e) e.rows.push(r);
    else hosts.set(h, { rows: [r] });
  }

  const stats = { planets: 0, hosts: 0, hostsMatchedGaia: 0, hostsMatchedHip: 0, hostsMatchedPosition: 0, hostsAdded: 0, hostsSkippedNoDistance: 0, planetsSkippedNoDistance: 0 };
  const out: ExoHostRecord[] = [];
  for (const [hostname, { rows }] of [...hosts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const r0 = rows[0]!;
    const ra = num(r0[c.ra!]);
    const dec = num(r0[c.dec!]);
    const dist = num(r0[c.sy_dist!]);
    const gmag = num(r0[c.sy_gaiamag!]);
    const vmag = num(r0[c.sy_vmag!]);
    const teff = num(r0[c.st_teff!]);

    let idx = -1;
    const gaia = /(\d{6,})/.exec(r0[c.gaia_dr3_id!] ?? '');
    if (gaia) {
      const hit = store.bySource.get(BigInt(gaia[1]!));
      if (hit !== undefined) {
        idx = hit;
        stats.hostsMatchedGaia++;
      }
    }
    if (idx < 0) {
      const hip = /HIP\s+(\d+)/.exec(r0[c.hip_name!] ?? '');
      const hit = hip ? store.byHip.get(Number(hip[1])) : undefined;
      if (hit !== undefined) {
        idx = hit;
        stats.hostsMatchedHip++;
      }
    }
    if (idx < 0 && Number.isFinite(ra) && Number.isFinite(dec)) {
      const hit = store.findNear(ra, dec, 4, Number.isFinite(gmag) ? gmag : vmag);
      // Require a consistent distance so an unrelated foreground/background star is never adopted.
      if (hit >= 0 && (!(dist > 0) || Math.abs(store.dist[hit]! - dist) / dist < 0.25)) {
        idx = hit;
        stats.hostsMatchedPosition++;
      }
    }
    if (idx < 0) {
      const mag = Number.isFinite(gmag) ? gmag : vmag;
      if (!(dist > 0) || !Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(mag)) {
        stats.hostsSkippedNoDistance++;
        stats.planetsSkippedNoDistance += rows.length;
        continue;
      }
      idx = store.add(ra, dec, dist, mag, Number.isFinite(teff) ? teffToBpRp(teff) : NaN, STAR_SRC_EXO, gaia ? BigInt(gaia[1]!) : 0n);
      if (gaia) store.bySource.set(BigInt(gaia[1]!), idx);
      stats.hostsAdded++;
    }
    store.flags[idx]! |= STAR_FLAG_PLANETS;

    // Make the host searchable under its planet-catalogue name.
    const handle = store.nameHandle[idx]!;
    if (handle >= 0) {
      const e = names.get(handle);
      if (!e.names.includes(hostname)) e.names.push(hostname);
      e.priority = Math.min(e.priority, 1);
    } else {
      store.nameHandle[idx] = names.add({ kind: 's', ds: 'stars', names: [hostname], a: qStarRa(store.ra[idx]!), b: qStarDec(store.dec[idx]!), c: qStarDist(store.dist[idx]!), priority: 1 });
    }

    const planets: ExoPlanetRecord[] = rows
      .map((r) => {
        const p: ExoPlanetRecord = {
          name: r[c.pl_name!]!, letter: r[c.pl_letter!] ?? '', method: r[c.discoverymethod!] ?? '',
          per: opt(num(r[c.pl_orbper!]), 9), a: opt(num(r[c.pl_orbsmax!])), ecc: opt(num(r[c.pl_orbeccen!]), 4), inc: opt(num(r[c.pl_orbincl!]), 5),
          w: opt(num(r[c.pl_orblper!]), 5), r: opt(num(r[c.pl_rade!]), 5), m: opt(num(r[c.pl_bmasse!]), 5), mProv: r[c.pl_bmassprov!] || undefined,
          teq: opt(num(r[c.pl_eqt!]), 5), insol: opt(num(r[c.pl_insol!]), 5), year: opt(num(r[c.disc_year!]), 4), facility: r[c.disc_facility!] || undefined,
        };
        return p;
      })
      .sort((p, q) => (p.a ?? p.per ?? 1e9) - (q.a ?? q.per ?? 1e9) || (p.name < q.name ? -1 : 1));
    out.push({
      name: hostname, key: [qStarRa(store.ra[idx]!), qStarDec(store.dec[idx]!), qStarDist(store.dist[idx]!)],
      teff: opt(teff, 5), rad: opt(num(r0[c.st_rad!]), 4), mass: opt(num(r0[c.st_mass!]), 4), lum: opt(num(r0[c.st_lum!]), 4),
      spt: r0[c.st_spectype!] || undefined, age: opt(num(r0[c.st_age!]), 3), stars: num(r0[c.sy_snum!]) || 1, cb: num(r0[c.cb_flag!]) === 1, planets,
    });
    stats.hosts++;
    stats.planets += planets.length;
  }

  const bytes = zlibSync(new TextEncoder().encode(JSON.stringify(out)), { level: 9, mem: 12 });
  writeFileSync(join(OUT_DIR, 'exoplanets.bin'), bytes);
  console.info(`  ✓ exoplanets: ${stats.planets} planets around ${stats.hosts} host stars (${(bytes.byteLength / 1e3).toFixed(0)} kB)`);
  return { stats, file: { file: 'exoplanets.bin', bytes: bytes.byteLength, count: stats.planets } };
}
