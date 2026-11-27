import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import type { MadeRecord } from '../src/app/SceneWorld';
import {
  canAdd, EARTH_DENSITY, GIANT_FROM, MADE_FIRST_ID, MADE_MASS, MADE_MOST, madeAbsMag, madeAgain, madeMassAt, madeSize, madeSlider, madeWords, madeWorking,
  newMoon, newTwin, newWorld, type Plan, ROCKY_MOST, STAR_FROM, WORLD_BASE, WORLD_KINDS, WORLD_NAME,
} from '../src/app/WhatIf';
import { workedOut } from '../src/app/Worked';
import { OBLIQUITY_J2000 } from '../src/core/frames';
import { SimClock } from '../src/core/time';
import { AU } from '../src/core/units';
import { G, M_EARTH, M_JUPITER, M_SUN, mainSequence, R_EARTH, R_JUPITER, R_SUN } from '../src/sim/physics';
import type { Body } from '../src/universe/Body';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it: its catalogue and the JPL ephemeris, read from public/ as the browser fetches them.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const DAY = 86_400;
const JD = 2461300.5; // 2026-09-17 (TDB)

async function setup() {
  const sys = await SolarSystem.load('/data');
  await sys.ephemeris.request(JD);
  sys.update(JD);
  const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
  const clock = new SimClock(JD);
  const named = (name: string) => sys.bodies.find((b) => b.name === name)!;
  /** run the clock on by `days` as the app's frames do */
  const run = (days: number, step = 0.02) => {
    const to = clock.jdTdb + days;
    for (let n = 0; to - clock.jdTdb > 1e-9 && n < 1e6; n++) {
      clock.jdTdb = Math.min(to, clock.jdTdb + step);
      physics.follow(clock, 1);
      sys.update(clock.jdTdb);
      physics.place(clock.jdTdb);
    }
  };
  const make = (plan: Plan, about: Body) => physics.make(plan.json, about, plan.pos, plan.vel, clock.jdTdb, `${plan.json.name} is new.`);
  return { sys, physics, clock, named, run, make };
}

const from = (b: Body, a: Body) => b.pos.clone().sub(a.pos);
/** the way a body turns about another: the direction of its angular momentum about it */
const turning = (b: Body, a: Body) => from(b, a).cross(b.vel.clone().sub(a.vel)).normalize();
const ECLIPTIC_NORTH = new Vector3(0, -Math.sin(OBLIQUITY_J2000), Math.cos(OBLIQUITY_J2000));

describe('what can be added to a world', () => {
  it('a moon to a planet or a dwarf planet; a planet or another sun to a star; nothing to a moon, and nothing where there is no room', async () => {
    const { named } = await setup();
    expect(canAdd(named('Earth'), 0)).toEqual(['moon']);
    expect(canAdd(named('Pluto'), 0)).toEqual(['moon']);
    expect(canAdd(named('Sun'), 0)).toEqual(['earth', 'jupiter', 'sun', ...WORLD_KINDS]);
    expect(canAdd(named('Moon'), 0)).toEqual([]);   // a moon of a moon: not yet
    expect(canAdd(named('Earth'), MADE_MOST)).toEqual([]);
    expect(canAdd(named('Sun'), MADE_MOST)).toEqual([]);
  });
});

