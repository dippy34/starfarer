import type { Body } from '../universe/Body';
import type { SolarSystem } from '../universe/SolarSystem';
import { NBody } from './NBody';

/**
 * Between the app's bodies and the simulation (NBody.ts): starting it from where the bodies are
 * and how they move, and putting them where it has taken them.
 *
 * Where the velocities come from: the rate at which the app moves each body (`motions`).
 * `SolarSystem.update` gives velocities of its own, and for the Sun, the planets and the Moon they
 * are that (the ephemeris's own derivatives). But a moon's on mean elements is that of the Kepler
 * orbit of its catalogued period, while its place moves with the mean longitude fitted to JPL's
 * ephemeris: Io's velocity is 0.36 % faster than Io moves, and as a start it would put Io on an
 * orbit 1 % too slow; its planet's velocity, taken from its family's, carries a share of that.
 *
 * Not every body need be simulated. A body left out rides on the nearest simulated body it goes
 * round in the catalogue (a small moon on its planet, an asteroid on the Sun): it keeps its own
 * motion about it, from the ephemeris, and moves as that body has moved in the simulation. A
 * planet whose moons are left out stands for its family: its mass is theirs together, its place
 * and motion the family's centre of mass. (Taken alone, a planet carries its moons' pull in its
 * motion: Jupiter goes round the centre of its family at 2 m/s, which would take it 60,000 km a
 * year off its path.) Only moons make a family: the Sun's minor bodies ride along on their own
 * orbits. "Goes round in the catalogue" is `SolarSystem.homeOf`: what a simulated body goes round
 * now is the simulation's to say (`NBody.primaries`), and the app's `Body.parent` follows that.
 */

/**
 * The planets' equatorial bulges: J₂ (unnormalised) and the reference radius it is given at (km),
 * from the gravity fields fitted to the spacecraft that orbited or passed them. Without them a
 * giant planet's inner moons, whose catalogued speeds include the bulge's pull, would go round on
 * orbits 1 % too large and 0.1 % too slow (Io a quarter of a turn behind in a year).
 *   Earth: EGM2008 (Pavlis et al. 2012); Mars: MRO120D (Konopliv et al. 2016); Jupiter: Juno
 *   (Iess et al. 2018); Saturn: Cassini's Grand Finale (Iess et al. 2019); Uranus: Jacobson
 *   (2014); Neptune: Jacobson (2009).
 */
const BULGES: Record<number, [number, number]> = {
  399: [1.0826359e-3, 6378.1363],
  499: [1.95661e-3, 3396],
  599: [14696.5063e-6, 71492],
  699: [16290.573e-6, 60330],
  799: [3510.68e-6, 25559],
  899: [3408.428e-6, 25225],
};

export interface Live {
  readonly sim: NBody;
  /** the TDB Julian date of the simulation's time 0 */
  readonly jd0: number;
  /** for each simulated body, the moons it stands for besides itself (left out, with a mass) */
  readonly carried: Map<number, Body[]>;
  /** working room of `apply`: each simulated body's place in the simulation's arrays, as of `layout`, and how far each has been moved */
  readonly index: Map<Body, number>;
  layout: number;
  shift: Float64Array;
}

/** The date (TDB Julian) the simulation has reached. */
export function liveDate(live: Live): number {
  return live.jd0 + live.sim.time / 86_400;
}

/**
 * A simulation of the system at `jd` (every body brought to that date first), whose time 0 is
 * that date: of the bodies `include` passes, by default all that have a mass. A body without a
 * known mass is pulled and does not pull. The body's `id` is its number in the simulation.
 */
export function capture(system: SolarSystem, jd: number, include: (b: Body) => boolean = (b) => b.gm > 0): Live {
  const motion = motions(system, jd);
  const velOf = new Map(system.bodies.map((b, k) => [b, motion.subarray(3 * k, 3 * k + 3)]));
  const sim = new NBody();
  const carried = new Map<number, Body[]>();
  const pos = [0, 0, 0], vel = [0, 0, 0];
  const moon = (m: Body) => m.kind === 'moon' && m.valid && m.gm > 0;
  for (const b of system.bodies) {
    if (!b.valid || !include(b)) continue;
    const family = b.children.filter((m) => moon(m) && !include(m));
    if (family.some((m) => system.homeOf(m) !== b)) throw new Error('a simulation starts from the catalogue: bodies going round what they do there');
    let gm = b.gm;
    const bv = velOf.get(b)!;
    pos[0] = b.pos.x; pos[1] = b.pos.y; pos[2] = b.pos.z;
    vel[0] = bv[0]; vel[1] = bv[1]; vel[2] = bv[2];
    if (family.length) {
      // the catalogue's mass of the whole family where it has one (the ephemeris's, whose centre
      // the planet's place was worked out from), less the moons simulated on their own
      gm = b.systemGm > b.gm ? b.systemGm : family.reduce((g, m) => g + m.gm, b.gm);
      for (const m of b.children) if (moon(m) && include(m)) gm -= m.gm;
      for (const m of family) {
        const w = m.gm / gm, mv = velOf.get(m)!;
        pos[0] += w * (m.pos.x - b.pos.x); pos[1] += w * (m.pos.y - b.pos.y); pos[2] += w * (m.pos.z - b.pos.z);
        vel[0] += w * (mv[0] - bv[0]); vel[1] += w * (mv[1] - bv[1]); vel[2] += w * (mv[2] - bv[2]);
      }
      carried.set(b.id, family);
    }
    // (the pole of its rotation: the body-fixed z axis)
    const bulge = BULGES[b.id], o = b.orientation.elements;
    const zonal = bulge ? { j2: bulge[0], radius: bulge[1] * 1e3, pole: [o[8], o[9], o[10]] } : undefined;
    // (a star's planets are always stepped: see `BodyInit.stepped`)
    sim.add({ id: b.id, gm, radius: b.radius, pos, vel, zonal, stepped: b.kind === 'star' });
  }
  return { sim, jd0: jd, carried, index: new Map(), layout: -1, shift: new Float64Array(0) };
}

