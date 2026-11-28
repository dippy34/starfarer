import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import { decodeWorld, encodeWorld, fromBase64Url, toBase64Url } from '../src/app/SceneWorld';
import { SimClock } from '../src/core/time';
import { liveDate } from '../src/sim/SystemSim';
import {
  canAdd, HOLE_BASE, isCopyKind, isWorldKind, MADE_FIRST_ID, MADE_MASS, madeAgain, madeMassAt, madeSize, madeSlider, madeWords, newHole, rocheLimit, schwarzschild, SUN_ZONES, TWIN_OF,
} from '../src/app/WhatIf';
import { AU } from '../src/core/units';
import { G, M_EARTH, M_SUN, R_EARTH } from '../src/sim/physics';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it: its catalogue and the JPL ephemeris, read from public/ as the browser fetches them.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const JD = 2461300.5; // 2026-09-17 (TDB)

async function setup() {
  const sys = await SolarSystem.load('/data');
  await sys.ephemeris.request(JD);
  sys.update(JD);
  const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
  const named = (name: string) => sys.bodies.find((b) => b.name === name)!;
  return { sys, physics, named };
}

describe('a black hole of your own', () => {
  it('can be added to a star with a mass, and not to a planet', async () => {
    const { named } = await setup();
    expect(named('Sun').gm).toBeGreaterThan(0);
    expect(canAdd(named('Sun'), 0)).toContain('hole');
    expect(canAdd(named('Earth'), 0)).not.toContain('hole');
    expect(canAdd(named('Earth'), 0)).toEqual(['moon']);
  });

  it('is made from one Sun to ten billion, begins at ten, and its slider finds ten again', () => {
    expect(MADE_MASS.hole).toEqual([M_SUN, 1e10 * M_SUN]);
    expect(HOLE_BASE).toBe(10 * M_SUN);
    expect(madeMassAt('hole', 0, HOLE_BASE)).toBe(M_SUN);
    expect(madeMassAt('hole', 1, HOLE_BASE) / (1e10 * M_SUN)).toBeCloseTo(1, 12);
    const s = madeSlider('hole', HOLE_BASE);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(madeMassAt('hole', s, HOLE_BASE)).toBe(HOLE_BASE);
  });

  it('has the Schwarzschild radius 2GM / c²: 2.95 km for the Sun, 29.5 km for ten Suns, in proportion to its mass', () => {
    expect(schwarzschild(M_SUN) / 1e3).toBeCloseTo(2.95, 2);
    expect(schwarzschild(10 * M_SUN) / 1e3).toBeCloseTo(29.53, 2);
    expect(schwarzschild(20 * M_SUN) / schwarzschild(M_SUN)).toBeCloseTo(20, 12);
  });

  it('is torn apart by its tides only within the Roche limit: about 1.2 million km for the Earth about ten Suns', () => {
    const limit = rocheLimit(R_EARTH, M_EARTH, 10 * M_SUN);
    expect(limit).toBeGreaterThan(1.15e9);
    expect(limit).toBeLessThan(1.25e9);
    expect(limit).toBe(R_EARTH * Math.cbrt((2 * 10 * M_SUN) / M_EARTH));
    // eight times the mass at the same radius: the limit is half as far
    expect(rocheLimit(R_EARTH, 8 * M_EARTH, 10 * M_SUN) / limit).toBeCloseTo(0.5, 12);
  });

  it('is made as a planet of the star, with its size, mass and look as a hole has them', async () => {
    const { named } = await setup();
    const star = named('Sun'), gm = G * HOLE_BASE;
    const plan = newHole(star, [AU, 0, 0], 0, 900_000_001);
    const json = plan.json;
    expect(plan.json.madeAs).toEqual({ kind: 'hole', kg: 10 * M_SUN, icy: false });
    expect(json.name).toBe('Black hole');
    expect(newHole(star, [AU, 0, 0], 1, 900_000_002).json.name).toBe('Black hole 2');
    expect(json.made).toBe(true);
    expect(json.parent).toBe(star.id);
    expect(json.albedo).toBe(0);
    expect(json.color).toEqual([0, 0, 0]);
    const horizon = schwarzschild(10 * M_SUN) / 1e3;
    expect(json.radii).toEqual([horizon, horizon, horizon]);
    expect(madeSize('hole', HOLE_BASE, false).radius / 1e3).toBeCloseTo(horizon, 9);
    expect((json.gm! * 1e9) / gm).toBeCloseTo(1, 12);
  });

  it('goes round its star on a circle in the plane the planets move in, at a speed a circle gives it', async () => {
    const { named } = await setup();
    const star = named('Sun'), gm = G * HOLE_BASE;
    const plan = newHole(star, [AU, 0, 0], 0, 900_000_001);
    expect(plan.orbit).toBeGreaterThanOrEqual(SUN_ZONES.nearestSun);
    expect(plan.orbit).toBeLessThanOrEqual(SUN_ZONES.farthest);
    expect(Math.hypot(...plan.pos) / plan.orbit).toBeCloseTo(1, 9);
    expect(Math.hypot(...plan.vel) / Math.sqrt((star.gm + gm) / plan.orbit)).toBeCloseTo(1, 9);
    const dot = plan.pos[0] * plan.vel[0] + plan.pos[1] * plan.vel[1] + plan.pos[2] * plan.vel[2];
    expect(Math.abs(dot) / (Math.hypot(...plan.pos) * Math.hypot(...plan.vel))).toBeLessThan(1e-9);
  });

  it('is put 0.55 of the way to the eye when there is room: an eye 1 AU out gives an orbit of 0.55 AU', async () => {
    const { named } = await setup();
    const plan = newHole(named('Sun'), [AU, 0, 0], 0, 900_000_001);
    expect(plan.orbit / AU).toBeCloseTo(0.55, 12);
  });

  it('is said in words as a black hole of 10 Suns with a 29.5 km horizon', () => {
    const w = madeWords('hole', HOLE_BASE, false);
    expect(w.mass).toBe('10 Suns');
    expect(w.what).toContain('29.5 km');
  });
});

