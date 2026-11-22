import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import { circularVelocity } from '../src/app/Powers';
import { MADE_FIRST_ID, newMoon } from '../src/app/WhatIf';
import { SimClock } from '../src/core/time';
import { liveDate } from '../src/sim/SystemSim';
import type { Body } from '../src/universe/Body';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it: its catalogue and the JPL ephemeris, read from public/ as the browser fetches them.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const DAY = 86_400, YEAR = 365.25 * DAY, AU = 149_597_870_700;
const JD = 2461300.5; // 2026-09-17 (TDB)

/** The system at a date (the ephemeris for it loaded), live physics over it, and what the scene was told. */
async function setup(jd = JD) {
  const sys = await SolarSystem.load('/data');
  await sys.ephemeris.request(jd);
  sys.update(jd);
  const left: [string, string | null][] = [];
  const dropped: string[] = [];
  const physics = new LivePhysics(sys, { left: (b, into) => left.push([b.name, into?.name ?? null]), dropped: (b) => dropped.push(b.name) });
  const clock = new SimClock(jd);
  const named = (name: string) => sys.bodies.find((b) => b.name === name)!;
  /** run the clock on to `to` as the app's frames do: the clock is advanced, the simulation follows, the bodies are placed */
  const run = (to: number, step = 0.5) => {
    const way = Math.sign(to - clock.jdTdb);
    for (let n = 0; way * (to - clock.jdTdb) > 1e-9 && n < 1e6; n++) {
      clock.jdTdb = way > 0 ? Math.min(to, clock.jdTdb + step) : Math.max(to, clock.jdTdb - step);
      physics.follow(clock, 1);
      sys.update(clock.jdTdb);
      physics.place(clock.jdTdb);
    }
  };
  return { sys, physics, clock, named, run, left, dropped };
}

const state = (b: Body) => [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z];

