import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import { decodeWorld, encodeWorld } from '../src/app/SceneWorld';
import {
  amountWords, BROWN_DWARF_FROM, canAdd, HOLE_BASE, MADE_FIRST_ID, MADE_MASS, madeAgain, madeMassAt, madeSize, madeSlider, madeWords, massUnit, newHole, newMoon, newTwin, newWorld,
  SIZE_BY_HAND, STAR_FROM, takeMass, takeRadius, typedRange, typeFor, WORLD_KINDS,
} from '../src/app/WhatIf';
import { M_EARTH, M_JUPITER, M_SUN, mainSequence, R_EARTH, R_JUPITER, R_SUN } from '../src/sim/physics';
import { SolarSystem } from '../src/universe/SolarSystem';

const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;
const JD = 2461300.5;

describe('make anything, with any numbers: the ranges and the slider', () => {
  it('a planet and a moon run from a millionth of an Earth to 10,000 Earths, a star from 0.08 to 150 Suns, a black hole from 1 Sun to 10 billion', () => {
    for (const kind of ['moon', 'earth', 'jupiter', ...WORLD_KINDS] as const) expect(MADE_MASS[kind]).toEqual([1e-6 * M_EARTH, 1e4 * M_EARTH]);
    expect(MADE_MASS.sun).toEqual([0.08 * M_SUN, 150 * M_SUN]);
    expect(MADE_MASS.hole).toEqual([M_SUN, 1e10 * M_SUN]);
  });

  it('the slider is even in the logarithm over the whole range: its ends, its middle, and back from any mass', () => {
    for (const kind of ['terran', 'sun', 'hole', 'moon'] as const) {
      const [lo, hi] = MADE_MASS[kind], base = 1.234 * lo * 10;
      expect(madeMassAt(kind, 0, base)).toBe(lo);
      expect(madeMassAt(kind, 1, base) / hi).toBeCloseTo(1, 12);
      expect(madeMassAt(kind, 0.5, 0) / Math.sqrt(lo * hi)).toBeCloseTo(1, 12);
      for (const s of [0.1, 0.37, 0.9]) expect(madeSlider(kind, madeMassAt(kind, s, base))).toBeCloseTo(s, 10);
    }
    // an Earth is 6 of the 10 decades of a planet's slider (a millionth to 10,000: 10 decades)
    expect(madeSlider('terran', M_EARTH)).toBeCloseTo(0.6, 12);
  });

  it('Add offers four choices: a planet, a star, a black hole round a star, and a moon round a planet', async () => {
    const sys = await SolarSystem.load('/data');
    await sys.ephemeris.request(JD);
    sys.update(JD);
    const named = (n: string) => sys.bodies.find((b) => b.name === n)!;
    expect(canAdd(named('Sun'), 0)).toEqual(['planet', 'star', 'hole']);
    expect(canAdd(named('Earth'), 0)).toEqual(['moon']);
    expect(canAdd(named('Pluto'), 0)).toEqual(['moon']);
    expect(canAdd(named('Moon'), 0)).toEqual([]);
  });
});

describe('a typed mass', () => {
  it('is parsed in Earths for a planet and a moon, and in Suns for a star and a black hole (commas, spaces and the unit are allowed)', () => {
    expect(takeMass('1,000', 'giant')).toEqual({ kg: 1000 * M_EARTH });
    expect(takeMass(' 2.5 Earths ', 'terran')).toEqual({ kg: 2.5 * M_EARTH });
    expect(takeMass('1e-6', 'moon')).toEqual({ kg: 1e-6 * M_EARTH });
    expect(takeMass('0.5', 'sun')).toEqual({ kg: 0.5 * M_SUN });
    expect(takeMass('150 suns', 'sun')).toEqual({ kg: 150 * M_SUN });
    expect(takeMass('1e10', 'hole')).toEqual({ kg: 1e10 * M_SUN });
    expect(takeMass('1', 'hole')).toEqual({ kg: M_SUN });
    expect(massUnit('hole').name).toBe('Suns');
    expect(massUnit('ocean').name).toBe('Earths');
  });

  it('is refused, with its line, when it is not a number or out of range', () => {
    expect(takeMass('abc', 'terran')).toEqual({ why: 'Type a number of Earths' });
    expect(takeMass('', 'sun')).toEqual({ why: 'Type a number of Suns' });
    expect(takeMass('-3', 'terran')).toEqual({ why: 'Type a number of Earths' });
    expect(takeMass('0', 'terran')).toHaveProperty('why');
    expect(takeMass('0.0000001', 'terran')).toEqual({ why: 'From a millionth of an Earth to 49,940,000 Earths (past 10,000 it is a brown dwarf or a star)' });
    expect(takeMass('0.07', 'sun')).toEqual({ why: 'A star is from 0.08 to 150 Suns' });
    expect(takeMass('151', 'sun')).toEqual({ why: 'A star is from 0.08 to 150 Suns' });
    expect(takeMass('0.5', 'hole')).toEqual({ why: 'A black hole is from 1 Sun to 10 billion Suns' });
    expect(takeMass('1e11', 'hole')).toHaveProperty('why');
    expect(takeMass('1e8', 'terran')).toHaveProperty('why');
  });

  it('a planet may be typed past its slider, up to the heaviest star: 30,000 Earths is taken (and is a star)', () => {
    expect(typedRange('giant')).toEqual([1e-6 * M_EARTH, 150 * M_SUN]);
    const t = takeMass('30000', 'giant');
    expect('kg' in t && t.kg >= STAR_FROM).toBe(true);
  });

  it('is shown to four figures with thousands set apart', () => {
    expect(amountWords(1000)).toBe('1,000');
    expect(amountWords(1e-6)).toBe('0.000001');
    expect(amountWords(1.23456)).toBe('1.235');
    expect(amountWords(1e10)).toBe('10,000,000,000');
  });
});

