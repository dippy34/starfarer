import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { POWER_NAMES, powersFor, type PowerName, type PowerTable } from '../src/app/powersFor';
import { AU, DAY } from '../src/core/units';
import { UPos } from '../src/core/upos';
import { Comet } from '../src/render/SmallBodies';
import { G, M_EARTH, M_SUN, R_EARTH, R_SUN } from '../src/sim/physics';
import { BlackHole } from '../src/universe/BlackHoles';
import { Body, type SpaceObject } from '../src/universe/Body';
import { DeepSkyObject } from '../src/universe/DeepSky';
import { Galaxy } from '../src/universe/Galaxies';
import { LANDMARKS, Landmark } from '../src/universe/Landmarks';
import { MilkyWay } from '../src/universe/MilkyWay';
import { PlanetarySystem, type PlanetSpec } from '../src/universe/Planets';
import { Spacecraft, type SpacecraftFile } from '../src/universe/Spacecraft';
import { CatalogStar } from '../src/universe/Stars';

/** the names of the powers that work on this card, in their shown order */
const working = (table: PowerTable): PowerName[] => POWER_NAMES.filter((p) => table[p].works);

/** why a power that does not work cannot (an error where it does work, for there is no reason then) */
const reason = (table: PowerTable, name: PowerName): string => {
  const status = table[name];
  if (status.works) throw new Error(`${name} works, so it has no reason`);
  return status.reason;
};

/** a reason must be short enough for the button's line, and say something */
const expectPlainReason = (table: PowerTable, name: PowerName) => {
  const why = reason(table, name);
  expect(why.length).toBeGreaterThan(0);
  expect(why.length).toBeLessThanOrEqual(60);
};

const expectNoPowers = (table: PowerTable) => {
  expect(working(table)).toEqual([]);
  for (const p of POWER_NAMES) expectPlainReason(table, p);
};

describe('the powers on a Solar System body', () => {
  it('a measured planet has all five working', () => {
    // fixture values for a measured Earth-like world, not a catalogue entry
    const earth = new Body(399, 'Test world', 'planet');
    earth.gm = G * M_EARTH;
    earth.radius = R_EARTH;
    earth.radii = [R_EARTH, R_EARTH, R_EARTH];
    expect(working(powersFor(earth))).toEqual(['mass', 'size', 'move', 'add', 'remove']);
  });

  it('a star keeps Mass, Move, Add and Remove, and its Size says why not', () => {
    const sun = new Body(10, 'Test star', 'star');
    sun.gm = G * M_SUN;
    sun.radius = R_SUN;
    sun.radii = [R_SUN, R_SUN, R_SUN];
    const table = powersFor(sun);
    expect(working(table)).toEqual(['mass', 'move', 'add', 'remove']);
    expectPlainReason(table, 'size');
  });

  it('a moon cannot be given a moon, but keeps its other powers', () => {
    // round fixture figures, not a catalogue entry
    const moon = new Body(301, 'Test moon', 'moon');
    moon.gm = G * 7.346e22; // the Moon's known mass
    moon.radius = 1.7e6;
    moon.radii = [1.7e6, 1.7e6, 1.7e6];
    const table = powersFor(moon);
    expect(working(table)).toEqual(['mass', 'size', 'move', 'remove']);
    expectPlainReason(table, 'add');
  });

  it('a body whose position is not known has no powers, each with its reason', () => {
    const lost = new Body(399, 'Lost world', 'planet');
    lost.gm = G * M_EARTH;
    lost.radius = R_EARTH;
    lost.radii = [R_EARTH, R_EARTH, R_EARTH];
    lost.valid = false;
    const table = powersFor(lost);
    expect(working(table)).toEqual([]);
    for (const p of POWER_NAMES) expectPlainReason(table, p);
  });

  it('an unmeasured world or size says what is missing', () => {
    const world = new Body(1, 'Unweighed world', 'planet');
    world.radius = R_EARTH;
    world.radii = [R_EARTH, R_EARTH, R_EARTH];
    expect(working(powersFor(world))).toEqual(['move', 'remove']);
    expectPlainReason(powersFor(world), 'mass');
    expectPlainReason(powersFor(world), 'size');
    expectPlainReason(powersFor(world), 'add');
    world.gm = G * M_EARTH;
    world.radiusEstimated = true;
    expectPlainReason(powersFor(world), 'size');
    expect(working(powersFor(world, 24))).toEqual(['mass', 'move', 'remove']);
    expectPlainReason(powersFor(world, 24), 'add');
  });
});

const host = new CatalogStar('star:test', new Vector3(1, 0, 0), 4.83, 5772, 'G2V', ['Test star'], null);
const planetSpec: PlanetSpec = {
  name: 'Test real b', real: true, est: [], method: 'Transit', aM: AU, e: 0, inc: 0, node: 0, omega: 0, M0: 0,
  periodS: 365.25 * DAY, radiusM: R_EARTH, massKg: M_EARTH, teqK: 255, type: 'terran', albedo: 0.3,
  rings: false, seed: 1, rotS: DAY,
};

