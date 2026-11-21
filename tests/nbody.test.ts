import { describe, expect, it } from 'vitest';
import { keplerDrift } from '../src/sim/KeplerDrift';
import { NBody, type SimEvent } from '../src/sim/NBody';

// (round figures for made-up systems: the tests that use the real bodies read the catalogue, tests/systemsim.test.ts)
const GM_SUN = 1.32712440018e20;
const GM_JUPITER = GM_SUN / 1047.35;
const GM_EARTH = 3.986004418e14;
const AU = 149_597_870_700;
const DAY = 86_400, YEAR = 365.25 * DAY;
const C = 299_792_458;

/** A star with two planets, the inner one with a moon: a quiet system whose hierarchy and step never change. */
function quiet(): NBody {
  const sim = new NBody();
  sim.add({ id: 1, gm: GM_SUN, radius: 6.96e8, pos: [0, 0, 0], vel: [0, 0, 0] });
  const e = orbit(AU, 0.05, GM_SUN + GM_EARTH, 0.02), j = orbit(5.2 * AU, 0.05, GM_SUN + GM_JUPITER, 0.03);
  const m = orbit(3.84e8, 0.05, GM_EARTH, 0.1);
  sim.add({ id: 2, gm: GM_EARTH, radius: 6.37e6, pos: e.pos, vel: e.vel });
  sim.add({ id: 3, gm: GM_EARTH / 81.3, radius: 1.737e6, pos: [e.pos[0] + m.pos[0], m.pos[1], m.pos[2]], vel: [e.vel[0] + m.vel[0], e.vel[1] + m.vel[1], e.vel[2] + m.vel[2]] });
  sim.add({ id: 4, gm: GM_JUPITER, radius: 7e7, pos: [-j.pos[0], -j.pos[1], j.pos[2]], vel: [-j.vel[0], -j.vel[1], j.vel[2]] });
  return sim;
}

const dist = (a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number) => Math.hypot(a[3 * i] - b[3 * j], a[3 * i + 1] - b[3 * j + 1], a[3 * i + 2] - b[3 * j + 2]);
const rel = (x: ArrayLike<number>, i: number, j: number) => [x[3 * j] - x[3 * i], x[3 * j + 1] - x[3 * i + 1], x[3 * j + 2] - x[3 * i + 2]];

/** Eccentricity and semi-major axis of the orbit of body j about body i. */
function elements(sim: NBody, i: number, j: number): { e: number; a: number } {
  sim.read();
  const mu = sim.gm[i] + sim.gm[j];
  const [x, y, z] = rel(sim.pos, i, j), [u, v, w] = rel(sim.vel, i, j);
  const r = Math.hypot(x, y, z), v2 = u * u + v * v + w * w;
  const hx = y * w - z * v, hy = z * u - x * w, hz = x * v - y * u;
  const en = v2 / 2 - mu / r;
  return { e: Math.sqrt(Math.max(0, 1 + (2 * en * (hx * hx + hy * hy + hz * hz)) / (mu * mu))), a: -mu / (2 * en) };
}

/** A state at periapsis distance q and eccentricity e about mu, in a tilted plane. */
function orbit(q: number, e: number, mu: number, tilt = 0.3): { pos: number[]; vel: number[] } {
  const v = Math.sqrt((mu * (1 + e)) / q);
  return { pos: [q, 0, 0], vel: [0, v * Math.cos(tilt), v * Math.sin(tilt)] };
}

/** The Sun and a Jupiter, and a small body coming past the Jupiter at 3 km/s. */
function flyby(): NBody {
  const sim = new NBody();
  sim.add({ id: 1, gm: GM_SUN, radius: 6.96e8, pos: [0, 0, 0], vel: [0, 0, 0] });
  const vj = Math.sqrt(GM_SUN / (5 * AU));
  sim.add({ id: 2, gm: GM_JUPITER, radius: 7e7, pos: [5 * AU, 0, 0], vel: [0, vj, 0] });
  sim.add({ id: 3, gm: GM_EARTH, radius: 6.4e6, pos: [5.05 * AU, -2 * AU, 0], vel: [0, vj + 3000, 0] });
  return sim;
}