describe('a moon made for a world', () => {
  it('is sized to its planet, of rock near the Sun and of ice far out, and goes round as Kepler says', async () => {
    const { named } = await setup();
    const earth = named('Earth'), jupiter = named('Jupiter');
    const m = newMoon(earth, [5 * earth.radius, 0, 0], AU, 0, MADE_FIRST_ID);
    const radius = m.json.radii![0] * 1e3;
    expect(m.json.name).toBe("Earth's new moon");
    expect(radius).toBeCloseTo(0.12 * earth.radius, 0);
    // rock: 3 g/cm³
    expect((m.json.gm! * 1e9) / G / ((4 / 3) * Math.PI * radius ** 3)).toBeCloseTo(3000, 6);
    expect(m.json.albedo).toBeLessThan(0.2);
    // Kepler's third law with the planet's mass and its own
    expect(m.periodDays * DAY).toBeCloseTo(2 * Math.PI * Math.sqrt(m.orbit ** 3 / (earth.gm + m.json.gm! * 1e9)), 6);
    // the second for the same planet has a name of its own
    expect(newMoon(earth, [5 * earth.radius, 0, 0], AU, 1, MADE_FIRST_ID + 1).json.name).toBe("Earth's new moon 2");
    // Jupiter's: no bigger than our Moon, and of ice
    const j = newMoon(jupiter, [10 * jupiter.radius, 0, 0], 5.2 * AU, 0, MADE_FIRST_ID + 2);
    expect(j.json.radii![0]).toBe(1800);
    expect(j.json.albedo).toBeGreaterThan(0.4);
  });

  it('is put between the planet and the eye where there is room: never inside the Roche limit, never out of reach', async () => {
    const { named } = await setup();
    const earth = named('Earth'), R = earth.radius;
    const at = (eye: number) => newMoon(earth, [0, eye * R, 0], AU, 0, MADE_FIRST_ID).orbit / R;
    expect(at(10)).toBeCloseTo(5.5, 6);
    // from close by: clear of the Roche limit of a rocky moon about the Earth (2.44 R (5.51 / 3)^(1/3) = 2.99 R)
    expect(at(1.2)).toBeGreaterThan(3);
    expect(at(1.2)).toBeLessThan(3.4);
    // from far away: still a moon of the planet
    expect(at(5000)).toBeCloseTo(60, 9);
  });

  it('joins the system simulated: where the eye looks, in the plane of the equator, on a circle the way the planet turns', async () => {
    const { sys, physics, named, run, make } = await setup();
    const earth = named('Earth');
    const before = sys.bodies.length;
    expect(physics.on).toBe(false);
    // the eye: 8 radii out, well off the equator
    const o = earth.orientation.elements, pole = new Vector3(o[8], o[9], o[10]);
    const eye = new Vector3(1, 0.3, 0).cross(pole).normalize().addScaledVector(pole, 0.5).multiplyScalar(8 * earth.radius);
    const plan = newMoon(earth, eye.toArray(), AU, 0, MADE_FIRST_ID);
    const moon = make(plan, earth);
    // making something is a change: physics is live from now, and the new moon is in it
    expect(physics.on).toBe(true);
    expect(physics.simulated(moon)).toBe(true);
    expect(sys.bodies.length).toBe(before + 1);
    expect(moon.parent).toBe(earth);
    const rel = from(moon, earth);
    expect(rel.length() / plan.orbit).toBeCloseTo(1, 9);
    expect(Math.abs(rel.clone().normalize().dot(pole))).toBeLessThan(1e-9);
    // (on the eye's side: the eye's direction, less what of it is along the pole)
    expect(rel.clone().normalize().dot(eye.clone().addScaledVector(pole, -eye.dot(pole)).normalize())).toBeCloseTo(1, 9);
    expect(moon.vel.clone().sub(earth.vel).length()).toBeCloseTo(Math.sqrt((earth.gm + moon.gm) / plan.orbit), 3);
    expect(turning(moon, earth).dot(pole)).toBeCloseTo(1, 9);
    // what is worked out for it is worked out as for any moon, and it says it was made
    const year = workedOut(moon).find((w) => w.label === 'Once round Earth')!;
    expect(year.math).toContain('P = 2π√(a³ / G(M + m))');
    expect(moon.info()[0]).toEqual(['Type', 'Moon (made by you)']);
    expect(physics.log.map((e) => e.text)).toContain("Earth's new moon is new.");
    // a quarter of its period later it is a quarter of the way round, still near that plane
    const d0 = rel.clone().normalize();
    run(plan.periodDays / 4, plan.periodDays / 400);
    const later = from(moon, earth);
    expect(later.length() / plan.orbit).toBeCloseTo(1, 2);
    expect(Math.abs(later.clone().normalize().dot(d0))).toBeLessThan(0.02);
    expect(Math.abs(later.clone().normalize().dot(pole))).toBeLessThan(0.01);
  });

  it('goes round a planet that turns backwards the way that planet turns: with the moons it has', async () => {
    const { named, make } = await setup();
    const uranus = named('Uranus'), titania = named('Titania');
    const moon = make(newMoon(uranus, [10 * uranus.radius, 0, 0], 19 * AU, 0, MADE_FIRST_ID), uranus);
    expect(turning(moon, uranus).dot(turning(titania, uranus))).toBeGreaterThan(0.99);
  });
});

