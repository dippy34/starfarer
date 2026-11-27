import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import { powersFor, type PowerTable } from '../src/app/powersFor';
import { hostMassOf, Systems } from '../src/app/Systems';
import { newMoon, SUN_ZONES, zonesOf } from '../src/app/WhatIf';
import { SimClock } from '../src/core/time';
import { G, luminosity, R_EARTH } from '../src/sim/physics';
import { Body } from '../src/universe/Body';
import { liveDate } from '../src/sim/SystemSim';
import type { PlanetarySystem } from '../src/universe/Planets';
import { PlanetarySim } from '../src/universe/PlanetarySim';
import { CatalogStar } from '../src/universe/Stars';

// Systems fetches the archive itself: read the real file from public/data instead
globalThis.fetch = (async (url: string) => {
  const t = readFileSync(join(process.cwd(), 'public/data', url.replace(/^disk:\/\/data\//, '')), 'utf8');
  return { ok: true, text: async () => t, json: async () => JSON.parse(t) as unknown };
}) as unknown as typeof fetch;

const DAY = 86_400, AU = 149_597_870_700, M_EARTH = 5.9722e24;
const JD = 2461300.5; // 2026-09-17 0h TDB: 16 September, 23:58 UTC

const systems = new Systems();
let trappist: PlanetarySystem;
beforeAll(async () => {
  await systems.load('disk://data');
  trappist = systems.archiveSystem(systems.findHost('TRAPPIST-1')!)!;
});

/**
 * a generated system: Gl 9848's, as the catalogue has the star (56 pc away, magnitude 11 from Earth, no planet found:
 * the engine makes some up; a star people know gets none, src/app/Systems.ts wellStudied)
 */
function generated(): PlanetarySystem {
  const named = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'stars', 'named.json'), 'utf8'));
  const L: string[] = named.layout;
  const row = named.stars.find((r: unknown[]) => (r[L.indexOf('names')] as string[]).includes('Gl 9848'));
  const at = (k: string) => row[L.indexOf(k)];
  const gl = new CatalogStar(`star:athyg:${at('node')}:${at('slot')}`, new Vector3(at('x_pc'), at('y_pc'), at('z_pc')), at('absMag'), at('teff'), at('spect'), at('names'), null);
  const sys = systems.of(gl);
  if (!sys || sys.real) throw new Error('Gl 9848 has a generated system');
  return sys;
}

/** live physics over one system, as the app runs it each frame: the clock advanced, the simulation followed, the bodies placed */
function setup(sys: PlanetarySystem, jd = JD) {
  const source = new PlanetarySim(sys);
  source.update(jd);
  const physics = new LivePhysics(source, { left: () => undefined, dropped: () => undefined });
  const clock = new SimClock(jd);
  const run = (to: number, step = 0.25) => {
    for (let n = 0; to - clock.jdTdb > 1e-9 && n < 1e6; n++) {
      clock.jdTdb = Math.min(to, clock.jdTdb + step);
      physics.follow(clock, 1);
      source.update(clock.jdTdb);
      physics.place(clock.jdTdb);
      source.place();
    }
  };
  return { source, physics, clock, run };
}

/** each planet's place and velocity about its star on the rail at `jd` */
function rails(sys: PlanetarySystem, jd: number): number[][] {
  return sys.planets.map((p) => {
    const r = new Vector3(), v = new Vector3();
    sys.state(p.spec, jd, r, v);
    return [...r.toArray(), ...v.toArray()];
  });
}

/** each planet's place and velocity about its star as the simulation has them now */
function about(source: PlanetarySim): number[][] {
  const s = source.sun;
  return source.bodies.filter((b) => b !== s).map((b) => [b.pos.x - s.pos.x, b.pos.y - s.pos.y, b.pos.z - s.pos.z, b.vel.x - s.vel.x, b.vel.y - s.vel.y, b.vel.z - s.vel.z]);
}