/**
 * A hole of ten Suns made for the Sun, then the Earth (with its family) put `d` m from it, at rest against it. (A hole that
 * heavy holds the planets: what goes round a body comes with it when it is moved, so it is the Earth that is moved.)
 */
async function holeBy(d: number) {
  const u = await setup();
  const sun = u.sys.sun, earth = u.named('Earth');
  const plan = newHole(sun, [AU, 0, 0], 0, MADE_FIRST_ID);
  const hole = u.physics.make(plan.json, sun, plan.pos, plan.vel, JD, 'A black hole is new.');
  const clock = new SimClock(JD), gm0 = hole.gm;
  const away = earth.pos.clone().sub(hole.pos).normalize();
  u.physics.move(earth, hole.pos.clone().addScaledVector(away, d).toArray(), hole.vel.toArray(), JD);
  return { ...u, sun, earth, hole, clock, gm0 };
}

describe('what a black hole swallows', () => {
  it('a world outside its Roche limit is left alone, and one inside is torn apart and swallowed: gone, its mass the hole\'s, said in plain words', async () => {
    const roche = rocheLimit(R_EARTH, M_EARTH, 10 * M_SUN);
    const far = await holeBy(3 * roche);
    expect(far.sys.isGone(far.earth)).toBe(false);
    expect(far.physics.takeNews().some((n) => /swallowed/.test(n))).toBe(false);

    const near = await holeBy(0.5 * roche);
    const { physics, sys, earth, hole, gm0 } = near;
    expect(sys.isGone(earth)).toBe(true);
    // (the hole has the Earth's mass too, and the event horizon that goes with it)
    expect(hole.gm - gm0).toBeGreaterThanOrEqual(0.99 * earth.gm);
    expect(hole.radius).toBe(schwarzschild(hole.gm / G));
    expect(hole.radius).toBeGreaterThan(schwarzschild(gm0 / G));
    expect(physics.takeNews()).toContain('Earth was torn apart and swallowed by the black hole.');
    expect(physics.log.some((e) => /torn apart and swallowed/.test(e.text))).toBe(true);
    // what was swallowed is not in the simulation any more
    expect(physics.live!.sim.indexOf(earth.id)).toBe(-1);
  }, 120_000);

  it('a world thrown at the hole in the run of time is swallowed when it comes within the limit, and not before', async () => {
    const roche = rocheLimit(R_EARTH, M_EARTH, 10 * M_SUN);
    const { physics, sys, earth, hole, clock } = await holeBy(6 * roche);
    expect(sys.isGone(earth)).toBe(false);
    // (sent straight at it, faster than a circle there)
    const to = hole.pos.clone().sub(earth.pos).normalize();
    physics.move(earth, earth.pos.toArray(), hole.vel.clone().addScaledVector(to, 4_000_000).toArray(), JD);
    let frames = 0;
    for (; frames < 400 && !sys.isGone(earth); frames++) {
      clock.jdTdb += 0.001;
      physics.follow(clock, 1);
      sys.update(clock.jdTdb);
      physics.place(clock.jdTdb);
      if (!sys.isGone(earth)) expect(earth.pos.distanceTo(hole.pos)).toBeGreaterThan(0.8 * roche);
    }
    expect(sys.isGone(earth)).toBe(true);
    expect(frames).toBeGreaterThan(1);
    expect(physics.takeNews().some((n) => /^Earth was torn apart and swallowed/.test(n))).toBe(true);
  }, 240_000);

  it('Undo (a checkpoint restored) brings the world and the hole back as they were', async () => {
    const roche = rocheLimit(R_EARTH, M_EARTH, 10 * M_SUN);
    const u = await setup();
    const sun = u.sys.sun, earth = u.named('Earth');
    const plan = newHole(sun, [AU, 0, 0], 0, MADE_FIRST_ID);
    const hole = u.physics.make(plan.json, sun, plan.pos, plan.vel, JD, 'new');
    const away = earth.pos.clone().sub(hole.pos).normalize(), gm0 = hole.gm, r0 = hole.radius;
    const cp = u.physics.checkpoint(JD);
    u.physics.move(earth, hole.pos.clone().addScaledVector(away, 0.5 * roche).toArray(), hole.vel.toArray(), JD);
    expect(u.sys.isGone(earth)).toBe(true);
    u.physics.restore(cp);
    expect(u.sys.isGone(earth)).toBe(false);
    expect([hole.gm, hole.radius]).toEqual([gm0, r0]);
    expect(u.physics.live!.sim.indexOf(earth.id)).toBeGreaterThanOrEqual(0);
  }, 120_000);
});

