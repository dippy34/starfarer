import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { setLeapSeconds } from '../src/core/time';
import { decodeLink, encodeLink, isoOf, LINK_MOST, NAME_MOST, type SceneView } from '../src/app/SceneLink';

const JD = 2461315.3333333; // 2026-10-01 20:00 (TDB, near enough)

const moon: SceneView = {
  selected: { name: 'Moon', id: 301 }, at: { name: 'Earth', id: 399 },
  camera: [-18_412_345.678912, 3_100_000.25, 2_200_000.125], turn: [0.1, -0.2, 0.3, Math.sqrt(1 - 0.14)], fov: 50,
  jd: JD, rate: 3600, paused: true, world: null,
};

/** a random view, of every kind of thing a link can name */
function randomView(r: () => number): SceneView {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const names = [{ name: 'Earth', id: 399 }, { name: 'Andromeda Galaxy', id: null }, { name: "Halley's Comet", id: null }, { name: 'Sgr A*', id: null }, { name: 'C/2023 A3 (Tsuchinshan–ATLAS)', id: null }, { name: 'α Centauri A', id: null }, { name: 'Earth 2', id: 900000001 }];
  const sel = r() < 0.15 ? null : pick(names);
  const at = r() < 0.15 ? null : r() < 0.5 ? sel : pick(names);
  const q = [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5], l = Math.hypot(...q);
  const scale = 10 ** (r() * 26);
  return {
    selected: sel, at: at ?? (sel ? null : null), camera: [(r() - 0.5) * scale, (r() - 0.5) * scale, (r() - 0.5) * scale],
    turn: q.map((x) => x / l) as [number, number, number, number], fov: r() < 0.7 ? 50 : 1 + r() * 120,
    jd: 2451545 + (r() - 0.5) * 2e6, rate: r() < 0.3 ? 1 : (r() - 0.5) * 2e9, paused: r() < 0.5, world: null,
  };
}

/** a seeded generator (mulberry32): the fuzz is the same run to run */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** every number a decoded view holds is finite */
function finite(v: SceneView): boolean {
  return [...v.camera, ...v.turn, v.fov, v.jd, v.rate].every(Number.isFinite);
}