describe('another star\'s planets under live physics', () => {
  it('TRAPPIST-1 is taken from the archive: its star\'s measured mass, each planet\'s, and their measured sizes', () => {
    const source = new PlanetarySim(trappist);
    expect(trappist.real).toBe(true);
    expect(trappist.hostMass.from).toBe('measured');
    // the archive's 0.0898 solar masses
    expect(source.sun.gm / G / 1.98847e30).toBeCloseTo(0.0898 * (1.98892 / 1.98847), 6);
    expect(source.bodies.map((b) => b.name)).toEqual(['TRAPPIST-1', ...['b', 'c', 'd', 'e', 'f', 'g', 'h'].map((l) => `TRAPPIST-1 ${l}`)]);
    const e = source.bodies.find((b) => b.name === 'TRAPPIST-1 e')!;
    expect(e.gm / G / M_EARTH).toBeCloseTo(0.692, 10);
    expect(source.massKnown(e)).toBe('measured');
    expect(e.radiusEstimated).toBe(false);
    expect(source.simulable).toBe(true);
  });

  it('Proxima Centauri b: only its least mass is known (its star\'s wobble alone: the archive\'s "Msini") and its size was worked out, and the card and the Mass power say so', () => {
    // (the archive's own marks, read by pipeline/mark_estimates.py: before, the card gave both as measured)
    const proxima = systems.archiveSystem(systems.findHost('Proxima Cen')!)!;
    const b = proxima.planets.find((p) => p.spec.name === 'Proxima Cen b')!;
    expect(b.spec.est).toEqual(expect.arrayContaining(['massMin', 'radius']));
    expect(b.info().find(([k]) => k === 'Mass')![1]).toMatch(/^at least [\d.]+ Earth masses$/);
    expect(b.info().find(([k]) => k === 'Radius')![1]).toMatch(/\(estimated\)$/);
    const source = new PlanetarySim(proxima);
    const sb = source.bodies.find((x) => x.name === 'Proxima Cen b')!;
    expect(source.massKnown(sb)).toBe('least');
    expect(sb.radiusEstimated).toBe(true);
  });

  it('the archive\'s marks are all there: thousands of masses and sizes worked out, nearly a thousand least masses', () => {
    const d = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'exoplanets.json'), 'utf8')) as { systems: { planets: { est: string[] }[] | null }[] };
    const marks = (f: string) => d.systems.flatMap((x) => x.planets ?? []).filter((p) => p.est.includes(f)).length;
    expect(marks('mass')).toBeGreaterThan(2900);
    expect(marks('massMin')).toBeGreaterThan(900);
    expect(marks('radius')).toBeGreaterThan(1500);
  });

  for (const [label, sys] of [['TRAPPIST-1 (real)', () => trappist], ['a generated system', generated]] as const) {
    it(`${label}: turning live physics on moves nothing: each planet's place and velocity about its star are the rail's`, () => {
      const system = sys();
      const { source, physics } = setup(system);
      system.update(JD);
      const before = system.planets.map((p) => p.rel.clone());
      // (a change that changes nothing: the star given the mass it has)
      physics.setMass(source.sun, source.sun.gm, JD);
      expect(physics.on).toBe(true);
      source.attach();
      source.place();
      const want = rails(system, JD), got = about(source);
      for (let k = 0; k < want.length; k++) {
        const r = Math.hypot(want[k][0], want[k][1], want[k][2]), v = Math.hypot(want[k][3], want[k][4], want[k][5]);
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(got[k][c] - want[k][c])).toBeLessThan(1e-12 * r);
          expect(Math.abs(got[k][3 + c] - want[k][3 + c])).toBeLessThan(1e-12 * v);
        }
        // and drawn where the rail has it
        expect(system.planets[k].rel.distanceTo(before[k])).toBeLessThan(1e-12 * r);
      }
      // the centre of mass is at rest: the star swings about it, and does not drift away
      let px = 0, py = 0, pz = 0;
      for (const b of source.bodies) { px += b.gm * b.vel.x; py += b.gm * b.vel.y; pz += b.gm * b.vel.z; }
      expect(Math.hypot(px, py, pz) / source.sun.gm).toBeLessThan(1e-9);
      source.detach(JD);
    });
  }

  it('a generated system is marked generated, its star\'s mass the generator\'s', () => {
    const source = new PlanetarySim(generated());
    expect(source.system.hostMass.from).toBe('generated');
    expect(source.massKnown(source.sun)).toBe('generated');
    for (const b of source.bodies) if (b !== source.sun) { expect(source.massKnown(b)).toBe('generated'); expect(b.radiusEstimated).toBe(true); }
  });

  it('a star the archive gives no mass for is weighed by a measured orbit (Kepler\'s third law), else not at all', () => {
    const planet = { aAU: 0.05, periodDays: 4.2, massEarth: 100, est: [] as string[] };
    const m = hostMassOf({ massSun: null, planets: [{ ...planet, est: ['a'] }, planet] as never });
    expect(m.from).toBe('orbits');
    const a = 0.05 * AU, P = 4.2 * DAY;
    expect(m.kg).toBeCloseTo((4 * Math.PI ** 2 * a ** 3) / (6.674e-11 * P * P) - 100 * M_EARTH, -20);
    expect(hostMassOf({ massSun: null, planets: [{ ...planet, est: ['period'] }] as never })).toEqual({ kg: 0, from: 'unknown' });
    expect(hostMassOf({ massSun: 0.5, planets: [] })).toEqual({ kg: 0.5 * 1.98892e30, from: 'measured' });
  });

  it('a star whose measured planets\' orbits disagree with its mass (beyond a fifth less or a quarter more) is not simulated', () => {
    // a year's orbit at 1 AU says one Sun; at twice the period, a quarter of one
    const year = { aAU: 1, periodDays: 365.25, massEarth: 1, est: [] as string[] };
    expect(hostMassOf({ massSun: 1, planets: [year] as never }).from).toBe('measured');
    expect(hostMassOf({ massSun: 1.2, planets: [year] as never }).from).toBe('measured');
    const slow = { ...year, periodDays: 2 * 365.25 };
    const m = hostMassOf({ massSun: 1, planets: [year, slow] as never });
    expect(m).toEqual({ kg: 1.98892e30, from: 'disagree' });
    // an estimated period is the pipeline's, worked from the star's mass: it is not a measurement to disagree with
    expect(hostMassOf({ massSun: 1, planets: [year, { ...slow, est: ['period'] }] as never }).from).toBe('measured');
    // weighed by the innermost measured orbit, the next measured one is held to that weight
    expect(hostMassOf({ massSun: null, planets: [year, { ...slow, aAU: 1.6 }] as never }).from).toBe('orbits');
    expect(hostMassOf({ massSun: null, planets: [year, slow] as never }).from).toBe('disagree');
  });

  it('TRAPPIST-1 keeps its energy over a few orbits of its outermost planet (to a part in a million)', () => {
    const { source, physics, run } = setup(trappist);
    physics.setMass(source.sun, source.sun.gm, JD);
    const sim = physics.live!.sim;
    const e0 = sim.energy();
    // three of h's 18.8-day turns: 34 of b's
    run(JD + 3 * 18.77);
    expect(liveDate(physics.live!)).toBeCloseTo(JD + 3 * 18.77, 6);
    expect(Math.abs(sim.energy() / e0 - 1)).toBeLessThan(1e-6);
  });

  it('a Mass change pulls the planets another way, and its Undo brings back everything as it was, to the last bit', () => {
    const { source, physics, clock, run } = setup(trappist);
    const e = source.bodies.find((b) => b.name === 'TRAPPIST-1 e')!;
    const before = physics.checkpoint(clock.jdTdb);
    const real = e.gm;
    // (Mass on e: a thousand times its mass, as the slider's far end)
    physics.setMass(e, 1000 * real, clock.jdTdb);
    source.attach();
    expect(physics.on).toBe(true);
    expect(e.gm).toBe(1000 * real);
    expect(physics.realGm(e)).toBe(real);
    run(JD + 6);
    // its neighbours feel it: d and f are off the paths they would have had
    const changed = about(source);
    const undone = setup(trappist);
    undone.physics.setMass(undone.source.sun, undone.source.sun.gm, JD);
    undone.run(JD + 6);
    const plain = about(undone.source);
    const d = 2, f = 4;
    for (const k of [d, f]) expect(Math.hypot(changed[k][0] - plain[k][0], changed[k][1] - plain[k][1], changed[k][2] - plain[k][2])).toBeGreaterThan(1e5);
    // Undo: the real system, on its rails at the date it was changed
    physics.restore(before);
    clock.jdTdb = before.jd;
    source.detach(clock.jdTdb);
    expect(physics.on).toBe(false);
    expect(e.gm).toBe(real);
    trappist.update(JD);
    const r = rails(trappist, JD);
    trappist.planets.forEach((p, k) => expect(p.rel.toArray()).toEqual(r[k].slice(0, 3)));
    expect(trappist.host.upos.clone().sub(source.origin).length()).toBe(0);
  });

  it('Back to reality puts the star and its planets back on their rails, at the moment the first change was made', () => {
    const { source, physics, clock, run } = setup(trappist);
    const e = source.bodies.find((b) => b.name === 'TRAPPIST-1 e')!;
    // (Move: e put a tenth further out, its velocity kept; then the star made heavier, and time run on)
    physics.move(e, [1.1 * e.pos.x, 1.1 * e.pos.y, 1.1 * e.pos.z], e.vel.toArray(), JD);
    physics.setMass(source.sun, 2 * source.sun.gm, JD);
    source.attach();
    run(JD + 10);
    source.place();
    const moved = trappist.planets[3].rel.clone();
    trappist.update(JD + 10);
    expect(trappist.planets[3].rel.distanceTo(moved)).toBeLessThan(1e-9);
    const said = physics.backToReality(clock);
    source.detach(clock.jdTdb);
    expect(said).toBe('Back to reality, on 16 September 2026');
    expect(clock.jdTdb).toBe(JD);
    expect(physics.on).toBe(false);
    expect(source.sun.gm).toBe(G * trappist.hostMass.kg);
    expect(trappist.live).toBeNull();
    trappist.update(clock.jdTdb);
    const r = rails(trappist, JD);
    trappist.planets.forEach((p, k) => {
      expect(p.rel.toArray()).toEqual(r[k].slice(0, 3));
      expect(p.radius).toBe(p.spec.radiusM);
    });
  });

  it('Remove takes a planet out of the drawing and the simulation; Back to reality brings it back', () => {
    const { source, physics, clock } = setup(trappist);
    const h = source.bodies.find((b) => b.name === 'TRAPPIST-1 h')!;
    physics.remove(h, JD);
    source.attach();
    expect(source.gone(trappist.planets[6])).toBe(true);
    expect(physics.live!.sim.indexOf(h.id)).toBe(-1);
    expect(powersFor(trappist.planets[6], 0, { live: trappist }).mass.works).toBe(false);
    physics.backToReality(clock);
    source.detach(clock.jdTdb);
    expect(source.gone(trappist.planets[6])).toBe(false);
    expect(h.valid).toBe(true);
  });

  it('the one table says Mass, Size, Move and Remove work on TRAPPIST-1 e, and Mass, Move and Remove on its star', () => {
    const working = (t: PowerTable) => (['mass', 'size', 'move', 'add', 'remove'] as const).filter((k) => t[k].works);
    const e = trappist.planets.find((p) => p.name === 'TRAPPIST-1 e')!;
    expect(working(powersFor(e))).toEqual(['mass', 'size', 'move', 'remove']);
    expect(working(powersFor(trappist.host, 0, { system: trappist }))).toEqual(['mass', 'move', 'remove']);
    expect(working(powersFor(generated().planets[0]))).toEqual(['mass', 'move', 'remove']);
    // and none while live physics runs round the Sun
    expect(working(powersFor(e, 0, { live: 'solar' }))).toEqual([]);
  });

});