/**
 * Put the app's bodies where the simulation has them at its time, and those it leaves out where
 * they ride (see above). `system.update(liveDate(live))` must have been made first: it gives
 * every body its own motion, which is then moved with the simulation. A simulated body is exactly
 * where the simulation has it, whatever the ephemeris says of it by then.
 */
export function apply(live: Live, system: SolarSystem): void {
  const sim = live.sim;
  sim.read();
  const ids = sim.ids, n = ids.length, index = live.index;
  if (live.layout !== sim.layout) {
    index.clear();
    for (let i = 0; i < n; i++) {
      const b = system.byId.get(ids[i]);
      if (b) index.set(b, i);
    }
    live.layout = sim.layout;
    if (live.shift.length < 6 * n) live.shift = new Float64Array(6 * Math.max(n, 64));
  }
  // how far each simulated body is from where the ephemeris has what it stands for (itself, or
  // its family's centre if it carries moons)
  const shift = live.shift;
  for (const [b, i] of index) {
    let x = b.pos.x, y = b.pos.y, z = b.pos.z, u = b.vel.x, v = b.vel.y, w = b.vel.z;
    const family = live.carried.get(b.id);
    if (family) {
      const gm = sim.gm[i];
      for (const m of family) {
        const f = m.gm / gm;
        x += f * (m.pos.x - b.pos.x); y += f * (m.pos.y - b.pos.y); z += f * (m.pos.z - b.pos.z);
        u += f * (m.vel.x - b.vel.x); v += f * (m.vel.y - b.vel.y); w += f * (m.vel.z - b.vel.z);
      }
    }
    const o = 3 * i, k = 6 * i;
    shift[k] = sim.pos[o] - x; shift[k + 1] = sim.pos[o + 1] - y; shift[k + 2] = sim.pos[o + 2] - z;
    shift[k + 3] = sim.vel[o] - u; shift[k + 4] = sim.vel[o + 1] - v; shift[k + 5] = sim.vel[o + 2] - w;
  }
  for (const b of system.bodies) {
    let i = index.get(b);
    if (i !== undefined && !live.carried.has(b.id)) {
      const o = 3 * i;
      b.pos.set(sim.pos[o], sim.pos[o + 1], sim.pos[o + 2]);
      b.vel.set(sim.vel[o], sim.vel[o + 1], sim.vel[o + 2]);
    } else {
      for (let a = i === undefined ? system.homeOf(b) : b; a && i === undefined; a = system.homeOf(a)) i = index.get(a);
      if (i === undefined) continue;
      const k = 6 * i;
      b.pos.set(b.pos.x + shift[k], b.pos.y + shift[k + 1], b.pos.z + shift[k + 2]);
      b.vel.set(b.vel.x + shift[k + 3], b.vel.y + shift[k + 4], b.vel.z + shift[k + 5]);
    }
    b.upos.set(b.pos.x, b.pos.y, b.pos.z);
  }
}

/**
 * The bodies that ride on `host` (see above): left out of the simulation themselves, with `host`
 * the first body they go round in the catalogue that is simulated, or `host` itself if it is one
 * the simulation no longer has (absorbed by another: what rode on it has nothing to ride on).
 */
export function riders(live: Live, system: SolarSystem, host: Body): Body[] {
  const simulated = new Set<number>(live.sim.ids);
  return system.bodies.filter((b) => {
    if (simulated.has(b.id) || !b.valid) return false;
    let a = system.homeOf(b);
    while (a && a !== host && !simulated.has(a.id)) a = system.homeOf(a);
    return a === host;
  });
}

/**
 * Simulate bodies that so far rode along (to change them, or because what they rode on is about
 * to be changed or taken away), from where they are now: each one's place as `apply` puts it, and
 * its motion likewise (the rate the app moves it, plus what the body it rode on has gained in the
 * simulation). A moon its planet stood for is taken out of the planet's share: the planet keeps
 * the rest of the family's mass, and its centre.
 */