describe('a planet or a sun made for a star', () => {
  it('is the catalogue\'s Jupiter over again, on a circle in the plane of the planets, the way they go', async () => {
    const { named } = await setup();
    const sun = named('Sun'), jupiter = named('Jupiter'), earth = named('Earth');
    // (whatever has been done to the real one's mass since: the copy is the catalogue's)
    const real = jupiter.gm;
    jupiter.gm *= 3;
    const p = newTwin(jupiter, 'jupiter', sun, [3 * AU, 4 * AU, 1 * AU], 0, MADE_FIRST_ID);
    jupiter.gm = real;
    expect(p.json).toMatchObject({ name: 'Jupiter 2', type: 'planet', parent: 10, made: true, twinOf: 599, texture: 'jupiter', ephem: { kind: 'placed' } });
    expect(p.json.gm! * 1e9).toBe(real);
    expect(p.json.radii).toEqual([71492, 71492, 66854]);
    expect(p.json.systemGm).toBeUndefined();
    expect(newTwin(jupiter, 'jupiter', sun, [AU, 0, 0], 1, MADE_FIRST_ID + 1).json.name).toBe('Jupiter 3');
    // 0.55 of the way to the eye, in the plane of the planets, on the eye's side
    const eye = new Vector3(3 * AU, 4 * AU, 1 * AU), pos = new Vector3(...p.pos), vel = new Vector3(...p.vel);
    expect(p.orbit).toBeCloseTo(0.55 * eye.length(), 0);
    expect(pos.length()).toBeCloseTo(p.orbit, 0);
    expect(Math.abs(pos.clone().normalize().dot(ECLIPTIC_NORTH))).toBeLessThan(1e-12);
    expect(pos.clone().normalize().dot(eye.clone().addScaledVector(ECLIPTIC_NORTH, -eye.dot(ECLIPTIC_NORTH)).normalize())).toBeCloseTo(1, 12);
    // a circle: the speed Kepler gives it there, across the line to the star, turning as the Earth does
    expect(vel.length()).toBeCloseTo(Math.sqrt((sun.gm + real) / p.orbit), 6);
    expect(Math.abs(vel.dot(pos)) / (vel.length() * pos.length())).toBeLessThan(1e-12);
    expect(pos.clone().cross(vel).normalize().dot(turning(earth, sun))).toBeGreaterThan(0.999);
    expect(p.periodDays * DAY).toBeCloseTo(2 * Math.PI * Math.sqrt(p.orbit ** 3 / (sun.gm + real)), 3);
  });

  it('keeps its distance from the star: a planet no nearer than a tenth of the Earth\'s, a sun than three tenths, nothing beyond the planets', async () => {
    const { named } = await setup();
    const sun = named('Sun'), at = (like: string, eye: number) => newTwin(named(like), null, sun, [0, eye * AU, 0], 0, MADE_FIRST_ID).orbit / AU;
    expect(at('Earth', 0.03)).toBeCloseTo(0.1, 9);
    expect(at('Sun', 0.03)).toBeCloseTo(0.3, 9);
    expect(at('Earth', 2)).toBeCloseTo(1.1, 9);
    expect(at('Jupiter', 1000)).toBeCloseTo(60, 9);
    // an eye straight over the star's pole is on no side of it: the planet is put somewhere on its circle all the same
    const over = newTwin(named('Earth'), null, sun, ECLIPTIC_NORTH.clone().multiplyScalar(4 * AU).toArray(), 0, MADE_FIRST_ID);
    expect(Math.hypot(...over.pos) / AU).toBeCloseTo(2.2, 9);
    expect(Math.abs(new Vector3(...over.pos).dot(ECLIPTIC_NORTH)) / AU).toBeLessThan(1e-9);
  });

  it('a second Jupiter is a giant planet like the first, goes round the Sun where it was put, and can be given a moon', async () => {
    const { sys, physics, named, run, make } = await setup();
    const sun = named('Sun'), jupiter = named('Jupiter');
    const plan = newTwin(jupiter, 'jupiter', sun, [0, 5 * AU, 0], 0, MADE_FIRST_ID);
    const twin = make(plan, sun);
    expect(twin.name).toBe('Jupiter 2');
    expect([twin.kind, twin.twinOf, twin.nature, twin.isGasGiant, twin.isAirless]).toEqual(['planet', jupiter, 'Jupiter', true, false]);
    expect([twin.gm, twin.radius, twin.texture]).toEqual([jupiter.gm, jupiter.radius, 'jupiter']);
    expect(twin.info()[0]).toEqual(['Type', 'Planet (made by you)']);
    expect(physics.simulated(twin)).toBe(true);
    expect(twin.parent).toBe(sun);
    expect(canAdd(twin, 1)).toEqual(['moon']);
    const d0 = from(twin, sun).normalize();
    // half its period later it is on the other side of the Sun, at the distance it was put at
    run(plan.periodDays / 2, plan.periodDays / 200);
    expect(from(twin, sun).length() / plan.orbit).toBeCloseTo(1, 1);
    expect(from(twin, sun).normalize().dot(d0)).toBeLessThan(-0.99);
    // (it turns on its axis like the first: its orientation follows the catalogue's rotation model)
    expect(twin.orientation.elements[10]).toBeCloseTo(jupiter.orientation.elements[10], 12);
    expect(sys.byId.get(MADE_FIRST_ID)).toBe(twin);
  });

  it('a second sun shines, lights what is nearer it, and the two go round each other with no ring in what goes round what', async () => {
    const { sys, physics, clock, named, run, make } = await setup();
    const sun = named('Sun'), neptune = named('Neptune');
    // put on the far side of Neptune from the Sun: 40 AU out
    const out = from(neptune, sun).normalize().multiplyScalar(40 * AU / 0.55);
    const plan = newTwin(sun, 'sun', sun, out.toArray(), 0, MADE_FIRST_ID);
    const twin = make(plan, sun);
    expect([twin.name, twin.kind, twin.teff, twin.absMag]).toEqual(['Sun 2', 'star', sun.teff, sun.absMag]);
    expect(twin.info()[0]).toEqual(['Type', 'Star (made by you)']);
    expect(sys.suns).toEqual([sun, twin]);
    expect(sys.brightness(twin)).toBe(1);
    // Neptune, 30 AU from the Sun and about 10 from the new one, is lit by the new one; the Earth by the old
    expect(sys.sunAt(neptune.pos)).toBe(twin);
    expect(sys.sunAt(named('Earth').pos)).toBe(sun);
    // (the lighter side of a pair goes round the heavier: here the Sun's side has the giant planets with it, and the
    // new one is said to go round it; each says that the two go round each other)
    expect(twin.parent).toBe(sun);
    expect(sun.parent).toBeNull();
    expect([physics.rows(twin)[1], physics.rows(sun)[1]]).toEqual([['Goes round', 'each other, with the Sun'], ['Goes round', 'each other, with Sun 2']]);
    run(30, 0.5);
    for (const b of sys.bodies) {
      let steps = 0;
      for (let p = b.parent; p; p = p.parent) expect(++steps).toBeLessThan(10);
    }
    // the pair is bound: the relative speed is that of a circle for both masses together
    expect(twin.vel.clone().sub(sun.vel).length() / Math.sqrt((2 * sun.gm) / from(twin, sun).length())).toBeCloseTo(1, 2);
    // taken away again, it no longer shines
    physics.remove(twin, clock.jdTdb);
    expect(sys.suns).toEqual([sun]);
    expect(sys.sunAt(neptune.pos)).toBe(sun);
  });

  it('a second sun near Mercury and Venus takes them, and then the Sun is the one said to go round: it is told that the two go round each other', async () => {
    const { physics, named, make } = await setup();
    const sun = named('Sun');
    // 0.3 AU from the Sun towards Mercury (the eye put so that 0.55 of the way to it is there)
    const plan = newTwin(sun, 'sun', sun, from(named('Mercury'), sun).normalize().multiplyScalar((0.3 * AU) / 0.55).toArray(), 0, MADE_FIRST_ID);
    const twin = make(plan, sun);
    // the new one's side of the pair has Mercury and Venus with it, and is the heavier
    expect([named('Mercury').parent, named('Venus').parent]).toEqual([twin, twin]);
    expect(sun.parent).toBe(twin);
    expect(twin.parent).toBeNull();
    // what was made is told first; then that the two go round each other, not that the Sun goes round the new one
    const news = physics.takeNews();
    expect(news[0]).toBe('Sun 2 is new.');
    expect(news[1]).toBe('The Sun and Sun 2 go round each other now.');
    expect(news).toContain('Venus goes round Sun 2 now, no longer round the Sun.');
    expect([physics.rows(twin)[1], physics.rows(sun)[1]]).toEqual([['Goes round', 'each other, with the Sun'], ['Goes round', 'each other, with Sun 2']]);
  });

  it('what was made goes with the return to reality, a moon before the planet it was made for, and the system is the catalogue\'s again', async () => {
    const { sys, physics, clock, named, make } = await setup();
    const before = sys.bodies.length;
    const sun = named('Sun');
    const planet = make(newTwin(named('Earth'), 'earth_day', sun, [0, 2 * AU, 0], 0, MADE_FIRST_ID), sun);
    const moon = make(newMoon(planet, [8 * planet.radius, 0, 0], 1.1 * AU, 0, MADE_FIRST_ID + 1), planet);
    expect(moon.name).toBe("Earth 2's new moon");
    expect(moon.parent).toBe(planet);
    // the planet taken away: its moon flies on, still there
    physics.remove(planet, JD);
    expect(planet.valid).toBe(false);
    expect(moon.valid).toBe(true);
    expect(physics.simulated(moon)).toBe(true);
    // (what was made is taken out by the return to reality itself, the moon first)
    physics.backToReality(clock);
    expect(physics.made).toEqual([]);
    expect(sys.bodies.length).toBe(before);
    expect(sys.bodies.every((b) => !b.meta.made)).toBe(true);
    expect(sun.children).not.toContain(planet);
    sys.update(JD + 1);   // (and nothing trips over their absence)
    // the same number twice is a mistake in the code
    const again = newTwin(named('Earth'), 'earth_day', sun, [0, 2 * AU, 0], 0, MADE_FIRST_ID);
    sys.add(again.json);
    expect(() => sys.add(again.json)).toThrow('there already');
  });
});