describe('the zones round a small star (src/app/WhatIf.ts: zonesOf)', () => {
  it('round the Sun they are as they were: the frost line at 3 AU, the nearest planet 0.1 AU, the nearest sun 0.3 AU, the farthest 60 AU', () => {
    expect(SUN_ZONES).toEqual({ frost: 3 * AU, nearestPlanet: 0.1 * AU, nearestSun: 0.3 * AU, farthest: 60 * AU });
    expect(zonesOf(1, 1)).toEqual(SUN_ZONES);
  });

  it('round TRAPPIST-1 they shrink with its light and mass: the frost line among its planets, not 3 AU out', () => {
    // the archive's TRAPPIST-1: 0.1192 of the Sun's radius, 2,566 K, 0.0898 of its mass; its light by Stefan and Boltzmann
    const L = luminosity(0.1192 * 695_700e3, 2566).value;
    expect(L).toBeGreaterThan(5e-4);
    expect(L).toBeLessThan(6e-4);
    const z = zonesOf(L, 0.0898);
    expect(z.frost / AU).toBeGreaterThan(0.06);
    expect(z.frost / AU).toBeLessThan(0.08);
    // nearer than its innermost planet (b, 0.0115 AU) a planet can still be made
    expect(z.nearestPlanet / AU).toBeLessThan(0.0115);
    expect(z.farthest / AU).toBeCloseTo(60 * Math.sqrt(0.0898), 10);
    // a moon made 0.1 AU from it is icy; 0.1 AU from the Sun it would be rock
    const world = new Body(1, 'Test world', 'planet');
    world.gm = G * 5.9722e24;
    world.radius = R_EARTH;
    world.radii = [R_EARTH, R_EARTH, R_EARTH];
    expect(newMoon(world, [10 * R_EARTH, 0, 0], 0.1 * AU, 0, 900_000_001, z).json.madeAs?.icy).toBe(true);
    expect(newMoon(world, [10 * R_EARTH, 0, 0], 0.1 * AU, 0, 900_000_001).json.madeAs?.icy).toBe(false);
  });
});