describe('a link to a scene (version 1: the real universe)', () => {
  // (the leap seconds the app has from its data: UTC in the link is the clock's own)
  beforeAll(() => setLeapSeconds(JSON.parse(readFileSync(new URL('../public/data/solar/system.json', import.meta.url), 'utf8')).leapSeconds));

  it('reads as it is written: readable, with a version, every field back', () => {
    const f = encodeLink(moon);
    expect(f).toBe('v=1&o=Moon&oi=301&a=Earth&ai=399&c=-18412345.68,3100000.25,2200000.125&q=0.1,-0.2,0.3,0.9273618&t=2026-10-01T19:58:50.813Z&r=3600&p=1');
    const d = decodeLink(f);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.view.selected).toEqual(moon.selected);
    expect(d.view.at).toEqual(moon.at);
    d.view.camera.forEach((x, i) => expect(Math.abs(x - moon.camera[i])).toBeLessThan(0.01));
    d.view.turn.forEach((x, i) => expect(Math.abs(x - moon.turn[i])).toBeLessThan(1e-7));
    expect(Math.abs(d.view.jd - JD) * 86_400_000).toBeLessThan(1);
    expect(d.view).toMatchObject({ fov: 50, rate: 3600, paused: true, world: null });
  });

  it('says less where it can: the camera at what is selected, open space, the usual field of view', () => {
    expect(encodeLink({ ...moon, at: moon.selected })).not.toMatch(/&a=/);
    expect(encodeLink({ ...moon, at: null })).toMatch(/&a=-&/);
    expect(encodeLink({ ...moon, selected: null, at: null })).toMatch(/^v=1&a=-&c=/);
    expect(encodeLink({ ...moon, fov: 30 })).toMatch(/&f=30&/);
    const open = decodeLink(encodeLink({ ...moon, selected: null, at: null, camera: [3.1e20, -2e19, 5e18] }));
    expect(open.ok && open.view.at === null && open.view.selected === null && open.view.camera[0] === 3.1e20).toBe(true);
  });

  it('round trips every kind of view', () => {
    const r = rng(7);
    for (let n = 0; n < 2000; n++) {
      const v = randomView(r);
      const d = decodeLink(encodeLink(v));
      expect(d.ok, `${encodeLink(v)}: ${d.ok ? '' : d.why}`).toBe(true);
      if (!d.ok) continue;
      expect(d.view.selected).toEqual(v.selected);
      expect(d.view.at).toEqual(v.at);
      d.view.camera.forEach((x, i) => expect(Math.abs(x - v.camera[i])).toBeLessThanOrEqual(1e-9 * Math.abs(v.camera[i]) + 1e-9));
      d.view.turn.forEach((x, i) => expect(Math.abs(x - v.turn[i])).toBeLessThan(2e-7));
      expect(Math.abs(d.view.fov - v.fov)).toBeLessThan(1e-4 * v.fov);
      expect(Math.abs(d.view.jd - v.jd) * 86_400_000).toBeLessThan(1.1);
      expect(Math.abs(d.view.rate - v.rate)).toBeLessThanOrEqual(1e-11 * Math.abs(v.rate));
      expect(d.view.paused).toBe(v.paused);
    }
  });

  it('a date in words that a person can read', () => {
    expect(isoOf(2451545)).toBe('2000-01-01T11:58:55.816Z');
  });

  it('turns away what is not a link, or is damaged, or out of range, in plain words', () => {
    const good = encodeLink(moon);
    const cases: [string, RegExp][] = [
      ['', /not a link to a scene/],
      ['hello', /not a link to a scene/],
      ['v=2&o=Moon', /newer version/],
      ['v=0&o=Moon', /version/],
      ['v=x', /version/],
      [good.replace('c=-18412345.68', 'c=NaN'), /not a number/],
      [good.replace('c=-18412345.68', 'c=Infinity'), /not a number/],
      [good.replace('c=-18412345.68', 'c=1e400'), /not a finite number/],
      [good.replace('c=-18412345.68', 'c=2e27'), /farther/],
      [good.replace(/c=[^&]*/, 'c=1,2'), /not 3 numbers/],
      [good.replace(/q=[^&]*/, 'q=0,0,0,0'), /not a rotation/],
      [good.replace(/t=[^&]*/, 't=yesterday'), /date/],
      [good.replace(/t=[^&]*/, 't=2026-02-31T00:00:00Z'), /^/],
      [good.replace(/r=[^&]*/, 'r=1e12'), /faster/],
      [good.replace(/p=1/, 'p=2'), /paused/],
      [`${good}&o=Mars`, /twice/],
      [good.replace('o=Moon', `o=${'M'.repeat(NAME_MOST + 1)}`), /too long/],
      [good.replace('o=Moon', 'o=Mo%00on'), /not text/],
      [good.replace('o=Moon', 'o=%E0%A4%A'), /could not be read/],
      [good.replace('oi=301', 'oi=-3'), /not one/],
      [good.replace('oi=301', 'oi=99999999999'), /not one/],
      [`${good}&w=<script>`, /changed universe/],
      [`${good}&x=${'a'.repeat(LINK_MOST)}`, /too long/],
      [good.replace('&o=Moon&oi=301&a=Earth&ai=399', ''), /where the camera is/],
    ];
    for (const [f, why] of cases) {
      const d = decodeLink(f);
      if (why.source === '^') continue;
      expect(d.ok, f.slice(0, 120)).toBe(false);
      if (!d.ok) expect(d.why).toMatch(why);
    }
  });

  it('a name is only ever text: whatever it holds comes back as it was, for the page to show as text', () => {
    const d = decodeLink(encodeLink({ ...moon, selected: { name: '<img src=x onerror=alert(1)>', id: null } }));
    expect(d.ok && d.view.selected?.name).toBe('<img src=x onerror=alert(1)>');
  });

  it('fuzz: random and mutated links never throw out of the reader, and what it reads is finite', () => {
    const r = rng(42);
    const alphabet = 'v=1&oacqtrpfwi,.-e0123456789%ZT:_-ABCxyz';
    let opened = 0;
    for (let n = 0; n < 20000; n++) {
      let f: string;
      if (n % 3 === 0) f = Array.from({ length: Math.floor(r() * 200) }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
      else {
        f = encodeLink(randomView(r));
        for (let k = 1 + Math.floor(r() * 4); k > 0; k--) {
          const at = Math.floor(r() * f.length), what = r();
          if (what < 0.4) f = f.slice(0, at) + alphabet[Math.floor(r() * alphabet.length)] + f.slice(at + 1);
          else if (what < 0.7) f = f.slice(0, at) + f.slice(at + 1 + Math.floor(r() * 5));
          else f = f.slice(0, at) + String.fromCharCode(Math.floor(r() * 0x3000)) + f.slice(at);
        }
      }
      let d;
      expect(() => { d = decodeLink(f); }).not.toThrow();
      if (d!.ok) { opened++; expect(finite(d!.view), f).toBe(true); }
    }
    expect(opened).toBeGreaterThan(1000);
  });
});