describe('a black hole kept in a save and a link', () => {
  it('its record is of its own kind: written and read back, the hole is made again as it was, swallowing and all', async () => {
    const roche = rocheLimit(R_EARTH, M_EARTH, 10 * M_SUN);
    const u = await holeBy(0.5 * roche);
    const world = u.physics.world()!;
    const record = world.made.find((m) => m.kind === 'hole')!;
    expect(record.kg).toBe(10 * M_SUN);
    expect(record.name).toBe('Black hole');
    const raw = encodeWorld(world);
    const back = decodeWorld(fromBase64Url(toBase64Url(raw))!);
    expect(back.made).toEqual(world.made);
    // the Earth is gone in it, and the hole is the heavier by it
    expect(back.gone).toContain(u.earth.id);
    expect(back.changed.some(([id, gm]) => id === record.id && gm === u.hole.gm)).toBe(true);

    u.physics.rebase(back);
    const v = await setup();
    expect(liveDate(u.physics.live!)).toBe(JD);
    v.physics.adoptWorld(back, (m) => madeAgain(m, v.sys.byId.get(m.home)!, isCopyKind(m.kind) ? v.sys.byId.get(TWIN_OF[m.kind])! : null, null, isWorldKind(m.kind) ? { albedo: 0.3, color: [0.5, 0.5, 0.5] } : null));
    const again = v.sys.byId.get(record.id)!;
    expect(again.name).toBe('Black hole');
    expect((again.meta.madeAs as { kind: string }).kind).toBe('hole');
    expect(again.gm).toBe(u.hole.gm);
    expect(again.radius).toBe(u.hole.radius);
    expect(v.sys.isGone(v.named('Earth'))).toBe(true);
  }, 240_000);

  it('a link written before black holes (a moon, a copy, a sun, a world of a generated look) reads as ever: their kinds keep their numbers', async () => {
    const u = await setup();
    const sun = u.sys.sun;
    const plan = newHole(sun, [AU, 0, 0], 0, MADE_FIRST_ID);
    const made = u.physics.make({ ...plan.json, madeAs: { kind: 'sun', kg: 2e30, icy: false } }, sun, plan.pos, plan.vel, JD, 'new');
    made.teff = 5100; made.absMag = 5.9;
    const w = u.physics.world()!;
    const kindByte = (bytes: Uint8Array) => decodeWorld(bytes).made[0].kind;
    expect(kindByte(encodeWorld(w))).toBe('sun');
    // (the first four kinds are the first format's: a sun is 3 as it was)
    const withHole = structuredClone(w);
    withHole.made[0].kind = 'hole';
    expect(kindByte(encodeWorld(withHole))).toBe('hole');
    expect(encodeWorld(withHole).length).toBeLessThan(encodeWorld(w).length + 1);
  }, 120_000);
});