describe('live physics', () => {
  it('does nothing until something is changed; the first change starts it from where everything is, and moves nothing', async () => {
    const { sys, physics, clock, named } = await setup();
    expect(physics.on).toBe(false);
    physics.follow(clock, 1 / 60);
    physics.place(JD);
    expect(physics.status()).toBeNull();
    expect(physics.rows(named('Earth'))).toEqual([]);
    const before = sys.bodies.map(state);
    // (a change that changes nothing: Jupiter given the mass it has)
    physics.setMass(named('Jupiter'), named('Jupiter').gm, JD);
    expect(physics.on).toBe(true);
    let worst = 0;
    sys.bodies.forEach((b, k) => { if (b.valid) worst = Math.max(worst, Math.hypot(b.pos.x - before[k][0], b.pos.y - before[k][1], b.pos.z - before[k][2])); });
    expect(worst).toBeLessThan(1e-2);
    // the worlds heavy enough to matter are simulated, and, Jupiter having been touched, every moon of Jupiter's;
    // a small moon of a planet that has not been touched, and a world nobody has weighed, keep their catalogued paths
    expect(physics.simulated(named('Earth'))).toBe(true);
    expect(physics.simulated(named('Io'))).toBe(true);
    expect(physics.simulated(named('Mimas'))).toBe(true);
    expect(physics.simulated(named('Carme'))).toBe(true);
    expect(physics.simulated(named('Metis'))).toBe(true);
    expect(physics.simulated(named('Phobos'))).toBe(false);
    expect(physics.simulated(named('Eris'))).toBe(false);
    expect(physics.live!.sim.count).toBe(sys.bodies.filter((b) => (b.gm > 0 && (b.kind !== 'moon' || b.gm >= 1e9)) || sys.homeOf(b) === named('Jupiter')).length);
    // each goes round what the catalogue says it does
    for (const b of sys.bodies) expect(b.parent, b.name).toBe(sys.homeOf(b));
  });

  it('doubling Jupiter\'s mass shortens its moons\' periods as Kepler says', async () => {
    const { physics, clock, named, run } = await setup();
    const jupiter = named('Jupiter'), io = named('Io');
    const gm = jupiter.gm;
    physics.setMass(jupiter, jupiter.gm, JD);
    const was = physics.orbit(io)!;
    expect(was.period / DAY).toBeCloseTo(1.77, 1);
    physics.setMass(jupiter, 2 * gm, JD);
    expect(jupiter.gm).toBe(2 * gm);
    expect(physics.realGm(jupiter)).toBe(gm);
    // from where Io is and how it moves, about twice the mass: P = 2π √(a³ / GM), a from 1/a = 2/r − v²/GM
    const now = physics.orbit(io)!;
    const r = io.pos.distanceTo(jupiter.pos), v2 = io.vel.distanceToSquared(jupiter.vel), mu = jupiter.gm + io.gm;
    const a = 1 / (2 / r - v2 / mu);
    expect(now.period).toBeCloseTo(2 * Math.PI * Math.sqrt(a ** 3 / mu), 6);
    expect(now.period / was.period).toBeLessThan(0.4);
    // and it goes round in that time: the angle turned through about Jupiter, in steps of a hundredth of it
    const dir = () => io.pos.clone().sub(jupiter.pos).normalize();
    let turned = 0, last = dir();
    for (let k = 1; k <= 100; k++) {
      run(JD + (k * now.period) / DAY / 100, 1);
      const d = dir();
      turned += Math.acos(Math.min(1, last.dot(d)));
      last = d;
    }
    expect(clock.jdTdb).toBeCloseTo(JD + now.period / DAY, 9);
    // (the other moons and Jupiter's bulge pull too: a turn to within a part in a hundred)
    expect(turned / (2 * Math.PI)).toBeGreaterThan(0.99);
    expect(turned / (2 * Math.PI)).toBeLessThan(1.01);
  });

  it('with the Sun taken away every planet leaves on a straight line at its orbital speed, in the dark, and it is told', async () => {
    const { sys, physics, clock, named, run, left } = await setup();
    const planets = sys.bodies.filter((b) => b.kind === 'planet');
    const start = new Map(planets.map((b) => [b, state(b)]));
    expect(sys.suns).toEqual([sys.sun]);
    expect(physics.sunAsWas).toBe(true);
    physics.remove(sys.sun, JD);
    expect(left).toEqual([['Sun', null]]);
    expect(sys.suns).toEqual([]);
    expect(sys.sunAt(named('Earth').pos)).toBeNull();
    expect(physics.sunAsWas).toBe(false);
    const news = physics.takeNews();
    expect(news[0]).toBe('The Sun is gone.');
    // (the worlds by name, the heaviest first; the asteroids that left with them only counted)
    expect(news[1]).toMatch(/^Saturn, \w+ and \d+ others are flying free: nothing holds them now\. So are \d+ smaller bodies\.$/);
    run(JD + 30, 1);
    expect(clock.jdTdb).toBe(JD + 30);
    expect(sys.sun.valid).toBe(false);
    for (const b of planets) {
      const s = start.get(b)!, t = 30 * DAY;
      const went = Math.hypot(s[3], s[4], s[5]) * t;
      const off = Math.hypot(b.pos.x - s[0] - s[3] * t, b.pos.y - s[1] - s[4] * t, b.pos.z - s[2] - s[5] * t);
      // (a planet with moons goes round its family's centre as it leaves: the Earth by 4,700 km in 78 million)
      expect(off / went, b.name).toBeLessThan(1e-3);
      expect(b.parent, b.name).toBeNull();
    }
    // the Moon is still the Earth's, and the asteroids that rode on the Sun fly on by themselves
    expect(named('Moon').parent).toBe(named('Earth'));
    expect(physics.simulated(named('Eris'))).toBe(true);
    expect(physics.rows(named('Earth'))[1]).toEqual(['Goes round', 'nothing: it flies free']);
  });

  it('back to reality puts every body exactly where the ephemeris has it, as the catalogue has it, at the moment the first change was made', async () => {
    const { sys, physics, clock, named, run } = await setup();
    physics.setMass(named('Jupiter'), 300 * named('Jupiter').gm, JD);
    physics.remove(named('Mars'), JD);
    physics.remove(named('Titan'), JD);
    run(JD + 20, 2);
    expect(named('Mars').valid).toBe(false);
    // (everything after the first change belongs to the changed world, the time it ran on included)
    expect(physics.backToReality(clock)).toBe('Back to reality, on 16 September 2026');
    expect(physics.on).toBe(false);
    expect(clock.jdTdb).toBe(JD);
    // a system that was never touched, at the same date
    const fresh = await SolarSystem.load('/data');
    await fresh.ephemeris.request(JD);
    fresh.update(JD);
    expect(sys.bodies.length).toBe(fresh.bodies.length);
    sys.bodies.forEach((b, k) => {
      const f = fresh.bodies[k];
      expect(state(b), b.name).toEqual(state(f));
      expect([b.valid, b.gm, b.systemGm, b.radius, ...b.radii], b.name).toEqual([f.valid, f.gm, f.systemGm, f.radius, ...f.radii]);
      expect(b.parent?.id, b.name).toBe(f.parent?.id);
      expect(b.children.map((c) => c.id), b.name).toEqual(f.children.map((c) => c.id));
      expect(Array.from(b.orientation.elements), b.name).toEqual(Array.from(f.orientation.elements));
    });
    expect(sys.suns).toEqual([sys.sun]);
  }, 60_000);

  it('from beyond the years the ephemeris knows, reality is the moment it began too', async () => {
    const { physics, clock, named } = await setup();
    physics.remove(named('Ceres'), JD);
    // (a hundred and thirty years on, the moons carried on rails to get there in a moment)
    const sim = physics.live!.sim;
    sim.railsBelow = 2 * YEAR;
    sim.advance(130 * YEAR);
    clock.jdTdb = liveDate(physics.live!);
    expect(physics.backToReality(clock)).toBe('Back to reality, on 16 September 2026');
    expect(clock.jdTdb).toBe(JD);
    expect(named('Ceres').valid).toBe(true);
  });

  it('two bodies that meet become one: the scene is told, the survivor has the mass and the volume of both', async () => {
    const { sys, physics, named, run, left } = await setup();
    const earth = named('Earth'), moon = named('Moon');
    const gm = earth.gm + moon.gm, radius = Math.cbrt(earth.radius ** 3 + moon.radius ** 3);
    physics.setMass(earth, earth.gm, JD);
    // the Moon sent straight at the Earth at 10 km/s
    const to = earth.pos.clone().sub(moon.pos).normalize();
    physics.live!.sim.setState(moon.id, moon.pos.toArray(), earth.vel.clone().addScaledVector(to, 10e3).toArray());
    run(JD + 1, 0.05);
    expect(left).toEqual([['Moon', 'Earth']]);
    expect(sys.isGone(moon)).toBe(true);
    expect(moon.valid).toBe(false);
    expect(earth.gm).toBeCloseTo(gm, -3);
    expect(earth.radius).toBeCloseTo(radius, 3);
    expect(earth.radii[2] / earth.radii[0]).toBeCloseTo(6356.752 / 6378.137, 4);
    const told = physics.takeNews().find((n) => n.startsWith('The Moon hit'));
    // (10 km/s, and what falling the last 380,000 km adds: 14 km/s where the two spheres touch)
    expect(told).toMatch(/^The Moon hit Earth at 1[345](\.\d)? km\/s and is part of it now\.$/);
    expect(physics.status()!.log[0].text).toBe(told);
    expect(physics.status()!.log[0].day).toBe('17 September 2026');
  });

  it('the Moon moved to twice its distance and left on a circle there: its month is the 2.83 months Kepler gives it', async () => {
    const { physics, named, run } = await setup();
    const earth = named('Earth'), moon = named('Moon');
    const r = moon.pos.clone().sub(earth.pos), w = moon.vel.clone().sub(earth.vel);
    const mu = earth.gm + moon.gm, normal = r.clone().cross(w).normalize();
    const to = r.clone().multiplyScalar(2);
    expect(physics.swayAt(earth.pos.clone().add(to).toArray(), moon)).toBe(earth);
    const v = circularVelocity(to.toArray(), mu, normal.toArray());
    physics.move(moon, earth.pos.clone().add(to).toArray(), [earth.vel.x + v[0], earth.vel.y + v[1], earth.vel.z + v[2]], JD);
    expect(physics.on).toBe(true);
    expect(moon.pos.distanceTo(earth.pos) / r.length()).toBeCloseTo(2, 9);
    const o = physics.orbit(moon)!;
    expect(o.e).toBeLessThan(1e-6);
    const month = 2 * Math.PI * Math.sqrt(to.length() ** 3 / mu);
    expect(o.period / month).toBeCloseTo(1, 9);
    expect(month / DAY).toBeGreaterThan(70);
    // and so it goes: a tenth of that month on, a tenth of the way round (the Sun pulls hard out there: to a twentieth)
    const from = moon.pos.clone().sub(earth.pos).normalize();
    run(JD + month / DAY / 10, 0.5);
    const turned = Math.acos(from.dot(moon.pos.clone().sub(earth.pos).normalize()));
    expect(turned / (2 * Math.PI / 10)).toBeGreaterThan(0.95);
    expect(turned / (2 * Math.PI / 10)).toBeLessThan(1.05);
    expect(moon.parent).toBe(earth);
  });

  it('a planet moved keeps its moons: the Earth put at twice its distance with the speed it had, the Moon still round it', async () => {
    const { sys, physics, named } = await setup();
    const earth = named('Earth'), moon = named('Moon'), sun = sys.sun;
    physics.setMass(earth, earth.gm, JD);
    const before = physics.orbit(moon)!;
    const about = moon.pos.clone().sub(earth.pos);
    const to = sun.pos.clone().add(earth.pos.clone().sub(sun.pos).multiplyScalar(2));
    const speed = earth.vel.clone().sub(sun.vel).lengthSq();
    physics.move(earth, to.toArray(), earth.vel.toArray(), JD);
    expect(earth.pos.distanceTo(to)).toBeLessThan(1e-3);
    // the Moon is where it was about the Earth, on the orbit it was on
    expect(moon.pos.clone().sub(earth.pos).distanceTo(about)).toBeLessThan(1e-3);
    const after = physics.orbit(moon)!;
    expect(after.e).toBeCloseTo(before.e, 9);
    expect(after.period / before.period).toBeCloseTo(1, 9);
    // the Earth, twice as far out with the speed of its old orbit, is past the speed of escape there: v² = 2GM/r
    const o = physics.orbit(earth)!, mu = sun.gm + earth.gm, r = earth.pos.distanceTo(sun.pos);
    expect(speed / ((2 * mu) / r)).toBeGreaterThan(0.95);
    expect(o.e).toBeGreaterThan(0.9);
    // what holds sway where: the Sun out there, the Earth beside the Earth, the Moon beside the Moon
    expect(physics.swayAt(to.toArray(), named('Mars'))).toBe(earth);
    expect(physics.swayAt(sun.pos.clone().add(earth.pos).multiplyScalar(0.5).toArray(), named('Mars'))).toBe(sun);
    expect(physics.swayAt(moon.pos.clone().addScalar(5e6).toArray(), named('Mars'))).toBe(moon);
    expect(physics.swayAt(moon.pos.clone().addScalar(5e6).toArray(), earth)).toBe(sun);
  });

  it('two moons that fall into their planet in the same moment are each absorbed once, and neither comes back', async () => {
    const { physics, named, run } = await setup();
    const jupiter = named('Jupiter'), gm = jupiter.gm;
    // twice the mass: the orbits of Metis and Adrastea, the innermost, now dip into Jupiter, an hour away
    physics.setMass(jupiter, 2 * gm, JD);
    physics.takeNews();
    run(JD + 0.2, 0.2);
    const hits = physics.takeNews().filter((n) => / hit Jupiter /.test(n));
    expect(hits.filter((n) => n.startsWith('Metis'))).toHaveLength(1);
    expect(hits.filter((n) => n.startsWith('Adrastea'))).toHaveLength(1);
    for (const name of ['Metis', 'Adrastea']) {
      expect(physics.simulated(named(name)), name).toBe(false);
      expect(named(name).valid, name).toBe(false);
    }
    // (a body the simulation had already absorbed was once taken for one riding along on Jupiter, put back, and absorbed again)
    run(JD + 1, 0.2);
    expect(physics.takeNews().filter((n) => /^(Metis|Adrastea) hit/.test(n))).toEqual([]);
    expect(physics.status()!.log.filter((e) => /^(Metis|Adrastea) hit/.test(e.text))).toHaveLength(2);
    // and each is told for the hour it happened, not for the end of the frame
    expect(physics.log.find((e) => e.text.startsWith('Metis'))!.jd - JD).toBeLessThan(0.07);
  });

  it('the clock follows the simulation, forwards and back, and no further than a frame\'s share of work allows', async () => {
    const { physics, clock, named } = await setup();
    physics.setMass(named('Venus'), 2 * named('Venus').gm, JD);
    const live = physics.live!;
    // a day a second, sixty frames a second
    for (let f = 0; f < 30; f++) {
      clock.jdTdb += 1 / 60;
      physics.follow(clock, 1 / 60);
      expect(clock.jdTdb).toBe(liveDate(live));
    }
    expect(live.sim.time / DAY).toBeCloseTo(0.5, 6);
    expect(physics.status()!.share).toBeGreaterThan(0.99);
    // back the way it came
    for (let f = 0; f < 30; f++) {
      clock.jdTdb -= 1 / 60;
      physics.follow(clock, 1 / 60);
    }
    expect(Math.abs(live.sim.time)).toBeLessThan(1e-3);
    // ten thousand years a second, with every step costing a millisecond: a frame of a sixtieth of a second gets
    // a quarter of itself and no more, the clock shows what was reached, and the share of what was asked for is told
    let ticks = 0;
    live.sim.now = () => ticks;
    const step = (live.sim as unknown as { step: (w: number) => void }).step.bind(live.sim);
    (live.sim as unknown as { step: (w: number) => void }).step = (w) => { ticks += 1; step(w); };
    for (let f = 0; f < 40; f++) {
      const asked = clock.jdTdb + (1e4 * 365.25) / 60;
      clock.jdTdb = asked;
      const from = ticks;
      physics.follow(clock, 1 / 60);
      expect(ticks - from).toBeLessThanOrEqual(5);
      expect(clock.jdTdb).toBe(liveDate(live));
      expect(clock.jdTdb).toBeLessThan(asked);
    }
    expect(physics.status()!.share).toBeLessThan(0.05);
  });

  it('says of each body whether it is simulated, what it goes round and on what orbit', async () => {
    const { physics, named } = await setup();
    physics.remove(named('Ceres'), JD);
    const rows = physics.rows(named('Moon'));
    expect(rows[0]).toEqual(['Live physics', 'simulated since 16 September 2026']);
    expect(rows[1]).toEqual(['Goes round', 'Earth']);
    expect(rows[2][1]).toMatch(/^a slightly stretched circle \(0\.0[3-7]\d?\)$/);
    expect(rows[3][1]).toMatch(/^3[56]\d,\d\d\d km to 4[01]\d,\d\d\d km · 2[6-8](\.\d+)? d$/);
    expect(physics.rows(named('Carme'))).toEqual([['Live physics', 'not simulated: it keeps its real path round Jupiter (its mass is not known)']]);
    expect(physics.rows(named('Phobos'))).toEqual([['Live physics', 'not simulated: it keeps its real path round Mars (it is too light to matter until it or Mars is changed)']]);
    const status = physics.status()!;
    expect(status.since).toBe('16 September 2026');
    expect(status.rails).toBe('');
    expect(status.leftOut.length).toBeGreaterThan(3);
    expect(status.log[0].text).toBe('Ceres is gone.');
  });
});

