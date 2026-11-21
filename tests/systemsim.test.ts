import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { NBody } from '../src/sim/NBody';
import { apply, capture, liveDate, release } from '../src/sim/SystemSim';
import type { Body } from '../src/universe/Body';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it: its catalogue and the JPL ephemeris, read from public/ as the browser fetches them.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const AU = 149_597_870_700, DAY = 86_400, YEAR = 365.25 * DAY;
const JD = 2461300.5; // 2026-09-17 (TDB)
let sys: SolarSystem;

/** The system at a date, the ephemeris for it loaded. */
async function at(jd: number): Promise<SolarSystem> {
  await sys.ephemeris.request(jd);
  sys.update(jd);
  return sys;
}

beforeAll(async () => {
  sys = await SolarSystem.load('/data');
  await at(JD);
});

const planets = (b: Body) => b.kind === 'star' || b.kind === 'planet';
const near = (sim: NBody, id: number, b: Body) => {
  const i = 3 * sim.indexOf(id);
  return Math.hypot(sim.pos[i] - b.pos.x, sim.pos[i + 1] - b.pos.y, sim.pos[i + 2] - b.pos.z);
};
const named = (name: string) => sys.bodies.find((b) => b.name === name)!;

describe('from the app’s bodies and back', () => {
  it('starts where the bodies are, as they move, and hands them back without a jump', async () => {
    const live = capture(sys, JD);
    const { sim } = live;
    sim.read();
    // every body with a mass (the planets, 44 moons, dwarf planets and asteroids with measured masses)
    expect(sim.count).toBe(sys.bodies.filter((b) => b.valid && b.gm > 0).length);
    for (const b of [sys.sun, named('Earth'), named('Moon'), named('Titan')]) {
      const i = 3 * sim.indexOf(b.id);
      expect(near(sim, b.id, b), b.name).toBe(0);
      expect(Math.hypot(sim.vel[i] - b.vel.x, sim.vel[i + 1] - b.vel.y, sim.vel[i + 2] - b.vel.z), b.name).toBe(0);
    }
    // Mars stands for its family (its moons have masses too small to step: they are in the catalogue but not here)
    expect(live.carried.has(499)).toBe(false);
    sim.advance(0);
    await at(liveDate(live));
    const before = sys.bodies.map((b) => b.pos.clone());
    apply(live, sys);
    let worst = 0;
    sys.bodies.forEach((b, k) => { if (b.valid) worst = Math.max(worst, b.pos.distanceTo(before[k])); });
    // (the ephemeris's place plus the simulation's less the ephemeris's, rounded at a millionth of a millionth of an AU)
    expect(worst).toBeLessThan(1e-2);
  });

  it('lets a planet whose moons are left out stand for its family, and carries the moons round it', async () => {
    const live = capture(sys, JD, planets);
    const { sim } = live;
    const jupiter = named('Jupiter'), io = named('Io');
    // its mass is the family's, its place the family's centre (the ephemeris's barycentre)
    expect(sim.gm[sim.indexOf(599)]).toBe(jupiter.systemGm);
    expect(live.carried.get(599)!.map((m) => m.name)).toEqual(expect.arrayContaining(['Io', 'Europa', 'Ganymede', 'Callisto']));
    sim.read();
    const bary = jupiter.pos.clone().multiplyScalar(jupiter.gm);
    for (const m of jupiter.children) if (m.gm > 0) bary.addScaledVector(m.pos, m.gm);
    bary.divideScalar(jupiter.gm + jupiter.children.reduce((g, m) => g + m.gm, 0));
    expect(near(sim, 599, { pos: bary } as Body)).toBeLessThan(1);
    // ten years on: Io is where its own orbit puts it about Jupiter, Jupiter where the simulation has its family
    sim.advance(10 * YEAR);
    await at(liveDate(live));
    const ioAbout = io.pos.clone().sub(jupiter.pos);
    apply(live, sys);
    expect(io.pos.clone().sub(jupiter.pos).distanceTo(ioAbout)).toBeLessThan(1e-3);
    // (and an asteroid goes round the Sun as before: it rides on the Sun)
    const ceres = named('Ceres');
    expect(ceres.pos.clone().sub(sys.sun.pos).length() / AU).toBeGreaterThan(2.5);
  });

  it('simulates a moon its planet stood for, when asked, keeping the family’s centre', async () => {
    const live = capture(sys, JD, planets);
    live.sim.advance(100 * DAY);
    await at(liveDate(live));
    apply(live, sys);
    const { sim } = live;
    sim.read();
    const j = 3 * sim.indexOf(599);
    const centre = [sim.pos[j], sim.pos[j + 1], sim.pos[j + 2]], gm = sim.gm[sim.indexOf(599)];
    const io = named('Io');
    release(live, sys, io);
    sim.read();
    const k = 3 * sim.indexOf(599), i = 3 * sim.indexOf(io.id);
    expect(sim.gm[sim.indexOf(599)] + sim.gm[sim.indexOf(io.id)]).toBeCloseTo(gm, 6);
    for (let c = 0; c < 3; c++) {
      const now = (sim.gm[k / 3] * sim.pos[k + c] + io.gm * sim.pos[i + c]) / gm;
      expect(Math.abs(now - centre[c])).toBeLessThan(1);
    }
    expect(near(sim, io.id, io)).toBe(0);
  });
});

