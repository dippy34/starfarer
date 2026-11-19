/**
 * Search: real objects by name, Solar System bodies, confirmed exoplanets,
 * sky coordinates, stable object ids, and free-text "seeds" that always lead
 * to the same procedural galaxy.
 */
import { raDecToUnit } from '../../core/astro';
import { hashString } from '../../core/hash';
import { type UPos, uposFromMeters } from '../../core/hp';
import { Rng } from '../../core/rng';
import { AU, GPC, KPC, LY, MPC, PC } from '../../core/units';
import type { Catalog } from '../../data/catalog';
import { type NameRecord, normalizeName } from '../../data/names';
import { UNIVERSE_RADIUS_MPC, parseGalaxyId } from '../../universe/cosmicWeb';
import { solarSystem } from '../../universe/solarSystem';
import { parseStarId } from '../../universe/starfield';
import type { SearchResult } from '../../ui/actions';

/** What a search result points at; resolved into a target by the mode. */
export type SearchPayload =
  | { kind: 'sol'; body: number }
  | { kind: 'name'; record: NameRecord }
  | { kind: 'exo'; hostKey: [number, number, number]; planet: number; host: string }
  | { kind: 'point'; pos: UPos; label: string }
  | { kind: 'seed'; text: string }
  | { kind: 'galaxyId'; id: string }
  | { kind: 'starId'; id: string };

const UNITS: Record<string, number> = { au: AU, ly: LY, lyr: LY, pc: PC, kpc: KPC, mpc: MPC, gpc: GPC, kly: LY * 1e3, mly: LY * 1e6, gly: LY * 1e9, km: 1000 };

/**
 * Parse sky coordinates such as
 *   "10h 08m 22s +11° 58′ 02″ 79 ly",  "ra 152.09 dec 11.97 24 pc",  "187.70 12.39 16.5 Mpc".
 * Distance is optional (defaults to 100 light-years).
 */