describe('two bodies', () => {
  it('go round each other as Kepler says, exactly: the period and the shape hold over a thousand turns', () => {
    // a star and a companion of half its mass, on a near-circular orbit and on an eccentric one (where the step
    // follows the body in and out: the step is chosen again three times a turn, and each change rounds once)
    for (const [e, bound] of [[0.0167, 1e-9], [0.6, 5e-8]]) {
      const sim = new NBody();
      const mu = 1.5 * GM_SUN, q = AU * (1 - e);
      const o = orbit(q, e, mu);
      sim.add({ id: 1, gm: GM_SUN, radius: 0, pos: [0, 0, 0], vel: [0, 0, 0] });
      sim.add({ id: 2, gm: 0.5 * GM_SUN, radius: 0, pos: o.pos, vel: o.vel });
      sim.read();
      const start = rel(sim.pos, 0, 1);
      const period = 2 * Math.PI * Math.sqrt(AU ** 3 / mu);
      sim.advance(1000 * period);
      sim.read();
      const end = rel(sim.pos, 0, 1);
      expect(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) / AU, `e ${e}`).toBeLessThan(bound);
      const el = elements(sim, 0, 1);
      expect(Math.abs(el.e - e), `e ${e}`).toBeLessThan(1e-10);
      expect(Math.abs(el.a / AU - 1), `e ${e}`).toBeLessThan(1e-10);
      // and in between, where the two-body solution has them
      const r = new Float64Array(o.pos), v = new Float64Array(o.vel);
      keplerDrift(r, v, 0, mu, 1000.37 * period);
      sim.advance(0.37 * period);
      sim.read();
      const now = rel(sim.pos, 0, 1);
      expect(Math.hypot(now[0] - r[0], now[1] - r[1], now[2] - r[2]) / AU, `e ${e}`).toBeLessThan(bound);
    }
  });

  it('pass each other on the hyperbola that turns them by the angle the textbook gives', () => {
    // a star past the Sun at 30 km/s, from a million AU off and aimed 2 AU to one side (from there the
    // path is straight to two parts in a million, as the textbook's angle takes it to be)
    const sim = new NBody();
    const v0 = 30e3, b = 2 * AU, mu = 2 * GM_SUN, far = 1e6 * AU;
    sim.add({ id: 1, gm: GM_SUN, radius: 7e8, pos: [0, 0, 0], vel: [0, 0, 0] });
    sim.add({ id: 2, gm: GM_SUN, radius: 7e8, pos: [-far, b, 0], vel: [v0, 0, 0] });
    sim.advance((2 * far) / v0);
    sim.read();
    const [u, v] = rel(sim.vel, 0, 1);
    // tan(θ/2) = μ / (b v∞²)
    expect(Math.atan2(v, u)).toBeCloseTo(-2 * Math.atan(mu / (b * v0 * v0)), 4);
    const ev = sim.takeEvents().filter((x) => x.kind === 'encounter');
    expect(ev).toHaveLength(1);
    // closest approach: q = a(e − 1), a = μ / v∞², e = √(1 + (b v∞² / μ)²)
    const a = mu / (v0 * v0), q = a * (Math.sqrt(1 + (b / a) ** 2) - 1);
    if (ev[0].kind === 'encounter') expect(ev[0].distance / q).toBeCloseTo(1, 4);
  });
});