describe('what it is at that mass', () => {
  it('1,000 Earths is a giant of gas, Jupiter\'s size; past 13 Jupiters (4,131 Earths) any planet is a brown dwarf; past 0.08 Suns it is a star of the main sequence', () => {
    expect(typeFor(1000 * M_EARTH)).toBe('giant');
    expect(madeSize('giant', 1000 * M_EARTH, false)).toEqual({ radius: R_JUPITER, rule: 'giant' });
    expect(madeWords('giant', 1000 * M_EARTH, false)).toEqual({ mass: '3.1 Jupiters', what: "A gas giant, Jupiter's size" });
    for (const kind of WORLD_KINDS) {
      expect(madeSize(kind, 14 * M_JUPITER, false)).toEqual({ radius: R_JUPITER, rule: 'brown dwarf' });
      expect(madeWords(kind, 14 * M_JUPITER, false).what).toBe("A brown dwarf, Jupiter's size");
      expect(madeSize(kind, BROWN_DWARF_FROM - 1e24, false).rule).toBe('giant');
    }
    const star = madeSize('sun', 30_000 * M_EARTH, false), ms = mainSequence((30_000 * M_EARTH) / M_SUN);
    expect(star.rule).toBe('star');
    expect(star.radius).toBe(ms.radius.value);
    expect(star.radius / R_SUN).toBeCloseTo(Math.pow(0.0900, 0.8), 2);
    expect(star.teff).toBe(ms.teff.value);
    expect(madeWords('sun', 30_000 * M_EARTH, false).what).toMatch(/^A star, 0\.\d+ times the Sun's size, [\d,]+ K$/);
    expect(madeSize('sun', 150 * M_SUN, false).lum).toBeGreaterThan(1e6);
  });

  it('the type follows the mass until picked: rocky to 2 Earths, an ice giant to 50, a gas giant beyond', () => {
    expect(typeFor(1e-6 * M_EARTH)).toBe('terran');
    expect(typeFor(M_EARTH)).toBe('terran');
    expect(typeFor(2 * M_EARTH)).toBe('terran');
    expect(typeFor(2.1 * M_EARTH)).toBe('icegiant');
    expect(typeFor(14.5 * M_EARTH)).toBe('icegiant');
    expect(typeFor(50 * M_EARTH)).toBe('icegiant');
    expect(typeFor(51 * M_EARTH)).toBe('giant');
    expect(typeFor(M_JUPITER)).toBe('giant');
  });

  it('a size follows the mass by the rule whatever the look, and a rocky look at the Earth\'s mass is the Earth\'s size, as before', () => {
    expect(madeSize('terran', M_EARTH, false).radius).toBe(R_EARTH);
    // (the same mass, the same size, from 10 Earths up, whichever look it was given)
    for (const kind of WORLD_KINDS.filter((k) => k !== 'icegiant')) expect(madeSize(kind, 100 * M_EARTH, false).radius).toBe(madeSize('giant', 100 * M_EARTH, false).radius);
    // (and always finite and positive across the whole range)
    for (const kind of WORLD_KINDS) for (let k = 0; k <= 20; k++) {
      const r = madeSize(kind, MADE_MASS[kind][0] * (MADE_MASS[kind][1] / MADE_MASS[kind][0]) ** (k / 20), false).radius;
      expect(Number.isFinite(r) && r > 0).toBe(true);
    }
  });

  it('a size set by hand: in Earth radii from a thousandth to 30, said as set by you; out of range is refused', () => {
    expect(takeRadius('2')).toEqual({ radius: 2 * R_EARTH });
    expect(takeRadius('0.001 radii')).toEqual({ radius: 0.001 * R_EARTH });
    expect(takeRadius('30')).toEqual({ radius: 30 * R_EARTH });
    expect(takeRadius('31')).toEqual({ why: 'From a thousandth of an Earth radius to 30' });
    expect(takeRadius('0.0005')).toEqual({ why: 'From a thousandth of an Earth radius to 30' });
    expect(takeRadius('big')).toEqual({ why: 'Type a size in Earth radii' });
    expect(SIZE_BY_HAND).toEqual([1e-3, 30]);
    expect(madeWords('giant', 1000 * M_EARTH, false, 3 * R_EARTH).what).toBe("A gas giant, 3 times the Earth's size, set by you");
    expect(madeWords('moon', 1e20, false, 0.05 * R_EARTH).what).toBe("A moon, 0.05 times the Earth's size, set by you");
  });
});

describe('kept in a save', () => {
  it('a planet of 1,000 Earths with a size set by hand, a star, a black hole of ten billion Suns, a tiny moon: the bytes bring each back, kind, mass and size', async () => {
    const sys = await SolarSystem.load('/data');
    await sys.ephemeris.request(JD);
    sys.update(JD);
    const sun = sys.sun, earth = sys.bodies.find((b) => b.name === 'Earth')!, look = { albedo: 0.3, color: [0.5, 0.5, 0.5] as [number, number, number] };
    const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
    const eye = [1.5e11, 4e10, 0];
    const gas = newWorld('giant', sun, eye, 0, MADE_FIRST_ID, 4242, look);
    const star = newTwin(sun, null, sun, [3e11, 4e10, 0], 0, MADE_FIRST_ID + 1);
    const hole = newHole(sun, [8e11, 4e10, 0], 0, MADE_FIRST_ID + 2);
    const moon = newMoon(earth, [4e8, 0, 0], 1.5e11, 0, MADE_FIRST_ID + 3);
    const made = [gas, star, hole, moon].map((p) => physics.make(p.json, p === moon ? earth : sun, p.pos, p.vel, JD, 'made'));
    physics.resize(made[0], 6.6743e-11 * 1000 * M_EARTH, [3 * R_EARTH, 3 * R_EARTH, 3 * R_EARTH], JD);
    (made[0].meta.madeAs as { kg: number }).kg = 1000 * M_EARTH;
    physics.resize(made[1], 6.6743e-11 * 30_000 * M_EARTH, [R_SUN, R_SUN, R_SUN], JD);
    Object.assign(made[1].meta.madeAs as object, { kind: 'sun', kg: 30_000 * M_EARTH });
    physics.resize(made[2], 6.6743e-11 * 1e10 * M_SUN, [2.95e13, 2.95e13, 2.95e13], JD);
    Object.assign(made[2].meta.madeAs as object, { kg: 1e10 * M_SUN });
    const world = physics.world()!;
    for (const m of world.made) m.seed = (sys.byId.get(m.id)!.meta.madeAs as { seed?: number }).seed;
    const back = decodeWorld(encodeWorld(world));
    expect(back.made.map((m) => m.kind)).toEqual(['giant', 'sun', 'hole', 'moon']);
    expect(back.made[0].kg).toBe(1000 * M_EARTH);
    expect(back.made[0].radius).toBeCloseTo(3 * R_EARTH, 0);
    expect(back.made[0].seed).toBe(4242);
    expect(back.made[1].kg).toBe(30_000 * M_EARTH);
    expect(back.made[2].kg).toBe(1e10 * M_SUN);
    expect(back.made[2].radius).toBeCloseTo(2.95e13, -8);
    expect(back.made[3].kind).toBe('moon');
    // made again on another device: the same masses and sizes
    const other = await SolarSystem.load('/data');
    await other.ephemeris.request(JD);
    other.update(JD);
    const p2 = new LivePhysics(other, { left: () => undefined, dropped: () => undefined });
    p2.adoptWorld(back, (m) => madeAgain(m, other.byId.get(m.home)!, m.kind === 'sun' ? other.byId.get(10)! : null, null, WORLD_KINDS.includes(m.kind as never) ? look : null));
    expect(other.byId.get(MADE_FIRST_ID)!.radius).toBeCloseTo(3 * R_EARTH, 0);
    expect(other.byId.get(MADE_FIRST_ID + 2)!.gm / 6.6743e-11 / M_SUN / 1e10).toBeCloseTo(1, 6);
    expect(HOLE_BASE).toBe(10 * M_SUN);
  }, 120_000);
});