/** Everything a checkpoint must bring back, as plain values: every body (there or not, mass, size, place, motion, family), what the simulation's bodies stand for, what was made, the log. */
function everything(sys: SolarSystem, physics: LivePhysics) {
  return {
    bodies: sys.bodies.map((b) => [b.id, b.valid, sys.isGone(b), b.gm, b.systemGm, b.radius, ...b.radii, ...state(b), b.parent?.id ?? null, b.children.map((c) => c.id).join()]),
    carried: physics.live ? [...physics.live.carried].map(([id, family]) => [id, family.map((b) => b.id)]) : null,
    made: physics.made.map((b) => b.id),
    log: physics.log.map((e) => `${e.jd} ${e.text}`),
    on: physics.on,
  };
}

/**
 * The stepping is never told that its budget has run out: how a run is cut up into steps is then the
 * same every time, and so is what is carried on rails (live physics puts more on rails when a frame's
 * share of work is not enough, which on a loaded machine it sometimes is not). In the app the
 * budget is the frame's: a replay on a machine that is falling behind can differ from the first run
 * by what that changes (metres, in the run checked here).
 */
function steady(physics: LivePhysics): void {
  const follow = physics.follow.bind(physics);
  physics.follow = (clock, dt) => {
    if (physics.live) physics.live.sim.now = () => 0;
    follow(clock, dt);
  };
}