export function parseCoordinates(text: string): { ra: number; dec: number; dist: number } | null {
  let t = text.toLowerCase().replace(/[,;]/g, ' ').replace(/−/g, '-').replace(/\bra\b|\bdec\b|=|:/g, ' ').trim();
  // Trailing "<number> <unit>" = distance.
  let dist = 100 * LY;
  const dm = /(\d+(?:\.\d+)?)\s*(au|ly|lyr|pc|kpc|mpc|gpc|kly|mly|gly|km)\s*$/.exec(t);
  if (dm) {
    dist = Number(dm[1]) * UNITS[dm[2]!]!;
    t = t.slice(0, dm.index).trim();
  }
  // Sexagesimal RA: 10h 08m 22s ; Dec: +11° 58' 02" (or d/m/s letters).
  const sex = /^(\d+(?:\.\d+)?)\s*h\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?\s*([+-]?\d+(?:\.\d+)?)\s*[°d]\s*(?:(\d+(?:\.\d+)?)\s*['′m])?\s*(?:(\d+(?:\.\d+)?)\s*["″s])?$/.exec(t);
  if (sex) {
    const ra = (Number(sex[1]) + Number(sex[2] ?? 0) / 60 + Number(sex[3] ?? 0) / 3600) * 15;
    const sign = sex[4]!.startsWith('-') ? -1 : 1;
    const dec = sign * (Math.abs(Number(sex[4])) + Number(sex[5] ?? 0) / 60 + Number(sex[6] ?? 0) / 3600);
    if (ra >= 0 && ra < 360 && Math.abs(dec) <= 90) return { ra, dec, dist };
    return null;
  }
  // Decimal degrees: two numbers.
  const dec2 = /^([+-]?\d+(?:\.\d+)?)\s*°?\s+([+-]?\d+(?:\.\d+)?)\s*°?$/.exec(t);
  if (dec2) {
    const ra = Number(dec2[1]);
    const dec = Number(dec2[2]);
    if (ra >= 0 && ra < 360 && Math.abs(dec) <= 90) return { ra, dec, dist };
  }
  return null;
}

/** A free-text seed always maps to the same spot of the universe (uniform in volume). */
export function seedPosition(text: string): UPos {
  const rng = new Rng(hashString(`seed:${text.trim().toLowerCase()}`));
  const [x, y, z] = rng.unitVector();
  const r = UNIVERSE_RADIUS_MPC * 0.93 * Math.cbrt(rng.next()) * MPC;
  return uposFromMeters(x * r, y * r, z * r);
}

const KIND_ICON: Record<string, string> = { s: '⭐', g: '🌀', q: '💠', d: '☁️' };
const DSO_ICON: Record<string, [string, string]> = {
  oc: ['✨', 'Open star cluster'], gc: ['✨', 'Globular cluster'], pn: ['🫧', 'Planetary nebula'], en: ['☁️', 'Emission nebula'], rn: ['☁️', 'Reflection nebula'], dn: ['🌑', 'Dark nebula'],
  snr: ['💥', 'Supernova remnant'], psr: ['📡', 'Pulsar'], bh: ['🕳️', 'Black hole'], qso: ['💠', 'Quasar'],
};

export class SearchIndex {
  private exo: Array<{ norm: string; name: string; host: string; hostKey: [number, number, number]; planet: number }> | null = null;

  constructor(private readonly catalog: Catalog) {}

  private exoIndex(): NonNullable<SearchIndex['exo']> {
    if (!this.exo) {
      this.exo = [];
      for (const host of this.catalog.exoHosts.values()) host.planets.forEach((p, i) => this.exo!.push({ norm: normalizeName(p.name), name: p.name, host: host.name, hostKey: host.key, planet: i }));
    }
    return this.exo;
  }

  /** Run a query. `onResults` is called with a quick list first, then the complete one. */
  search(query: string, onResults: (results: SearchResult[], done: boolean) => void): void {
    const q = normalizeName(query);
    const fixed: SearchResult[] = [];
    if (!q) return onResults([], true);

    // Stable ids pasted from the data overlay.
    const raw = query.trim();
    if (parseStarId(raw)) fixed.push({ title: raw, subtitle: 'Star by id', icon: '⭐', payload: { kind: 'starId', id: raw } satisfies SearchPayload });
    else if (parseGalaxyId(raw) || raw === 'mw') fixed.push({ title: raw, subtitle: 'Galaxy by id', icon: '🌀', payload: { kind: 'galaxyId', id: raw } satisfies SearchPayload });

    const coords = parseCoordinates(query);
    if (coords) {
      const u = raDecToUnit(coords.ra, coords.dec);
      fixed.push({
        title: `RA ${coords.ra.toFixed(3)}°, Dec ${coords.dec >= 0 ? '+' : ''}${coords.dec.toFixed(3)}°`, subtitle: 'Fly to these coordinates', icon: '📍',
        payload: { kind: 'point', pos: uposFromMeters(u.x * coords.dist, u.y * coords.dist, u.z * coords.dist), label: 'Coordinates' } satisfies SearchPayload,
      });
    }

    // Solar System.
    const sol = solarSystem();
    sol.bodies.forEach((b, i) => {
      const n = normalizeName(b.name);
      if (n.startsWith(q) || (q.length >= 3 && n.includes(q))) {
        fixed.push({ title: b.name, subtitle: b.kind === 'star' ? 'Our star' : b.kind === 'moon' ? `Moon of ${sol.bodies[b.parent]!.name}` : 'Planet · Solar System', icon: b.kind === 'star' ? '☀️' : b.kind === 'moon' ? '🌙' : '🪐', payload: { kind: 'sol', body: i } satisfies SearchPayload });
      }
    });

    // Confirmed exoplanets.
    if (q.length >= 2) {
      let n = 0;
      for (const e of this.exoIndex()) {
        if (e.norm.startsWith(q) || (q.length >= 4 && e.norm.includes(q))) {
          fixed.push({ title: e.name, subtitle: `Exoplanet of ${e.host}`, icon: '🪐', payload: { kind: 'exo', hostKey: e.hostKey, planet: e.planet, host: e.host } satisfies SearchPayload });
          if (++n >= 8) break;
        }
      }
    }

    const seed: SearchResult = { title: `“${raw}”`, subtitle: 'Use as a seed — the galaxy this word leads to', icon: '🎲', payload: { kind: 'seed', text: raw } satisfies SearchPayload };
    const toResults = (hits: Awaited<ReturnType<Catalog['names']['search']>>): SearchResult[] => {
      const named = hits.map((h) => {
        const r = h.record;
        let icon = KIND_ICON[r.kind] ?? '•';
        let subtitle = r.kind === 's' ? 'Star' : r.kind === 'g' ? 'Galaxy' : 'Deep-sky object';
        if (r.kind === 'd') {
          const d = this.catalog.dso[r.a];
          if (d) [icon, subtitle] = DSO_ICON[d.t] ?? [icon, subtitle];
        }
        const alias = h.matched !== r.names[0] ? ` · ${h.matched}` : '';
        return { title: r.names[0]!, subtitle: subtitle + alias, icon, payload: { kind: 'name', record: r } satisfies SearchPayload };
      });
      // Exact name matches first, then Solar System / exoplanets, the rest of the catalogue, and finally the seed.
      const exact = named.filter((_, i) => hits[i]!.score < 1);
      const rest = named.filter((_, i) => hits[i]!.score >= 1);
      return [...exact, ...fixed, ...rest, seed].slice(0, 40);
    };
    void this.catalog.names
      .search(query, 30, (partial) => onResults(toResults(partial), false))
      .then((hits) => onResults(toResults(hits), true))
      .catch(() => onResults([...fixed, seed], true));
  }
}