describe('the powers beyond the Solar System', () => {
  it('a real planet of another star with a measured size has Mass, Size, Move and Remove; Add says why not', () => {
    const system = new PlanetarySystem(host, [planetSpec], true, new Vector3(0, 0, 1), { kg: M_SUN, from: 'measured' });
    const table = powersFor(system.planets[0]);
    expect(working(table)).toEqual(['mass', 'size', 'move', 'remove']);
    expectPlainReason(table, 'add');
    expect(reason(table, 'add')).toMatch(/round the Sun/);
  });

  it('a planet whose size is estimated, generated or not seen in transit keeps Mass, Move and Remove; its Size says which', () => {
    const estimated = new PlanetarySystem(host, [{ ...planetSpec, est: ['radius'] }], true, new Vector3(0, 0, 1), { kg: M_SUN, from: 'measured' }).planets[0];
    const generated = new PlanetarySystem(host, [{ ...planetSpec, name: 'Test generated b', real: false }], false, new Vector3(0, 0, 1)).planets[0];
    const wobble = new PlanetarySystem(host, [{ ...planetSpec, method: 'Radial Velocity' }], true, new Vector3(0, 0, 1), { kg: M_SUN, from: 'measured' }).planets[0];
    expect(generated.system.hostMass.from).toBe('generated');
    expect(reason(powersFor(wobble), 'size')).toMatch(/transit/);
    for (const planet of [estimated, generated, wobble]) {
      expect(working(powersFor(planet))).toEqual(['mass', 'move', 'remove']);
      expectPlainReason(powersFor(planet), 'size');
      expectPlainReason(powersFor(planet), 'add');
    }
    expect(reason(powersFor(estimated), 'size')).toMatch(/estimated/);
    expect(reason(powersFor(generated), 'size')).toMatch(/generated/);
  });

  it('the star of a planetary system has Mass, Move and Remove; a star whose mass nobody knows has none', () => {
    const system = new PlanetarySystem(host, [planetSpec], true, new Vector3(0, 0, 1), { kg: M_SUN, from: 'measured' });
    const table = powersFor(host, 0, { system });
    expect(working(table)).toEqual(['mass', 'move', 'remove']);
    expectPlainReason(table, 'size');
    expectPlainReason(table, 'add');
    const unweighed = new PlanetarySystem(host, [planetSpec], true, new Vector3(0, 0, 1), { kg: 0, from: 'unknown' });
    for (const object of [unweighed.host, unweighed.planets[0]]) {
      expectNoPowers(powersFor(object, 0, { system: unweighed }));
      expect(reason(powersFor(object, 0, { system: unweighed }), 'mass')).toMatch(/No measured mass for its star/);
    }
    const disagreeing = new PlanetarySystem(host, [planetSpec], true, new Vector3(0, 0, 1), { kg: M_SUN, from: 'disagree' });
    for (const object of [disagreeing.host, disagreeing.planets[0]]) {
      expectNoPowers(powersFor(object, 0, { system: disagreeing }));
      expect(reason(powersFor(object, 0, { system: disagreeing }), 'move')).toMatch(/orbits disagree/);
    }
  });

  it('live physics runs in one system at a time: the others say so', () => {
    const system = new PlanetarySystem(host, [planetSpec], true, new Vector3(0, 0, 1), { kg: M_SUN, from: 'measured' });
    const other = new PlanetarySystem(host, [{ ...planetSpec, name: 'Test other b' }], true, new Vector3(0, 0, 1), { kg: M_SUN, from: 'measured' });
    const earth = new Body(399, 'Test world', 'planet');
    earth.gm = G * M_EARTH;
    earth.radius = R_EARTH;
    earth.radii = [R_EARTH, R_EARTH, R_EARTH];
    // live round the Sun: another star's planets and that star wait
    for (const table of [powersFor(system.planets[0], 0, { live: 'solar' }), powersFor(host, 0, { system, live: 'solar' })]) {
      expectNoPowers(table);
      expect(reason(table, 'move')).toMatch(/one at a time/);
    }
    // live in that star's system: its own planets keep their powers, the Solar System's and another system's wait
    expect(working(powersFor(system.planets[0], 0, { live: system }))).toEqual(['mass', 'size', 'move', 'remove']);
    expect(reason(powersFor(other.planets[0], 0, { live: system }), 'mass')).toMatch(/one at a time/);
    expect(reason(powersFor(earth, 0, { live: system }), 'mass')).toMatch(/one at a time/);
    expect(working(powersFor(earth, 0, { live: 'solar' }))).toEqual(['mass', 'size', 'move', 'add', 'remove']);
    // Back to reality just used in one system, its Undo still offered: the others wait, and say why
    expect(reason(powersFor(earth, 0, { live: system, undo: true }), 'mass')).toMatch(/Undo is still offered/);
    expect(reason(powersFor(system.planets[0], 0, { live: 'solar', undo: true }), 'move')).toMatch(/Undo is still offered/);
    expect(working(powersFor(earth, 0, { live: 'solar', undo: true }))).toEqual(['mass', 'size', 'move', 'add', 'remove']);
  });

  it('another star has a reason for every power, including its unmeasured mass', () => {
    const table = powersFor(host);
    expectNoPowers(table);
    expect(reason(table, 'mass')).toMatch(/No measured mass/);
  });

  it("a catalogue black hole's mass works; Size, Move, Add and Remove each say why not", () => {
    const data = JSON.parse(readFileSync(new URL('../public/data/blackholes.json', import.meta.url), 'utf8')) as { blackholes: ConstructorParameters<typeof BlackHole>[1][] };
    for (const name of ['Cygnus X-1', 'Sagittarius A*', 'Gaia BH1']) {
      const hole = new BlackHole(0, data.blackholes.find((h) => h.name === name)!);
      expect(hole.massSun).toBeGreaterThan(0);
      const table = powersFor(hole);
      expect(working(table)).toEqual(['mass']);
      for (const p of ['size', 'move', 'add', 'remove'] as const) expectPlainReason(table, p);
      expect(reason(table, 'size')).toBe("A black hole's size is set by its mass");
      for (const p of ['move', 'add', 'remove'] as const) expect(reason(table, p)).toBe('Live physics does not take black holes yet');
    }
  });

  it('a belt asteroid stays on its recorded path', () => {
    // A belt point has no selectable class of its own; this stand-in covers its object kind.
    const belt: SpaceObject = { key: 'belt:test', name: 'Belt asteroid', kind: 'asteroid', upos: new UPos(), radius: 0, parentObject: null, info: () => [] };
    expectNoPowers(powersFor(belt));
    expect(reason(powersFor(belt), 'move')).toMatch(/recorded paths/);
  });

  it('a comet can be taken away, moved and thrown; its mass, size and Add stay off, each with a plain reason', () => {
    const data = JSON.parse(readFileSync(new URL('../public/data/solar/comets.json', import.meta.url), 'utf8')) as { comets: ConstructorParameters<typeof Comet>[2][] };
    const row = data.comets.find((r) => r[0].includes('Halley')) ?? data.comets[0];
    const comet = new Comet('comet:test', row[0], row);
    const t = powersFor(comet);
    expect(t.remove).toEqual({ works: true });
    // it can be moved or thrown: the simulation carries it from there, with no mass
    expect(t.move).toEqual({ works: true });
    for (const name of ['mass', 'size', 'add'] as const) {
      expect(t[name].works).toBe(false);
      expect(reason(t, name).length).toBeLessThanOrEqual(60);
    }
    expect(reason(t, 'mass')).toMatch(/No measured mass/);
    // not while live physics runs in another star's system
    const elsewhere = powersFor(comet, 0, { live: {} as never });
    expectNoPowers(elsewhere);
    expect(reason(elsewhere, 'remove')).toMatch(/one at a time/);
    // it works while live physics runs in the Solar System
    expect(powersFor(comet, 0, { live: 'solar' }).remove.works).toBe(true);
  });

  it('a galaxy, including the Milky Way, and a nebula explain missing mass and physics', () => {
    const galaxies = JSON.parse(readFileSync(new URL('../public/data/galaxies.json', import.meta.url), 'utf8')) as { galaxies: ConstructorParameters<typeof Galaxy>[0][] };
    const galaxy = new Galaxy(galaxies.galaxies.find((g) => g.name === 'Andromeda Galaxy')!, 0);
    for (const object of [galaxy, new MilkyWay()]) {
      expectNoPowers(powersFor(object));
      expect(reason(powersFor(object), 'mass')).toMatch(/No measured mass/);
    }
    const deep = JSON.parse(readFileSync(new URL('../public/data/deepsky.json', import.meta.url), 'utf8')) as { objects: ConstructorParameters<typeof DeepSkyObject>[0][] };
    const nebula = new DeepSkyObject(deep.objects.find((o) => o.name === 'Orion Nebula')!, 0);
    expectNoPowers(powersFor(nebula));
    expect(reason(powersFor(nebula), 'mass')).toMatch(/No measured mass/);
  });

  it('a spacecraft and a place each give their own reason for every power', () => {
    const earth = new Body(399, 'Earth', 'planet');
    const file = JSON.parse(readFileSync(new URL('../public/data/spacecraft.json', import.meta.url), 'utf8')) as SpacecraftFile;
    const data = file.probes[0];
    const craft = new Spacecraft(data, data.kind, earth, earth);
    expectNoPowers(powersFor(craft));
    expect(reason(powersFor(craft), 'remove')).toMatch(/Spacecraft/);
    const place = new Landmark(LANDMARKS[0], earth);
    expectNoPowers(powersFor(place));
    expect(reason(powersFor(place), 'move')).toMatch(/viewpoint/);
  });
});