describe('undo and replay', () => {
  /** The system run on for `days`, then a checkpoint; `change` made and run on; the checkpoint restored: everything as it was, to the last bit, and it goes on from there as it did before. */
  async function undone(change: (s: Awaited<ReturnType<typeof setup>>) => void) {
    const s = await setup();
    const { sys, physics, clock, named, run } = s;
    steady(physics);
    // (live, and some days on, so that the moment kept is one of the simulation's own)
    physics.setMass(named('Jupiter'), 1.5 * named('Jupiter').gm, JD);
    run(JD + 3, 0.5);
    const cp = physics.checkpoint(clock.jdTdb);
    expect(cp.jd).toBe(clock.jdTdb);
    const then = everything(sys, physics);
    // and where it all is three days on, if nothing is done
    run(JD + 6, 0.5);
    const later = everything(sys, physics);
    physics.restore(cp);
    clock.jdTdb = cp.jd;
    expect(everything(sys, physics)).toEqual(then);
    change(s);
    run(JD + 8, 0.5);
    physics.restore(cp);
    clock.jdTdb = cp.jd;
    expect(everything(sys, physics)).toEqual(then);
    run(JD + 6, 0.5);
    expect(everything(sys, physics)).toEqual(later);
    return s;
  }

  it('a checkpoint restored after a mass changed is that moment to the last bit, and the run goes on from it as before', async () => {
    const { named, physics } = await undone(({ physics, named, clock }) => physics.setMass(named('Saturn'), 50 * named('Saturn').gm, clock.jdTdb));
    expect(named('Saturn').gm).toBe(physics.realGm(named('Saturn')));
  }, 60_000);

  it('...after a world moved, with what goes round it', async () => {
    await undone(({ physics, named, clock }) => {
      const earth = named('Earth');
      physics.move(earth, earth.pos.clone().multiplyScalar(1.5).toArray(), earth.vel.toArray(), clock.jdTdb);
    });
  }, 60_000);

  it('...after a moon was made: it leaves the system altogether, and the scene is told', async () => {
    const { sys, dropped, physics } = await undone(({ physics, named, clock }) => {
      const earth = named('Earth');
      const plan = newMoon(earth, [3e8, 0, 0], 1.0 * AU, 0, MADE_FIRST_ID);
      physics.make(plan.json, earth, plan.pos, plan.vel, clock.jdTdb, 'new');
    });
    expect(dropped).toEqual(["Earth's new moon"]);
    expect(sys.byId.has(MADE_FIRST_ID)).toBe(false);
    expect(physics.made).toEqual([]);
  }, 60_000);

  it('...after a world was taken away, the Sun among them', async () => {
    const { sys } = await undone(({ physics, sys, clock }) => physics.remove(sys.sun, clock.jdTdb));
    expect(sys.suns).toEqual([sys.sun]);
    expect(sys.sun.valid).toBe(true);
  }, 60_000);

  it('...after a collision: both come back, with the small moons that rode on the one absorbed', async () => {
    const { named, left } = await undone(({ physics, sys, named }) => {
      // Mars sent at the Sun from 0.02 AU at 200 km/s: Phobos and Deimos, which ride on it, go with it
      const mars = named('Mars'), sun = sys.sun, to = sun.pos.clone().sub(mars.pos).normalize();
      physics.live!.sim.setState(mars.id, sun.pos.clone().addScaledVector(to, -0.02 * AU).toArray(), sun.vel.clone().addScaledVector(to, 2e5).toArray());
    });
    // (they left the scene, the Sun having taken them in: and Jupiter, half as heavy again, two of its own small moons)
    const gone = left.map(([b]) => b);
    for (const name of ['Mars', 'Phobos', 'Deimos']) {
      expect(gone, name).toContain(name);
      expect(named(name).valid, name).toBe(true);
    }
  }, 60_000);

  it('two changes and two undos are a system never touched, the same as the return to reality', async () => {
    const { sys, physics, clock, named, run } = await setup();
    steady(physics);
    const real = physics.checkpoint(clock.jdTdb);
    expect(real.sim).toBeNull();
    physics.setMass(named('Jupiter'), 20 * named('Jupiter').gm, JD);
    run(JD + 2, 0.5);
    const first = physics.checkpoint(clock.jdTdb);
    const plan = newMoon(named('Mars'), [5e7, 0, 0], 1.5 * AU, 0, MADE_FIRST_ID);
    physics.make(plan.json, named('Mars'), plan.pos, plan.vel, clock.jdTdb, 'new');
    run(JD + 4, 0.5);
    physics.restore(first);
    clock.jdTdb = first.jd;
    physics.restore(real);
    clock.jdTdb = real.jd;
    expect(physics.on).toBe(false);
    const fresh = await SolarSystem.load('/data');
    await fresh.ephemeris.request(JD);
    fresh.update(JD);
    const untouched = (s: SolarSystem) => s.bodies.map((b) => [b.id, b.valid, b.gm, b.systemGm, b.radius, ...b.radii, ...state(b), b.parent?.id ?? null, b.children.map((c) => c.id).join(), ...b.orientation.elements]);
    expect(untouched(sys)).toEqual(untouched(fresh));
    // and the same by the return to reality, from the changed world
    physics.restore(first);
    clock.jdTdb = first.jd;
    run(JD + 3, 0.5);
    physics.backToReality(clock);
    sys.update(clock.jdTdb);
    expect(clock.jdTdb).toBe(JD);
    expect(untouched(sys)).toEqual(untouched(fresh));
  }, 60_000);

  it('the return to reality undone: what was made comes back, in its place among the bodies, and the changed world goes on', async () => {
    const { sys, physics, clock, named, run } = await setup();
    steady(physics);
    const earth = named('Earth'), plan = newMoon(earth, [3e8, 0, 0], AU, 0, MADE_FIRST_ID);
    const moon = physics.make(plan.json, earth, plan.pos, plan.vel, JD, 'new');
    run(JD + 2, 0.5);
    const cp = physics.checkpoint(clock.jdTdb);
    const then = everything(sys, physics);
    physics.backToReality(clock);
    expect(sys.bodies.includes(moon)).toBe(false);
    physics.restore(cp);
    clock.jdTdb = cp.jd;
    expect(sys.bodies[sys.bodies.length - 1]).toBe(moon);
    expect(moon.valid).toBe(true);
    expect(physics.made).toEqual([moon]);
    expect(everything(sys, physics)).toEqual(then);
    run(JD + 4, 0.5);
    expect(physics.orbit(moon)!.bound).toBe(true);
    expect(moon.parent).toBe(earth);
  }, 60_000);

  it('a replay from the moment just after a change goes the same way every time', async () => {
    const { sys, physics, clock, named, run } = await setup();
    steady(physics);
    physics.setMass(named('Jupiter'), 20 * named('Jupiter').gm, JD);
    const after = physics.checkpoint(clock.jdTdb);
    run(JD + 1.5, 0.05);
    const once = everything(sys, physics);
    // (the moons fell in: what happened is the same event the second time)
    expect(once.log.length).toBeGreaterThan(2);
    physics.restore(after);
    clock.jdTdb = after.jd;
    run(JD + 1.5, 0.05);
    expect(everything(sys, physics)).toEqual(once);
  }, 60_000);
});