describe('the Solar System, simulated', () => {
  it('keeps its energy and momentum over three thousand years', () => {
    // (and its angular momentum but for what the planets' bulges trade with their spins, which are not
    // simulated: their poles are held, and the orbits' share changes by parts in a billion; where nothing
    // is flattened it is kept to rounding, tests/nbody.test.ts)
    const { sim } = capture(sys, JD, planets);
    const E0 = sim.energy(), P0 = sim.momentum(), L0 = sim.angularMomentum();
    let dE = 0, dP = 0;
    for (let k = 0; k < 30; k++) {
      sim.advance(100 * YEAR);
      dE = Math.max(dE, Math.abs(sim.energy() / E0 - 1));
      const P = sim.momentum();
      dP = Math.max(dP, Math.hypot(P[0] - P0[0], P[1] - P0[1], P[2] - P0[2]));
    }
    const L = sim.angularMomentum();
    const dL = Math.hypot(L[0] - L0[0], L[1] - L0[1], L[2] - L0[2]) / Math.hypot(L0[0], L0[1], L0[2]);
    console.log(`planets over 3,000 years: |ΔE/E| ≤ ${dE.toExponential(1)}, |ΔL/L| ${dL.toExponential(1)}`);
    expect(dE).toBeLessThan(1e-11);
    // (the Sun's momentum is 1e29 kg m/s about the barycentre: this is rounding)
    expect(dP).toBeLessThan(1e17);
    expect(dL).toBeLessThan(3e-8);
  }, 60_000);

  it('keeps a giant’s inner moons on their periods: its bulge is in the pull', async () => {
    const io = named('Io'), jupiter = named('Jupiter');
    // Io's period, by the angle it turns through about Jupiter in 100 days, sampled every 0.1 day
    const period = async (where: (k: number) => Promise<[number, number, number, number]>) => {
      let turned = 0, last = 0;
      for (let k = 0; k <= 1000; k++) {
        const [jx, jy, ix, iy] = await where(k);
        const a = Math.atan2(iy - jy, ix - jx);
        if (k > 0) turned += ((a - last + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        last = a;
      }
      return (2 * Math.PI * 100) / Math.abs(turned);
    };
    const simulated = (sim: NBody) => async (k: number): Promise<[number, number, number, number]> => {
      sim.advance(k * 0.1 * DAY - sim.time);
      sim.read();
      const j = 3 * sim.indexOf(599), i = 3 * sim.indexOf(io.id);
      return [sim.pos[j], sim.pos[j + 1], sim.pos[i], sim.pos[i + 1]];
    };
    const { sim } = capture(sys, JD, (b) => planets(b) || (b.parent === jupiter && b.gm > 0));
    // the same bodies, Jupiter a point
    sim.read();
    const point = new NBody();
    for (let i = 0; i < sim.count; i++) point.add({ id: sim.ids[i], gm: sim.gm[i], radius: sim.radius[i], pos: sim.pos.subarray(3 * i, 3 * i + 3), vel: sim.vel.subarray(3 * i, 3 * i + 3) });
    const app = await period(async (k) => {
      await at(JD + 0.1 * k);
      return [jupiter.pos.x, jupiter.pos.y, io.pos.x, io.pos.y];
    });
    const bulged = await period(simulated(sim)), flat = await period(simulated(point));
    console.log(`Io's period: ${app.toFixed(6)} d in the app's ephemeris, ${bulged.toFixed(6)} d simulated, ${flat.toFixed(6)} d with Jupiter a point`);
    // The bulge makes up the 0.14 % that 1.5 J₂ (R/a)² twice over (in the pull, and in the orbit the same start
    // gives) says it should. What is left, 0.05 %, is the catalogue's own: its mean elements put Io at 421,800 km,
    // where Kepler's law with Jupiter's bulge gives 1.76940 days, against the 1.76913 its fitted longitude moves at.
    expect(Math.abs(bulged / app - 1)).toBeLessThan(6e-4);
    expect(flat / bulged - 1).toBeGreaterThan(1.2e-3);
  }, 60_000);

  it('gives the Earth its year and the Moon its month, and they stay right', async () => {
    const live = capture(sys, JD, (b) => planets(b) || b.name === 'Moon');
    const { sim } = live;
    sim.steps = 32;
    const earth = named('Earth'), moon = named('Moon');
    // the angle the Moon has turned through about the Earth, and the Earth about the Sun, in each
    const turned = { sim: [0, 0], de: [0, 0] }, last = { sim: [0, 0], de: [0, 0] };
    const angles = (ex: number[], mx: number[], sx: number[]) => [Math.atan2(mx[1] - ex[1], mx[0] - ex[0]), Math.atan2(ex[1] - sx[1], ex[0] - sx[0])];
    for (let d = 0; d <= 50 * 365; d += 10) {
      sim.advance(d * DAY - sim.time);
      sim.read();
      const pick = (id: number) => { const i = 3 * sim.indexOf(id); return [sim.pos[i], sim.pos[i + 1]]; };
      const a = angles(pick(399), pick(301), pick(10));
      await at(JD + d);
      const b = angles([earth.pos.x, earth.pos.y], [moon.pos.x, moon.pos.y], [sys.sun.pos.x, sys.sun.pos.y]);
      for (const [key, now] of [['sim', a], ['de', b]] as const) {
        for (let k = 0; k < 2; k++) {
          if (d > 0) turned[key][k] += ((now[k] - last[key][k] + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
          last[key][k] = now[k];
        }
      }
      if (d === 10 * 365 || d === 50 * 365) {
        const dm = Math.hypot(...[0, 1, 2].map((c) => sim.pos[3 * sim.indexOf(301) + c] - sim.pos[3 * sim.indexOf(399) + c] - (moon.pos.getComponent(c) - earth.pos.getComponent(c))));
        console.log(`after ${d / 365} years: the Moon is ${(dm / 1e3).toFixed(0)} km from where the ephemeris has it about the Earth, the Earth ${(near(sim, 399, earth) / 1e3).toFixed(0)} km from its place`);
      }
    }
    const span = 50 * 365 * DAY;
    const month = (2 * Math.PI * span) / turned.sim[0], monthDE = (2 * Math.PI * span) / turned.de[0];
    const year = (2 * Math.PI * span) / turned.sim[1], yearDE = (2 * Math.PI * span) / turned.de[1];
    console.log(`over 50 years: month ${(month / DAY).toFixed(6)} d (ephemeris ${(monthDE / DAY).toFixed(6)}), year ${(year / DAY).toFixed(5)} d (ephemeris ${(yearDE / DAY).toFixed(5)})`);
    // (turning in the plane of the sky's x and y, so not quite the sidereal 27.3217 d and 365.2564 d, which are in
    // the orbits' own planes: the same measure for both.) What is left, a second in the month and four in the
    // year, is as much as the app's ephemeris can judge: it keeps its polynomials' terms in 32-bit floats, and
    // the velocities taken from them are good to about one part in ten million. Relativity, which the
    // ephemeris has and the simulation does not, is about as large in the year.
    expect(Math.abs(month / monthDE - 1)).toBeLessThan(6e-7);
    expect(Math.abs(year / yearDE - 1)).toBeLessThan(3e-7);
  }, 60_000);

  it('runs back to where it started', () => {
    const { sim } = capture(sys, JD, (b) => planets(b) || b.name === 'Moon');
    sim.read();
    const start = Float64Array.from(sim.pos);
    sim.advance(1000 * YEAR);
    sim.advance(-1000 * YEAR);
    sim.read();
    let worst = 0;
    for (let i = 0; i < sim.count; i++) worst = Math.max(worst, Math.hypot(sim.pos[3 * i] - start[3 * i], sim.pos[3 * i + 1] - start[3 * i + 1], sim.pos[3 * i + 2] - start[3 * i + 2]));
    console.log(`a thousand years there and back: ${worst.toFixed(1)} m from the start`);
    expect(worst).toBeLessThan(1e3);
  }, 60_000);
});

describe('powers', () => {
  it('with the Sun taken away, every planet goes off in a straight line at its orbital speed', () => {
    const { sim } = capture(sys, JD, planets);
    sim.read();
    const x0 = Float64Array.from(sim.pos), v0 = Float64Array.from(sim.vel), ids = Array.from(sim.ids);
    sim.remove(10);
    sim.advance(100 * YEAR);
    sim.read();
    // (Jupiter, the heaviest, is what is left of the system: the others are told leaving it)
    const unbound = sim.takeEvents().flatMap((e) => (e.kind === 'unbound' ? e.ids : []));
    for (let k = 0; k < sim.count; k++) {
      const i = ids.indexOf(sim.ids[k]);
      const v = Math.hypot(v0[3 * i], v0[3 * i + 1], v0[3 * i + 2]);
      // (the planets still pull on one another: Mars, which passes Jupiter at 0.8 AU, is turned by 0.3 % of its way)
      const off = Math.hypot(...[0, 1, 2].map((c) => sim.pos[3 * k + c] - x0[3 * i + c] - v0[3 * i + c] * 100 * YEAR));
      expect(off / (v * 100 * YEAR), `planet ${sim.ids[k]}`).toBeLessThan(5e-3);
      expect(Math.hypot(sim.vel[3 * k], sim.vel[3 * k + 1], sim.vel[3 * k + 2]) / v, `planet ${sim.ids[k]}`).toBeCloseTo(1, 2);
      if (sim.ids[k] !== 599) expect(unbound, `planet ${sim.ids[k]}`).toContain(sim.ids[k]);
    }
  });

  it('a second Jupiter in the inner system throws it into disorder', () => {
    const run = (twin: boolean) => {
      const { sim } = capture(sys, JD, planets);
      const jupiter = named('Jupiter');
      if (twin) {
        // a Jupiter on a circular orbit at 1.6 AU, in the plane of the Earth's orbit, Mars's neighbour
        const r = 1.6 * AU, v = Math.sqrt((sys.sun.gm + jupiter.systemGm) / r);
        sim.add({ id: 5990, gm: jupiter.systemGm, radius: jupiter.radius, pos: [sys.sun.pos.x + r, sys.sun.pos.y, sys.sun.pos.z], vel: [sys.sun.vel.x, sys.sun.vel.y + v * 0.9175, sys.sun.vel.z + v * 0.3978] });
      }
      const E0 = sim.energy();
      let ecc = 0;
      const events: string[] = [];
      for (let k = 0; k < 100; k++) {
        sim.advance(10 * YEAR);
        sim.read();
        // Mars's eccentricity about the Sun
        const s = 3 * sim.indexOf(10), i = 3 * sim.indexOf(499);
        const r = [0, 1, 2].map((c) => sim.pos[i + c] - sim.pos[s + c]), w = [0, 1, 2].map((c) => sim.vel[i + c] - sim.vel[s + c]);
        const mu = sim.gm[s / 3] + sim.gm[i / 3], rr = Math.hypot(...r), w2 = w[0] ** 2 + w[1] ** 2 + w[2] ** 2;
        const h2 = (r[1] * w[2] - r[2] * w[1]) ** 2 + (r[2] * w[0] - r[0] * w[2]) ** 2 + (r[0] * w[1] - r[1] * w[0]) ** 2;
        ecc = Math.max(ecc, Math.sqrt(Math.max(0, 1 + (2 * (w2 / 2 - mu / rr) * h2) / (mu * mu))));
        for (const e of sim.takeEvents()) events.push(e.kind === 'encounter' ? `encounter ${e.a}-${e.b}` : e.kind === 'orbit' ? `${e.id} round ${e.around}` : e.kind);
      }
      return { ecc, events, dE: Math.abs(sim.energy() / E0 - 1) };
    };
    const calm = run(false), wild = run(true);
    console.log(`a thousand years: Mars's eccentricity at most ${calm.ecc.toFixed(3)} without, ${wild.ecc.toFixed(3)} with a second Jupiter; ${wild.events.length} events (${[...new Set(wild.events)].join(', ')}); energy kept to ${wild.dE.toExponential(1)}`);
    expect(calm.ecc).toBeLessThan(0.1);
    expect(calm.events).toEqual([]);
    expect(wild.ecc).toBeGreaterThan(0.2);
    expect(wild.events.some((e) => e.includes('5990'))).toBe(true);
    // (through Mars's capture by the second Jupiter and its many close passes)
    expect(wild.dE).toBeLessThan(3e-7);
  }, 60_000);
});

describe('speed', () => {
  // (measured, not promised: a shared machine's numbers wander. The bounds are a tenth of what is
  // measured here, to catch a slowing of that order; the notes, docs/notes/gravity-engine.md, give
  // what was measured and what a phone may do)
  const run = (name: string, pick: (b: Body) => boolean, railsBelow: number) => {
    const { sim } = capture(sys, JD, pick);
    sim.railsBelow = railsBelow;
    sim.advance(1e13, 100);
    let frames = 0;
    const t0 = performance.now(), from = sim.time;
    while (performance.now() - t0 < 600) { sim.advance(1e13, 8); sim.read(); frames++; }
    const seconds = (performance.now() - t0) / 1000, years = (sim.time - from) / YEAR / seconds;
    const r = sim.report();
    console.log(`${name}: ${sim.count} bodies, step ${(r.step / DAY).toFixed(3)} d (set by ${r.setBy}), ${r.rails.length} families on rails: ${years >= 1 ? `${years.toPrecision(3)} years` : `${(years * 365.25).toPrecision(3)} days`} a second of work in frames of 8 ms`);
    return years;
  };

  it('the Sun and the planets: thousands of years a second', () => {
    expect(run('Sun and planets', planets, 0)).toBeGreaterThan(150);
  });

  it('with the large moons: tens of years a second, more with their families on rails', () => {
    const big = (b: Body) => planets(b) || (b.kind === 'moon' && b.gm > 1e11);
    expect(run('with 11 large moons', big, 0)).toBeGreaterThan(1.5);
    expect(run('with 11 large moons, orbits under 100 days on rails', big, 100 * DAY)).toBeGreaterThan(50);
  });

  it('everything in the catalogue: days a second, years with the moons on rails', () => {
    expect(run('all 771 bodies', () => true, 0)).toBeGreaterThan(0.005);
    expect(run('all 771 bodies, orbits under 2 years on rails', () => true, 2 * YEAR)).toBeGreaterThan(0.5);
  }, 60_000);
});