export function release(live: Live, system: SolarSystem, bodies: Body | readonly Body[]): void {
  const sim = live.sim;
  const list = (bodies instanceof Array ? bodies : [bodies as Body]).filter((b) => b.valid && sim.indexOf(b.id) < 0);
  if (!list.length) return;
  sim.settle();
  const motion = motions(system, liveDate(live));
  // (the rate the app moves each, where the ephemeris's own velocity stood in what `apply` gives it)
  const own = list.map((b) => {
    const k = 3 * system.bodies.indexOf(b);
    return [motion[k] - b.vel.x, motion[k + 1] - b.vel.y, motion[k + 2] - b.vel.z];
  });
  apply(live, system);
  list.forEach((b, n) => {
    const vel = [b.vel.x + own[n][0], b.vel.y + own[n][1], b.vel.z + own[n][2]];
    const home = system.homeOf(b);
    const holder = home ? live.carried.get(home.id) : undefined;
    if (holder && home && holder.includes(b)) {
      const i = sim.indexOf(home.id), o = 3 * i;
      const total = sim.gm[i], rest = total - b.gm;
      sim.setMass(home.id, rest);
      sim.setState(
        home.id,
        [0, 1, 2].map((c) => (total * sim.pos[o + c] - b.gm * b.pos.getComponent(c)) / rest),
        [0, 1, 2].map((c) => (total * sim.vel[o + c] - b.gm * vel[c]) / rest),
      );
      holder.splice(holder.indexOf(b), 1);
      if (!holder.length) live.carried.delete(home.id);
    }
    sim.add({ id: b.id, gm: b.gm, radius: b.radius, pos: [b.pos.x, b.pos.y, b.pos.z], vel, stepped: b.kind === 'star' });
  });
}

/** central differences of the seventh order: offsets in steps and their weights (over 60 steps) */
const STENCIL = [[-3, -1], [-2, 9], [-1, -45], [1, 45], [2, -9], [3, 1]];
/** the step of those differences (s): long enough that the 40 µs to which a Julian date is held do not show */
const H = 900;
const MISS = 1e-5;

/**
 * Every body's velocity as the app moves it (three numbers a body, in the order of
 * `system.bodies`). The planets', the Sun's and the Moon's are the ephemeris's own derivatives; a
 * moon's on mean elements is the rate at which its place about its planet changes (differences of
 * the seventh order over ±45 minutes: right to a part in 10⁷ for the fastest), and its planet's
 * share of the difference is taken off the planet (whose own velocity is its family's less its
 * moons' momentum). Which moons: those whose velocity misses that rate by more than MISS of their
 * speed (by parts in a thousand). The others' are exact derivatives, better than differences of
 * the ephemeris's stored polynomials, which jump by metres where one meets the next.
 * Leaves the system updated to `jd`.
 */
export function motions(system: SolarSystem, jd: number): Float64Array {
  const bodies = system.bodies, n = bodies.length;
  const moons = bodies.filter((b) => b.parent && system.ephemerisKind(b) === 'satellite');
  const rate = new Map(moons.map((m) => [m, [0, 0, 0]]));
  for (const [step, w] of STENCIL) {
    system.update(jd + (step * H) / 86_400);
    for (const m of moons) {
      const r = rate.get(m)!, p = m.parent!;
      for (let c = 0; c < 3; c++) r[c] += (w * (m.pos.getComponent(c) - p.pos.getComponent(c))) / (60 * H);
    }
  }
  system.update(jd);
  for (const m of moons) {
    const r = rate.get(m)!, p = m.parent!;
    const u = m.vel.x - p.vel.x, v = m.vel.y - p.vel.y, w = m.vel.z - p.vel.z;
    if (Math.hypot(r[0] - u, r[1] - v, r[2] - w) < MISS * Math.hypot(u, v, w)) rate.delete(m);
  }
  const out = new Float64Array(3 * n), index = new Map(bodies.map((b, k) => [b, k]));
  bodies.forEach((b, k) => { out[3 * k] = b.vel.x; out[3 * k + 1] = b.vel.y; out[3 * k + 2] = b.vel.z; });
  for (const [m, r] of rate) {
    const p = m.parent!, o = 3 * index.get(p)!;
    if (system.ephemerisKind(p) !== 'spk' || !(m.gm > 0) || !(p.systemGm > p.gm)) continue;
    for (let c = 0; c < 3; c++) out[o + c] -= (m.gm / p.systemGm) * (r[c] - (m.vel.getComponent(c) - p.vel.getComponent(c)));
  }
  for (const [m, r] of rate) {
    const o = 3 * index.get(m)!, q = 3 * index.get(m.parent!)!;
    for (let c = 0; c < 3; c++) out[o + c] = out[q + c] + r[c];
  }
  return out;
}