describe('speed', () => {
  // (measured, not promised: a shared machine's numbers wander, and a phone is not this machine. What the app gives
  // the stepping: a quarter of a frame. The notes, docs/notes/gravity-engine.md, say what was measured here.)
  const RATES: [string, number][] = [['a day', DAY], ['a month', 30.4375 * DAY], ['a year', YEAR], ['100 years', 100 * YEAR], ['1,000 years', 1000 * YEAR]];

  /** three seconds of frames at sixty a second, at `rate`: the share of the time asked for that the last second managed */
  async function share(change: 'Ceres taken away' | 'the Sun taken away' | 'Jupiter twice as heavy', rate: number) {
    const { sys, physics, clock, named } = await setup();
    if (change === 'Jupiter twice as heavy') physics.setMass(named('Jupiter'), 2 * named('Jupiter').gm, JD);
    else physics.remove(change === 'the Sun taken away' ? sys.sun : named('Ceres'), JD);
    clock.rate = rate;
    let from = 0, work = 0;
    for (let f = 0; f < 180; f++) {
      if (f === 120) { from = clock.jdTdb; work = 0; }
      clock.advance(1 / 60);
      const t = performance.now();
      physics.follow(clock, 1 / 60);
      work += performance.now() - t;
      sys.update(clock.jdTdb);
      physics.place(clock.jdTdb);
    }
    return { got: ((clock.jdTdb - from) * DAY) / rate, ms: work / 60, rails: physics.status()!.rails };
  }

  for (const change of ['Ceres taken away', 'Jupiter twice as heavy', 'the Sun taken away'] as const) {
    it(`${change}: time runs as fast as asked up to years a second, and as fast as it can beyond`, async () => {
      const lines: string[] = [];
      for (const [name, rate] of RATES) {
        const r = await share(change, rate);
        lines.push(`${name} a second: ${Math.round(100 * r.got)} % of it, ${r.ms.toFixed(1)} ms of stepping a frame`);
        // (a year a second is managed with room to spare here: half of it would be a slowing worth knowing of)
        if (rate <= YEAR) expect(r.got, `${change}, ${name} a second`).toBeGreaterThan(0.5);
        // (and a frame's stepping never much more than its share: 4.2 ms of the 16.7, and what the step under way takes)
        expect(r.ms, `${change}, ${name} a second`).toBeLessThan(12);
      }
      console.log(`${change}, in frames of a sixtieth of a second: ${lines.join('; ')}`);
    }, 120_000);
  }
});