describe('the size of what is made, from its mass', () => {
  it('a world like the Earth is rock at the Earth\'s density: 5 Earths have 1.71 times its radius; the Earth\'s own mass gives the Earth\'s size', () => {
    expect(madeSize('earth', 5 * M_EARTH, false)).toEqual({ radius: R_EARTH * Math.cbrt(5), rule: 'earth' });
    expect(madeSize('earth', 5 * M_EARTH, false).radius / R_EARTH).toBeCloseTo(1.71, 2);
    expect(madeSize('earth', M_EARTH, false).radius).toBe(R_EARTH);
    // (a ball of 5,514 kg/m³)
    const r = madeSize('earth', 3 * M_EARTH, false).radius;
    expect((3 * M_EARTH) / ((4 / 3) * Math.PI * r ** 3)).toBeCloseTo(EARTH_DENSITY, -1);
    expect(madeWords('earth', 5 * M_EARTH, false)).toEqual({ mass: '5 Earths', what: "Rock, 1.71 times the Earth's size" });
    expect(madeWords('earth', M_EARTH, false).what).toBe("Rock, the Earth's size");
  });

  it('a giant from 0.3 Jupiters, and a brown dwarf, are about Jupiter\'s size (the catalogue\'s mean radius); between 10 Earths and 0.3 Jupiters the size goes from one to the other', async () => {
    const { named } = await setup();
    expect(R_JUPITER / 1e3).toBeCloseTo(named('Jupiter').radius / 1e3, 0);
    expect(madeSize('jupiter', 5 * M_JUPITER, false)).toEqual({ radius: R_JUPITER, rule: 'giant' });
    expect(madeSize('jupiter', 20 * M_JUPITER, false)).toEqual({ radius: R_JUPITER, rule: 'brown dwarf' });
    expect(madeSize('jupiter', GIANT_FROM, false).radius).toBe(R_JUPITER);
    // at 10 Earths it is the rock of 10 Earths; Neptune's 17 Earths come out 3.2 Earth radii (it measures 3.9)
    expect(madeSize('jupiter', ROCKY_MOST, false).radius).toBeCloseTo(madeSize('earth', ROCKY_MOST, false).radius, 3);
    expect(madeSize('jupiter', 17.15 * M_EARTH, false).radius / R_EARTH).toBeCloseTo(3.2, 1);
    expect(madeSize('jupiter', 17.15 * M_EARTH, false).rule).toBe('between');
    // never smaller for more mass
    let last = 0;
    for (let k = 0; k <= 100; k++) {
      const [lo, hi] = MADE_MASS.jupiter, r = madeSize('jupiter', lo * (hi / lo) ** (k / 100), false).radius;
      expect(r).toBeGreaterThanOrEqual(last * (1 - 1e-12));
      last = r;
    }
    expect(madeWords('jupiter', 5 * M_JUPITER, false).what).toBe("A giant of gas, Jupiter's size");
    expect(madeWords('jupiter', 20 * M_JUPITER, false).what).toBe("A brown dwarf, Jupiter's size");
  });

  it('a sun is a star of the main sequence: half a Sun has 0.57 of its radius, a sixteenth of its light, 3,810 K; the Sun\'s mass gives the Sun', () => {
    const half = madeSize('sun', 0.5 * M_SUN, false), ms = mainSequence(0.5);
    expect(half).toEqual({ radius: ms.radius.value, rule: 'star', teff: ms.teff.value, lum: ms.lum.value });
    expect(half.radius / R_SUN).toBeCloseTo(0.574, 3);
    expect(half.lum).toBeCloseTo(0.0625, 6);
    expect(half.teff! / 10).toBeCloseTo(380.8, 0);
    const one = madeSize('sun', M_SUN, false);
    expect(one.radius).toBe(R_SUN);
    expect(one.teff).toBeCloseTo(5772, 9);
    expect(madeAbsMag(1)).toBe(4.831);
    expect(madeAbsMag(one.lum!)).toBeCloseTo(4.831, 12);
    expect(madeAbsMag(half.lum!)).toBeCloseTo(4.831 + 2.5 * Math.log10(16), 9);
    expect(madeWords('sun', M_SUN, false).what).toBe('A star like the Sun');
    expect(madeWords('sun', 0.5 * M_SUN, false).what).toBe("A star, 0.57 times the Sun's size, 3,810 K");
    // the lightest star the slider makes is said in Suns, as a star is, and in Jupiters as well
    expect(MADE_MASS.sun[0]).toBeCloseTo(0.08 * M_SUN, -20);
    expect(madeWords('sun', MADE_MASS.sun[0], false).mass).toBe('0.08 Suns (83.8 Jupiters)');
    expect(madeWords('sun', 0.5 * M_SUN, false).mass).toBe('0.5 Suns');
  });

  it('a moon is a ball of rock, or of ice and rock beyond the frost line, as Add makes one', async () => {
    const { named } = await setup();
    const plan = newMoon(named('Earth'), [8 * named('Earth').radius, 0, 0], AU, 0, MADE_FIRST_ID);
    const as = plan.json.madeAs!;
    expect(as).toEqual({ kind: 'moon', kg: (plan.json.gm! * 1e9) / G, icy: false });
    expect(madeSize('moon', as.kg, false).radius / 1e3).toBeCloseTo(plan.json.radii![0], 6);
    expect(madeSize('moon', 1e20, true).radius).toBeCloseTo(Math.cbrt((3 * 1e20) / (4 * Math.PI * 1500)), 6);
    expect(madeWords('moon', 1e20, true).what).toMatch(/^Ice and rock, 25\d km in radius$/);
  });

  it('its slider runs from a small moon to two suns across the four kinds, even in the logarithm, and finds the mass Add made near it', () => {
    expect(MADE_MASS.moon[0]).toBeCloseTo(7.346e16, -12);
    expect(MADE_MASS.sun[1]).toBe(2 * M_SUN);
    expect(MADE_MASS.earth[1]).toBe(MADE_MASS.jupiter[0]);
    expect(MADE_MASS.jupiter[1]).toBe(MADE_MASS.sun[0]);
    expect(MADE_MASS.sun[0]).toBe(STAR_FROM);
    for (const kind of ['moon', 'earth', 'jupiter', 'sun'] as const) {
      const [lo, hi] = MADE_MASS[kind], base = Math.sqrt(lo * hi) * 1.7;
      expect(madeMassAt(kind, 0, base) / lo).toBeCloseTo(1, 12);
      expect(madeMassAt(kind, 1, base) / hi).toBeCloseTo(1, 12);
      expect(madeSlider(kind, madeMassAt(kind, 0.3, base))).toBeCloseTo(0.3, 12);
      // within 0.03 powers of ten of what Add made: exactly that
      expect(madeMassAt(kind, madeSlider(kind, base * 1.06), base)).toBe(base);
      expect(madeMassAt(kind, madeSlider(kind, base * 1.08), base) / (base * 1.08)).toBeCloseTo(1, 12);
    }
  });

  it('says how its size was worked out, with the rule it follows: in its details, as every made thing does', async () => {
    const { named, make } = await setup();
    const sun = named('Sun');
    const earth2 = make(newTwin(named('Earth'), 'earth_day', sun, [0, 2 * AU, 0], 0, MADE_FIRST_ID), sun);
    const line = workedOut(earth2).find((w) => w.label === 'Its size (made by you)')!;
    expect(line.text).toBe('6,371 km');
    expect(line.math).toBe("R = R⊕ (M / M⊕)^⅓ = 6,371 km·(1)^⅓ = 6,371 km: rock at the Earth's mean density, 5,514 kg/m³");
    expect(madeWorking('jupiter', 5 * M_JUPITER, false).math).toMatch(/^R ≈ R♃ = 69,911 km: a giant planet is about Jupiter's size/);
    expect(madeWorking('sun', 0.5 * M_SUN, false).math).toMatch(/^R = M\^0\.8 R☉ = 0\.5\^0\.8 R☉ = 0\.5743 R☉ .*: a star of the main sequence/);
    expect(madeWorking('jupiter', 30 * M_EARTH, false).math).toMatch(/: between a rock of 10 Earths and Jupiter's size at 0\.3 Jupiters/);
    // (nothing of the catalogue's says so)
    expect(workedOut(named('Earth')).some((w) => w.label.includes('made by you'))).toBe(false);
  });
});

describe('worlds of a generated look', () => {
  /** relative difference of a from b */
  const off = (a: number, b: number) => Math.abs(a / b - 1);
  const ROCKY = ['terran', 'ocean', 'desert', 'lava'] as const;

  it('have the masses they are made with: rock, ocean, desert and lava from a twentieth of the Earth to ten Earths; ice from a thousandth to 5; ice giants from 5 to 50; gas giants from 10 Earths to 13 Jupiters', () => {
    for (const kind of ROCKY) {
      const [lo, hi] = MADE_MASS[kind];
      expect(off(lo, 0.05 * M_EARTH)).toBeLessThan(1e-12);
      expect(off(hi, 10 * M_EARTH)).toBeLessThan(1e-12);
    }
    const [ilo, ihi] = MADE_MASS.ice;
    expect(off(ilo, 0.001 * M_EARTH)).toBeLessThan(1e-12);
    expect(off(ihi, 5 * M_EARTH)).toBeLessThan(1e-12);
    const [glo, ghi] = MADE_MASS.icegiant;
    expect(off(glo, 5 * M_EARTH)).toBeLessThan(1e-12);
    expect(off(ghi, 50 * M_EARTH)).toBeLessThan(1e-12);
    const [gilo, gihi] = MADE_MASS.giant;
    expect(off(gilo, 10 * M_EARTH)).toBeLessThan(1e-12);
    expect(off(gihi, 13 * M_JUPITER)).toBeLessThan(1e-12);
  });

  it('of rock, ocean, desert and lava: the Earth\'s density, R = R⊕ (M / M⊕)^⅓, at the bottom, at 1 Earth and at the top of their mass', () => {
    for (const kind of ROCKY) {
      const [lo, hi] = MADE_MASS[kind];
      for (const kg of [lo, M_EARTH, hi]) {
        const s = madeSize(kind, kg, false);
        expect(s.rule).toBe('earth');
        expect(off(s.radius, R_EARTH * Math.cbrt(kg / M_EARTH))).toBeLessThan(1e-12);
      }
    }
  });

  it('of ice: a ball of ice and rock (1,500 kg/m³), the rule \'ice\', at the bottom, middle and top of its mass', () => {
    const [lo, hi] = MADE_MASS.ice, mid = Math.sqrt(lo * hi);
    for (const kg of [lo, mid, hi]) {
      const s = madeSize('ice', kg, false);
      expect(s.rule).toBe('ice');
      expect(off(s.radius, Math.cbrt((3 * kg) / (4 * Math.PI * 1500)))).toBeLessThan(1e-12);
    }
  });

  it('of ice giants: as rock of their mass below 10 Earths, then between a rock and Jupiter\'s size, never smaller for more mass, and below Jupiter\'s size at 50 Earths', () => {
    expect(madeSize('icegiant', 5 * M_EARTH, false).rule).toBe('earth');
    expect(madeSize('icegiant', 9.99 * M_EARTH, false).rule).toBe('earth');
    expect(madeSize('icegiant', ROCKY_MOST, false).rule).toBe('between');
    expect(off(madeSize('icegiant', ROCKY_MOST, false).radius, madeSize('icegiant', ROCKY_MOST * (1 - 1e-9), false).radius)).toBeLessThan(1e-6);
    let last = 0;
    for (let k = 0; k <= 200; k++) {
      const r = madeSize('icegiant', (5 + (45 * k) / 200) * M_EARTH, false).radius;
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    expect(madeSize('icegiant', 50 * M_EARTH, false).radius).toBeLessThan(R_JUPITER);
  });

  it('of gas giants: between a rock and Jupiter\'s size below 0.3 Jupiters, continuous and increasing with mass; Jupiter\'s size from 0.3 Jupiters on', () => {
    const below = GIANT_FROM * (1 - 1e-9);
    expect(madeSize('giant', below, false).rule).toBe('between');
    expect(off(madeSize('giant', below, false).radius, R_JUPITER)).toBeLessThan(1e-6);
    expect(madeSize('giant', GIANT_FROM, false).rule).toBe('giant');
    expect(madeSize('giant', GIANT_FROM, false).radius).toBe(R_JUPITER);
    expect(madeSize('giant', 13 * M_JUPITER, false).radius).toBe(R_JUPITER);
    expect(madeSize('giant', 10 * M_EARTH, false).rule).toBe('between');
    let last = 0;
    for (let k = 0; k <= 100; k++) {
      const [lo, hi] = MADE_MASS.giant, r = madeSize('giant', lo * (hi / lo) ** (k / 100), false).radius;
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it('each kind has a finite positive radius at both ends of its mass, and is named in words: "A" or "An", and its plain name', () => {
    for (const kind of WORLD_KINDS) {
      const [lo, hi] = MADE_MASS[kind];
      for (const kg of [lo, hi]) {
        const r = madeSize(kind, kg, false).radius;
        expect(Number.isFinite(r) && r > 0).toBe(true);
        const w = madeWords(kind, kg, false).what;
        expect(w.startsWith('A ') || w.startsWith('An ')).toBe(true);
        expect(w).toContain(WORLD_NAME[kind]);
      }
    }
    expect(WORLD_NAME).toEqual({
      terran: 'rocky world', ocean: 'ocean world', desert: 'desert world', lava: 'lava world', ice: 'icy world', giant: 'gas giant', icegiant: 'ice giant',
    });
  });

  it('can be added to a star, and to nothing else but a planet or dwarf planet to a moon', async () => {
    const { named } = await setup();
    expect(canAdd(named('Sun'), 0)).toEqual(['earth', 'jupiter', 'sun', ...WORLD_KINDS]);
    expect(canAdd(named('Earth'), 0)).toEqual(['moon']);
  });

  it('are made for a star as a planet of their kind, named "New" and with their mass and seed', async () => {
    const { named } = await setup();
    const star = named('Sun'), eye = [3 * AU, 4 * AU, 1 * AU];
    for (const kind of WORLD_KINDS) {
      const plan = newWorld(kind, star, eye, 0, MADE_FIRST_ID, 7, { albedo: 0.3, color: [0.5, 0.5, 0.5] });
      const json = plan.json;
      expect(json.madeAs).toEqual({ kind, kg: WORLD_BASE[kind], icy: false, seed: 7 });
      expect(json.texture).toBeUndefined();
      expect(json.type).toBe('planet');
      expect(json.made).toBe(true);
      expect(json.parent).toBe(star.id);
      expect(off(json.radii![0] * 1e3, madeSize(kind, WORLD_BASE[kind], false).radius)).toBeLessThan(1e-12);
      expect(json.name!.startsWith('New ')).toBe(true);
    }
  });

  it('are made again from what was kept of them, with their seed and kind', async () => {
    const { named } = await setup();
    const star = named('Sun'), look = { albedo: 0.3, color: [0.5, 0.5, 0.5] as [number, number, number] };
    for (const kind of WORLD_KINDS) {
      const m: MadeRecord = {
        id: MADE_FIRST_ID, kind, name: `New ${WORLD_NAME[kind]}`, home: star.id, icy: false, kg: WORLD_BASE[kind],
        gm: 0, radius: 0, teff: 0, absMag: 0, seed: 12345,
      };
      const json = madeAgain(m, star, null, null, look);
      expect(json.madeAs!.seed).toBe(12345);
      expect(json.madeAs!.kind).toBe(kind);
    }
  });
});