describe('time', () => {
  it('keeps energy and angular momentum where nothing is flattened, for thousands of years', () => {
    const sim = quiet();
    const E0 = sim.energy(), L0 = sim.angularMomentum();
    let dE = 0, dL = 0;
    for (let k = 0; k < 30; k++) {
      sim.advance(100 * YEAR);
      dE = Math.max(dE, Math.abs(sim.energy() / E0 - 1));
      const L = sim.angularMomentum();
      dL = Math.max(dL, Math.hypot(L[0] - L0[0], L[1] - L0[1], L[2] - L0[2]) / Math.hypot(L0[0], L0[1], L0[2]));
    }
    expect(dE).toBeLessThan(1e-10);
    expect(dL).toBeLessThan(1e-12);
  });

  it('runs backwards to where it started', () => {
    // (where the step is kept, the mapping is its own inverse: the way back retraces the way there. Through an
    // encounter the step changes at other moments going back, and the run comes back to within its own error)
    const sim = quiet();
    sim.read();
    const start = Float64Array.from(sim.pos);
    sim.advance(1000 * YEAR);
    sim.advance(-1000 * YEAR);
    sim.read();
    // (half a million steps of 1.45 days there and back, each two-body solution reversible to a part in 10¹⁵)
    for (let i = 0; i < 4; i++) expect(dist(sim.pos, i, start, i), `body ${i}`).toBeLessThan(500);
  });

  it('comes out the same however the way there is cut up', () => {
    const a = flyby(), b = flyby();
    a.advance(30 * YEAR);
    for (let t = 0; t < 30 * YEAR;) t += b.advance(Math.min(30 * YEAR - t, 0.37 * DAY + (t % 41) * 1e-3));
    a.read(); b.read();
    expect(Array.from(b.pos)).toEqual(Array.from(a.pos));
    expect(Array.from(b.vel)).toEqual(Array.from(a.vel));
  });

  it('is read out smoothly between steps, kicks included', () => {
    const sim = flyby();
    sim.advance(1 * YEAR);
    // (a 197-day step at first: sampled every day, the path's second difference stays at what the orbits' own curving gives)
    const xs: number[][] = [];
    for (let k = 0; k < 400; k++) { sim.advance(DAY); sim.read(); xs.push(Array.from(sim.pos)); }
    for (let k = 1; k < xs.length - 1; k++) {
      for (let i = 0; i < 3; i++) {
        const d2 = Math.hypot(...[0, 1, 2].map((c) => xs[k + 1][3 * i + c] - 2 * xs[k][3 * i + c] + xs[k - 1][3 * i + c]));
        const r = Math.hypot(xs[k][3 * i] - xs[k][0], xs[k][3 * i + 1] - xs[k][1], xs[k][3 * i + 2] - xs[k][2]);
        // GM/r² over a day squared, with room for the Jupiter's pull on the small body
        expect(d2, `day ${k}, body ${i}`).toBeLessThan(3 * (GM_SUN / (r * r)) * DAY * DAY + 1e3);
      }
    }
  });

  it('moves on by as much as fits in the time it is given, never losing or repeating any', () => {
    const sim = flyby();
    let clock = 0;
    sim.now = () => clock;
    // every step "costs" a millisecond on this clock
    const step = (sim as unknown as { step: (w: number) => void }).step.bind(sim);
    (sim as unknown as { step: (w: number) => void }).step = (w) => { clock += 1; step(w); };
    let total = 0;
    for (let k = 0; k < 50; k++) {
      const moved = sim.advance(100 * YEAR, 5);
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThan(100 * YEAR);
      total += moved;
      expect(sim.time).toBe(total);
    }
    // and a run that went the long way round is where a run straight there is
    const ref = flyby();
    ref.advance(total);
    sim.read(); ref.read();
    expect(Array.from(sim.pos)).toEqual(Array.from(ref.pos));
  });

  it('saves and carries on from a snapshot exactly', () => {
    const sim = flyby();
    sim.advance(7.3 * YEAR);
    const copy = NBody.restore(JSON.parse(JSON.stringify(sim.snapshot(), (_, v) => (ArrayBuffer.isView(v) ? { $: v.constructor.name, d: Array.from(v as Float64Array) } : v)), (_, v) => (v && v.$ ? new (globalThis as unknown as Record<string, new (d: number[]) => unknown>)[v.$](v.d) : v)));
    sim.advance(20 * YEAR); copy.advance(20 * YEAR);
    sim.read(); copy.read();
    expect(Array.from(copy.pos)).toEqual(Array.from(sim.pos));
  });
});

describe('an encounter and a capture', () => {
  it('cross changes of hierarchy without a jump in energy', () => {
    const sim = flyby();
    const E0 = sim.energy();
    const events: SimEvent[] = [];
    let worst = 0;
    for (let k = 0; k < 2000; k++) {
      sim.advance(5 * DAY);
      worst = Math.max(worst, Math.abs(sim.energy() / E0 - 1));
      events.push(...sim.takeEvents());
    }
    // (the small body's own orbital energy is 0.3 % of the whole: this is 5 parts in 10⁵ of it)
    expect(worst).toBeLessThan(1.5e-7);
    expect(events.filter((e) => e.kind === 'encounter')).toHaveLength(1);
  });
});

describe('changes at any moment', () => {
  it('a head-on collision makes one body of the two, with their mass, momentum and volume', () => {
    const sim = new NBody();
    const R = 6.371e6;
    sim.add({ id: 1, gm: GM_EARTH, radius: R, pos: [-1e8, 0, 0], vel: [1000, 0, 0] });
    sim.add({ id: 2, gm: GM_EARTH / 10, radius: R / 2, pos: [1e8, 0, 0], vel: [-3000, 0, 0] });
    const p0 = sim.momentum(), E0 = sim.energy();
    sim.advance(3 * DAY);
    const ev = sim.takeEvents();
    expect(ev).toHaveLength(1);
    const hit = ev[0];
    if (hit.kind !== 'collision') throw new Error(hit.kind);
    expect([hit.survivor, hit.absorbed]).toEqual([1, 2]);
    expect(sim.count).toBe(1);
    expect(sim.gm[0]).toBeCloseTo(1.1 * GM_EARTH, -3);
    expect(sim.radius[0]).toBeCloseTo(R * Math.cbrt(1.125), 0);
    const p = sim.momentum();
    expect(Math.abs(p[0] / p0[0] - 1)).toBeLessThan(1e-14);
    expect(Math.hypot(p[1], p[2])).toBe(0);
    // told as the two touched, wherever in its step the simulation made them one: at the speed their fall gives
    // there, v² = v₀² + 2G(m₁ + m₂)(1/r − 1/r₀)
    expect(hit.distance / (1.5 * R)).toBeCloseTo(1, 12);
    const w = Math.sqrt(4000 ** 2 + 2 * 1.1 * GM_EARTH * (1 / (1.5 * R) - 1 / 2e8));
    expect(hit.speed / w).toBeCloseTo(1, 6);
    // and the energy is all accounted for: the impact's heat, and their pull on each other, now the merged body's own
    const mu = (GM_EARTH * GM_EARTH) / 10 / 1.1 / GM_EARTH;
    expect(hit.heat).toBeCloseTo((0.5 * mu * hit.speed ** 2) / 6.6743e-11, -25);
    const lost = hit.heat - (GM_EARTH * GM_EARTH) / 10 / hit.distance / 6.6743e-11;
    expect(Math.abs((sim.energy() - (E0 - lost)) / E0)).toBeLessThan(1e-9);
  });

  it('a moon that falls into its planet is told at the speed it had as the two touched, not where a step happened to end', () => {
    // a planet of twenty Jupiters with Jupiter's size, and a Ganymede going round it at the speed that kept it on a
    // circle round one Jupiter: far too slow now, its new orbit dips deep into the planet. From several starts on
    // that orbit, so that the steps end in different places on the way in.
    const gm = 20 * 1.26687e17, R = 6.9911e7, moon = { gm: 9.8878e12, radius: 2.6341e6 }, r0 = 1.0704e9, v0 = 10_880;
    const contact = Math.sqrt(v0 ** 2 + 2 * (gm + moon.gm) * (1 / (R + moon.radius) - 1 / r0));
    expect(contact / 1000).toBeCloseTo(255.4, 1);
    for (const lead of [0, 1700, 3300, 5100]) {
      const sim = new NBody();
      sim.add({ id: 1, gm, radius: R, pos: [0, 0, 0], vel: [0, 0, 0] });
      sim.add({ id: 2, ...moon, pos: [r0, 0, 0], vel: [0, v0, 0] });
      sim.advance(lead);
      sim.advance(2 * DAY);
      const hit = sim.takeEvents().find((e) => e.kind === 'collision');
      if (hit?.kind !== 'collision') throw new Error('no collision');
      expect([hit.survivor, hit.absorbed]).toEqual([1, 2]);
      expect(hit.distance).toBe(R + moon.radius);
      expect(Math.abs(hit.speed / contact - 1)).toBeLessThan(0.01);
    }
  });

  it('a change of mass changes the periods as Kepler says', () => {
    const sim = new NBody();
    sim.add({ id: 1, gm: GM_SUN, radius: 6.96e8, pos: [0, 0, 0], vel: [0, 0, 0] });
    const o = orbit(AU, 0.1, GM_SUN + GM_EARTH);
    sim.add({ id: 2, gm: GM_EARTH, radius: 6.37e6, pos: o.pos, vel: o.vel });
    sim.advance(3.3 * YEAR);
    // the Sun loses a fifth of its mass: from here the Earth's orbit is the one its place and speed give about the rest
    sim.setMass(1, 0.8 * GM_SUN);
    sim.read();
    const [x, y, z] = rel(sim.pos, 0, 1), [u, v, w] = rel(sim.vel, 0, 1);
    const mu = 0.8 * GM_SUN + GM_EARTH;
    const a = 1 / (2 / Math.hypot(x, y, z) - (u * u + v * v + w * w) / mu);
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
    // timed by the simulation: where it is one period on, and half a period on (not there)
    const there = [x, y, z];
    sim.advance(period / 2);
    sim.read();
    expect(Math.hypot(...rel(sim.pos, 0, 1).map((c, k) => c - there[k])) / AU).toBeGreaterThan(0.5);
    sim.advance(period / 2);
    sim.read();
    expect(Math.hypot(...rel(sim.pos, 0, 1).map((c, k) => c - there[k])) / AU).toBeLessThan(1e-9);
    expect(elements(sim, 0, 1).a / a).toBeCloseTo(1, 10);
  });

  it('takes bodies away and adds them, and puts them anywhere: what is left goes on as it should', () => {
    // massless worlds round a star: with the star gone each goes straight on at the speed it had
    const sim = new NBody();
    sim.add({ id: 1, gm: GM_SUN, radius: 6.96e8, pos: [0, 0, 0], vel: [0, 0, 0] });
    for (let k = 0; k < 5; k++) {
      const o = orbit((0.4 + k) * AU, 0.05 * k, GM_SUN, 0.1 * k);
      sim.add({ id: 10 + k, gm: 0, radius: 1e6, pos: o.pos, vel: o.vel });
    }
    sim.advance(1.7 * YEAR);
    sim.read();
    const x0 = Float64Array.from(sim.pos), v0 = Float64Array.from(sim.vel);
    sim.remove(1);
    expect(sim.count).toBe(5);
    sim.advance(50 * YEAR);
    sim.read();
    for (let k = 0; k < 5; k++) {
      for (let c = 0; c < 3; c++) expect(sim.vel[3 * k + c]).toBe(v0[3 * k + 3 + c]);
      expect(Math.hypot(...[0, 1, 2].map((c) => sim.pos[3 * k + c] - x0[3 * k + 3 + c] - v0[3 * k + 3 + c] * 50 * YEAR))).toBeLessThan(0.1);
    }
    // a star put back in the middle, and one world moved onto a circular orbit about it
    sim.add({ id: 1, gm: GM_SUN, radius: 6.96e8, pos: [0, 0, 0], vel: [0, 0, 0] });
    const o = orbit(AU, 0, GM_SUN);
    sim.setState(12, o.pos, o.vel);
    sim.advance(YEAR * 2 * Math.PI * Math.sqrt(AU ** 3 / GM_SUN) / YEAR);
    sim.read();
    const i = sim.indexOf(12), s = sim.indexOf(1);
    expect(Math.hypot(...rel(sim.pos, s, i).map((c, k) => c - o.pos[k])) / AU).toBeLessThan(1e-9);
    // (the others fly on, unbound: each told once)
    const gone = sim.takeEvents().filter((e) => e.kind === 'unbound').flatMap((e) => (e.kind === 'unbound' ? e.ids : []));
    expect(new Set(gone).size).toBe(gone.length);
  });

  it('tells who has been captured by whom, and who has left for good', () => {
    // a Jupiter, and a body moved to where it is bound to it rather than to the Sun
    const sim = flyby();
    sim.edge = 100 * AU;
    sim.advance(10 * DAY);
    expect(sim.takeEvents().filter((e) => e.kind === 'orbit')).toHaveLength(0);
    sim.read();
    const j = sim.indexOf(2), o = orbit(0.05 * AU, 0, GM_JUPITER);
    sim.setState(3, [sim.pos[3 * j] + o.pos[0], sim.pos[3 * j + 1], sim.pos[3 * j + 2]], [sim.vel[3 * j], sim.vel[3 * j + 1] + o.vel[1], sim.vel[3 * j + 2] + o.vel[2]]);
    sim.advance(10 * DAY);
    expect(sim.takeEvents()).toContainEqual(expect.objectContaining({ kind: 'orbit', id: 3, around: 2, was: 1 }));
    // the Jupiter sent off at twice the speed of escape, its moon with it: unbound at once, gone past the edge later
    sim.read();
    const k = sim.indexOf(3);
    const out = [0, 1, 2].map((c) => sim.pos[3 * j + c] / Math.hypot(sim.pos[3 * j], sim.pos[3 * j + 1], sim.pos[3 * j + 2]));
    const kick = 2 * Math.sqrt((2 * GM_SUN) / (5 * AU));
    sim.setState(2, [sim.pos[3 * j], sim.pos[3 * j + 1], sim.pos[3 * j + 2]], out.map((c, n) => sim.vel[3 * j + n] + kick * c));
    sim.setState(3, [sim.pos[3 * k], sim.pos[3 * k + 1], sim.pos[3 * k + 2]], out.map((c, n) => sim.vel[3 * k + n] + kick * c));
    sim.advance(DAY);
    expect(sim.takeEvents()).toContainEqual(expect.objectContaining({ kind: 'unbound', primary: 2, ids: [2, 3] }));
    sim.advance(20 * YEAR);
    expect(sim.takeEvents()).toContainEqual(expect.objectContaining({ kind: 'escape', primary: 2, ids: [2, 3] }));
  });

  it('a body without mass goes where one of almost none would', () => {
    // an asteroid at 2.8 AU, disturbed by a Jupiter: a light body takes plain steps of its own, without the
    // corrector, and wobbles about the true path by the disturbance times (2π / steps)²: a thousandth of it here
    const make = (gm: number) => {
      const sim = flyby();
      sim.remove(3);
      const o = orbit(2.8 * AU, 0.1, GM_SUN, 0.1);
      sim.add({ id: 3, gm, radius: 4e5, pos: [-o.pos[0], o.pos[1], o.pos[2]], vel: [0, -o.vel[1], -o.vel[2]] });
      return sim;
    };
    const light = make(0), tiny = make(1);
    let worst = 0;
    for (let k = 0; k < 100; k++) {
      light.advance(YEAR); tiny.advance(YEAR);
      light.read(); tiny.read();
      worst = Math.max(worst, dist(light.pos, 2, tiny.pos, 2) / AU);
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('does not care where the bodies are listed, or how fast the whole system drifts', () => {
    const base = flyby();
    base.advance(10 * YEAR);
    base.read();
    // the same bodies the other way round, all moving at 100 km/s more
    const sim = new NBody();
    const src = flyby();
    src.read();
    for (const i of [2, 0, 1]) sim.add({ id: src.ids[i], gm: src.gm[i], radius: src.radius[i], pos: src.pos.subarray(3 * i, 3 * i + 3), vel: [src.vel[3 * i] + 1e5, src.vel[3 * i + 1], src.vel[3 * i + 2]] });
    sim.advance(10 * YEAR);
    sim.read();
    for (let k = 0; k < 3; k++) {
      const i = sim.indexOf(base.ids[k]);
      const moved = [base.pos[3 * k] + 1e5 * 10 * YEAR, base.pos[3 * k + 1], base.pos[3 * k + 2]];
      expect(Math.hypot(...[0, 1, 2].map((c) => sim.pos[3 * i + c] - moved[c])), `body ${k}`).toBeLessThan(1e3);
    }
  });
});

describe('black holes', () => {
  // a hole of ten Suns, its pull Paczyński and Wiita's
  const GM = 10 * GM_SUN, RS = (2 * GM) / (C * C);
  const hole = () => {
    const sim = new NBody();
    sim.add({ id: 1, gm: GM, radius: RS, rs: RS, pos: [0, 0, 0], vel: [0, 0, 0] });
    return sim;
  };

  it('keep a circular orbit at its own speed, √(GM r) / (r − rs), faster than Newton\'s', () => {
    for (const r of [6 * RS, 20 * RS]) {
      const sim = hole();
      const v = Math.sqrt(GM * r) / (r - RS);
      sim.add({ id: 2, gm: 0, radius: 1e3, pos: [r, 0, 0], vel: [0, v, 0] });
      const period = (2 * Math.PI * r) / v;
      sim.advance(100.25 * period);
      sim.read();
      // a hundred turns and a quarter: on the circle, a quarter of the way round (by Newton's pull it would be
      // a fifth of a turn off at 6 rs; here the turning is right to 3 parts in 10⁵)
      expect(Math.hypot(sim.pos[3], sim.pos[4]) / r, `r ${r / RS} rs`).toBeCloseTo(1, 4);
      expect(Math.abs(Math.atan2(sim.pos[4], sim.pos[3]) - Math.PI / 2), `r ${r / RS} rs`).toBeLessThan(0.02);
    }
  });

  it('swallow what falls in, and grow by its mass', () => {
    // (a star that close would be torn apart first: tides are not in the simulation yet)
    const sim = hole();
    sim.add({ id: 2, gm: GM_SUN, radius: 7e8, pos: [3e10, 0, 0], vel: [-1e6, 1e4, 0] });
    sim.advance(DAY);
    const ev = sim.takeEvents().find((e) => e.kind === 'collision');
    expect(ev).toMatchObject({ survivor: 1, absorbed: 2 });
    expect(sim.rs[0] / RS).toBeCloseTo(1.1, 12);
    expect(sim.gm[0] / GM).toBeCloseTo(1.1, 12);
  });
});

describe('fidelity', () => {
  it('carries a tight family on rails when asked, says so, and takes it off again without a jump', () => {
    const full = quiet(), rails = quiet();
    rails.railsBelow = 60 * DAY;
    expect(rails.report().rails).toEqual([{ primary: 2, members: [2, 3] }]);
    full.advance(100 * YEAR); rails.advance(100 * YEAR);
    full.read(); rails.read();
    // the Earth and Moon's centre goes round the Sun as before, but for the pull of the Sun on the pair's spread
    // (its quadrupole): 9,000 km in a century. Within the family the Moon keeps its own orbit.
    const cm = (x: Float64Array) => [0, 1, 2].map((c) => (x[3 + c] * GM_EARTH + (x[6 + c] * GM_EARTH) / 81.3) / (GM_EARTH * (1 + 1 / 81.3)));
    expect(Math.hypot(...cm(full.pos).map((c, k) => c - cm(rails.pos)[k])) / AU).toBeLessThan(1e-4);
    rails.read();
    const before = Float64Array.from(rails.pos);
    rails.railsBelow = 0;
    rails.read();
    expect(Array.from(rails.pos)).toEqual(Array.from(before));
    expect(rails.report().rails).toEqual([]);
  });

  it('always steps what goes round a body that asks for it, and carries the bodies without a mass by a limit of their own', () => {
    // the star's planets are to be stepped whatever the limit: only the Earth's moon may ride
    const sim = new NBody();
    const e = orbit(AU, 0.05, GM_SUN + GM_EARTH, 0.02), j = orbit(5.2 * AU, 0.05, GM_SUN + GM_JUPITER, 0.03), m = orbit(3.84e8, 0.05, GM_EARTH, 0.1);
    sim.add({ id: 1, gm: GM_SUN, radius: 6.96e8, pos: [0, 0, 0], vel: [0, 0, 0], stepped: true });
    sim.add({ id: 2, gm: GM_EARTH, radius: 6.37e6, pos: e.pos, vel: e.vel });
    sim.add({ id: 3, gm: GM_EARTH / 81.3, radius: 1.737e6, pos: [e.pos[0] + m.pos[0], m.pos[1], m.pos[2]], vel: [e.vel[0] + m.vel[0], e.vel[1] + m.vel[1], e.vel[2] + m.vel[2]] });
    sim.add({ id: 4, gm: GM_JUPITER, radius: 7e7, pos: [-j.pos[0], -j.pos[1], j.pos[2]], vel: [-j.vel[0], -j.vel[1], j.vel[2]] });
    // an asteroid without a mass, on a circle at 2.8 AU
    const a = orbit(2.8 * AU, 0, GM_SUN, 0.1);
    sim.add({ id: 5, gm: 0, radius: 4e5, pos: [0, a.pos[0], 0], vel: [-a.vel[1], 0, a.vel[2]] });
    sim.railsBelow = 1000 * YEAR;
    expect(sim.report().rails).toEqual([{ primary: 2, members: [2, 3] }, { primary: 5, members: [5] }]);
    // (without the asking, the whole system is one family on rails: the test after this one)
    sim.railsBelow = 0;
    expect(sim.report().rails).toEqual([]);
    sim.lightRailsBelow = 10 * YEAR;
    expect(sim.report().rails).toEqual([{ primary: 5, members: [5] }]);
    // and it survives a snapshot
    expect(NBody.restore(sim.snapshot()).report().rails).toEqual([{ primary: 5, members: [5] }]);
  });

  it('chooses what goes on rails for a rate of time from what a step costs', () => {
    const sim = quiet();
    let clock = 0;
    sim.now = () => clock;
    const step = (sim as unknown as { step: (w: number) => void }).step.bind(sim);
    (sim as unknown as { step: (w: number) => void }).step = (w) => { clock += 0.01; step(w); };
    sim.advance(YEAR, 1e9);
    // ten years a second with 8 ms of stepping to spend, at 10 µs a step: 800 steps of 4.6 days, not enough for
    // the Moon's month in 16 (on rails), enough for the Earth's year
    const limit = sim.fit(10 * YEAR, 8);
    expect(limit / DAY).toBeCloseTo(84, 0);
    expect(sim.report().rails.map((r) => r.primary)).toEqual([2]);
    // a thousand years a second: Jupiter's twelve years too, and with it the whole system
    sim.fit(1000 * YEAR, 8);
    expect(sim.report().rails).toEqual([{ primary: 1, members: [1, 2, 3, 4] }]);
    // a day a second: everything stepped
    expect(sim.fit(DAY, 8)).toBeLessThan(DAY);
    expect(sim.report().rails).toEqual([]);
  });
});
