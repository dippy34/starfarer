import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { UPos } from '../src/core/upos';
import { C, G, GravityField, MSUN, makeSource, type GravitySource } from '../src/sim/Gravity';
import { boostProper, driveFlow, driveTime, flipAndBurn, lorentz, properVelocityOf, velocityOf } from '../src/sim/Relativity';
import { FlightCore, G0, SHIP_SPEC } from '../src/sim/ShipPhysics';

const YEAR = 365.25 * 86400;
const LY = C * YEAR;
const X = new Vector3(1, 0, 0);
/** below c, to the rounding of a double (the proper velocity itself is exact) */
const belowC = (v: number) => v <= C * (1 + 1e-15);

/** Fly the core for `T` universe seconds in frames of `dt`. */
function fly(core: FlightCore, T: number, dt: number): void {
  for (let t = 0; t < T - 1e-9 * T;) {
    const h = Math.min(dt, T - t);
    core.chooseFrame();
    core.step(h);
    core.place();
    t += h;
  }
}

/** A ship far from everything, the reactionless drive set to `a`, nose along `dir`. */
function deepSpace(a: number, dir = X): FlightCore {
  const core = new FlightCore(new GravityField());
  const ship = core.ship;
  ship.drive = 'reactionless';
  ship.driveAccel = a;
  ship.throttle = 1;
  ship.quat.setFromUnitVectors(new Vector3(0, 0, -1), dir);
  return core;
}

describe('constant proper acceleration (closed forms)', () => {
  // γ from 1 + 10⁻¹⁶ to 10²⁹
  const cases: [number, number][] = [[G0, 1], [G0, 3600], [G0, YEAR], [G0, 10 * YEAR], [1e6 * G0, 2100], [3e-3, 1e5]];
  it.each(cases)('a = %d m/s², τ = %d s: v = c tanh(aτ/c), x = (c²/a)(cosh(aτ/c) - 1), t = (c/a) sinh(aτ/c)', (a, tau) => {
    const k = (a * tau) / C;
    const t = (C / a) * Math.sinh(k);
    const w = new Vector3(), dr = new Vector3();
    const tauGot = driveFlow(w, X, a, t, dr);
    expect(Math.abs(tauGot / tau - 1)).toBeLessThan(1e-14);
    // (cosh k - 1 = 2 sinh²(k/2), written without cancellation)
    expect(Math.abs(dr.x / ((2 * C * C / a) * Math.sinh(k / 2) ** 2) - 1)).toBeLessThan(1e-13);
    expect(Math.abs(lorentz(w) / Math.cosh(k) - 1)).toBeLessThan(1e-13);
    const v = velocityOf(w, new Vector3()).x;
    expect(Math.abs(v / (C * Math.tanh(k)) - 1)).toBeLessThan(1e-14);
    expect(belowC(v)).toBe(true);
    expect(Math.abs(driveTime(new Vector3(), X, a, tau) / t - 1)).toBeLessThan(1e-14);
  });

  it('one long step and a thousand short ones agree, even with a sideways start and at γ ≈ 10⁹', () => {
    for (const w0 of [new Vector3(0, 2 * C, 0), new Vector3(-3e8 * C, 7e8 * C, 1e5)]) {
      const dir = new Vector3(1, 0.3, -0.2).normalize();
      const w1 = w0.clone(), d1 = new Vector3(), sum = new Vector3(), w2 = w0.clone(), d2 = new Vector3();
      let tau1 = 0;
      for (let i = 0; i < 1000; i++) { tau1 += driveFlow(w1, dir, 20, 1e7, d1); sum.add(d1); }
      const tau2 = driveFlow(w2, dir, 20, 1e10, d2);
      expect(Math.abs(tau1 / tau2 - 1)).toBeLessThan(1e-12);
      expect(sum.distanceTo(d2) / d2.length()).toBeLessThan(1e-12);
      expect(w1.distanceTo(w2) / w2.length()).toBeLessThan(1e-12);
      // a step backwards undoes it
      const back = new Vector3();
      driveFlow(w2, dir, 20, -1e10, back);
      expect(w2.distanceTo(w0) / w0.length()).toBeLessThan(1e-12);
      expect(back.add(d2).length() / d2.length()).toBeLessThan(1e-12);
    }
  });

  it('the proper acceleration is the drive’s, however the ship is moving', () => {
    // the four-acceleration's size from a finite difference of the four-velocity
    const w0 = new Vector3(0.4 * C, -2.5 * C, 0.7 * C), dir = new Vector3(0, 0, 1);
    const w = w0.clone(), dr = new Vector3();
    const dTau = driveFlow(w, dir, 9, 1e-3, dr);
    const dU = w.clone().sub(w0), dU0 = (lorentz(w) - lorentz(w0)) * C;
    const a = Math.sqrt(dU.lengthSq() - dU0 * dU0) / dTau;
    expect(a / 9).toBeCloseTo(1, 4);
  });
});

describe('the classic voyage', () => {
  it('flip-and-burn at 1 g to Alpha Centauri (4.37 ly): about 3.6 years aboard, 6 on Earth', () => {
    const fb = flipAndBurn(4.37 * LY, G0);
    expect(fb.tau / YEAR).toBeCloseTo(3.58, 2);
    expect(fb.t / YEAR).toBeCloseTo(6.0, 1);
    expect(fb.gammaMax).toBeCloseTo(1 + (G0 * 4.37 * LY) / (2 * C * C), 9);
  });

  it('the ship flies it: arrives at rest, its clock reads the closed form, the universe’s too', () => {
    const fb = flipAndBurn(4.37 * LY, G0);
    const core = deepSpace(G0);
    const start = core.ship.upos.clone();
    // frames of a day: each is one exact step out here
    fly(core, fb.t / 2, 86400);
    expect(core.ship.gamma).toBeCloseTo(fb.gammaMax, 9);
    core.ship.quat.setFromUnitVectors(new Vector3(0, 0, -1), X.clone().negate());
    fly(core, fb.t / 2, 86400);
    const travelled = core.ship.upos.sub(start, new Vector3());
    expect(Math.abs(travelled.x / (4.37 * LY) - 1)).toBeLessThan(1e-12);
    expect(core.ship.properVelocity().length()).toBeLessThan(1e-3);
    expect(Math.abs(core.ship.shipTime / fb.tau - 1)).toBeLessThan(1e-12);
  });

  it('with a sixth of the trip to brake from a standing start the ship overshoots and comes back', () => {
    const a = G0, d = 1e15;
    const fast = flipAndBurn(d, a, 3 * C); // already at γ = 3.16 towards it: cannot stop in time
    const stop = ((C * C) / a) * (Math.hypot(1, 3) - 1);
    expect(stop).toBeGreaterThan(d);
    expect(fast.tau).toBeCloseTo((C / a) * Math.asinh(3) + flipAndBurn(stop - d, a).tau, 3);
    // moving away first: braking, then the trip from rest
    const away = flipAndBurn(d, a, -C);
    expect(away.tau).toBeGreaterThan(flipAndBurn(d, a).tau);
  });
});

describe('composing velocities', () => {
  it('never reaches c, and adds rapidities along a line', () => {
    const speeds = [0, 1e3, 0.3 * C, 0.99 * C, 0.999999 * C];
    const proper = [0, 1e5, 3 * C, 1e4 * C, 1e9 * C];
    for (const V of speeds) {
      for (const w of proper) {
        for (const dir of [1, -1]) {
          const out = boostProper(new Vector3(dir * w, 0, 0), new Vector3(V, 0, 0), new Vector3());
          const want = Math.sinh(Math.asinh((dir * w) / C) + Math.atanh(V / C)) * C;
          expect(Math.abs(out.x - want)).toBeLessThanOrEqual(1e-9 * Math.max(Math.abs(want), 1) + 1e-6);
          expect(belowC(velocityOf(out, new Vector3()).length())).toBe(true);
        }
      }
    }
  });

  it('a sideways velocity and a boost: the boost back undoes it, the speed stays below c', () => {
    const w = new Vector3(2e8, -5e9 * C, 3e7), V = new Vector3(0.6 * C, 0.7 * C, 0.1 * C);
    const there = boostProper(w, V, new Vector3());
    const back = boostProper(there, V.clone().negate(), new Vector3());
    expect(back.distanceTo(w) / w.length()).toBeLessThan(1e-12);
    expect(belowC(velocityOf(there, new Vector3()).length())).toBe(true);
    // v -> w -> v round trip at an everyday speed
    const v = new Vector3(7000, -2000, 300);
    expect(velocityOf(properVelocityOf(v, new Vector3()), new Vector3()).distanceTo(v)).toBeLessThan(1e-9);
  });

  it('nothing in the ship reaches c, however long the drive burns', () => {
    const core = deepSpace(1e6 * G0);
    core.spec = { ...SHIP_SPEC, gammaMax: Infinity };
    for (let i = 0; i < 40; i++) {
      fly(core, 1e5 * Math.exp(i / 2), Infinity);
      expect(Number.isFinite(core.ship.gamma)).toBe(true);
      expect(belowC(core.ship.vel.length())).toBe(true);
    }
    expect(core.ship.gamma).toBeGreaterThan(1e9);
  });
});

describe('the low-speed limit is the old integrator', () => {
  const GM_EARTH = 3.986004418e14;
  const R_EARTH = 6.371e6;
  /** Earth and Moon, both moving (so the boosts between frames are exercised) */
  function earthField() {
    const field = new GravityField();
    const earth = makeSource({ name: 'Earth', gm: GM_EARTH, radius: R_EARTH, upos: UPos.from(1.2e11, -8e10, 3e10), vel: new Vector3(12e3, -25e3, 4e3) });
    const moon = makeSource({ name: 'Moon', gm: 4.9048695e12, radius: 1.7374e6, upos: UPos.from(1.2e11 + 3.844e8, -8e10, 3e10), vel: new Vector3(12e3, -25e3 + 1022, 4e3) });
    field.sources = [earth, moon];
    return { field, earth };
  }
  const rel = (core: FlightCore, s: GravitySource) => [...core.ship.upos.sub(s.upos, new Vector3()).toArray(), ...core.ship.vel.clone().sub(s.vel).toArray()];
  /**
   * Positions (m) and velocities (m/s) the Newtonian integrator gave before relativity (the code
   * as it was, same frames). They differ from today's by what relativity adds at 8 km/s,
   * v²/c² ~ 10⁻⁹ (millimetres over an orbit), and by the composition with the Earth's 28 km/s,
   * a Lorentz boost now, Galileo's then (10⁻⁸ of the speed).
   */
  const OLD = {
    leo: [6770999.955394463, 937.1040759384623, -281.13122278586843, -0.8325053279368149, 7349.01658981157, -2204.704976940231],
    burn: [4838906.258485415, 5048872.60131529, -1.0127027988636368e-15, -5296.025869395213, 6276.492000224098, 0, 21005.776692350628],
    escape: [-6382880799.3845, 2654833500.218481, 0, -2051.8127432850706, 841.8208128732222, 0],
    drag: [6439082.146679352, 156867.71372025297, 0, -191.5932385695578, 7819.380051385349, 0, 2161.2523528816096],
  };
  const near = (got: number[], want: number[], dx: number, dv: number) => {
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(dx);
    for (let i = 3; i < 6; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(dv);
  };

  it('a low orbit (one period at 100x)', () => {
    const { field, earth } = earthField();
    const core = new FlightCore(field);
    const r0 = R_EARTH + 400e3;
    core.setCircularOrbit(earth, r0, new Vector3(1, 0, 0), new Vector3(0.2, 0.3, 1).normalize());
    fly(core, 2 * Math.PI * Math.sqrt(r0 ** 3 / GM_EARTH), 100 / 60);
    near(rel(core, earth), OLD.leo, 0.02, 1e-4);
  });

  it('a burn of the torch, then ten minutes of coasting', () => {
    const { field, earth } = earthField();
    const core = new FlightCore(field);
    core.setCircularOrbit(earth, R_EARTH + 400e3, new Vector3(1, 0, 0), new Vector3(0, 0, 1));
    const v = core.ship.vel.clone().sub(earth.vel).normalize();
    core.ship.quat.setFromUnitVectors(new Vector3(0, 0, -1), v.applyAxisAngle(new Vector3(0, 0, 1), 0.3));
    core.ship.throttle = 1;
    fly(core, 60, 1 / 60);
    core.ship.throttle = 0;
    fly(core, 600, 1);
    const got = rel(core, earth);
    near(got, OLD.burn, 0.01, 1e-4);
    expect(core.ship.fuel).toBe(OLD.burn[6]);
  });

  it('a hyperbolic escape over a month', () => {
    const { field, earth } = earthField();
    earth.soi = Infinity;
    const core = new FlightCore(field);
    const r0 = R_EARTH + 300e3;
    core.setCircularOrbit(earth, r0, new Vector3(1, 0, 0), new Vector3(0, 0, 1));
    const v = core.ship.vel.clone().sub(earth.vel);
    core.ship.vel.copy(earth.vel).addScaledVector(v.normalize(), Math.sqrt((2 * GM_EARTH) / r0) * 1.02);
    fly(core, 3e6, 60);
    // (near escape speed the path magnifies the 10⁻⁹ differences of the start a hundredfold)
    near(rel(core, earth), OLD.escape, 2e-7 * 7e9, 2e-7 * 2200);
  });

  it('drag and heating in the upper air', () => {
    const { field, earth } = earthField();
    const core = new FlightCore(field);
    core.atmosphere = { rho0: 1.225, H: 8500, R0: R_EARTH, top: 140e3 };
    core.setCircularOrbit(earth, R_EARTH + 70e3, new Vector3(1, 0, 0), new Vector3(0, 0, 1));
    fly(core, 20, 1 / 60);
    near(rel(core, earth), OLD.drag, 1e-3, 1e-4);
    expect(core.ship.hullTemp).toBeCloseTo(OLD.drag[6], 3);
  });
});

describe('clocks', () => {
  it('the ship’s clock under constant proper acceleration: τ = (c/a) asinh(at/c)', () => {
    const core = deepSpace(2 * G0);
    let t = 0;
    for (const dt of [10, 1e3, 1e5, 1e7, 3e7, 1e8]) {
      fly(core, dt, dt);
      t += dt;
      expect(Math.abs(core.ship.shipTime / ((C / (2 * G0)) * Math.asinh((2 * G0 * t) / C)) - 1)).toBeLessThan(1e-12);
    }
  });

  it('frames sized by universeTimeFor advance the ship’s clock by exactly what was asked', () => {
    const core = deepSpace(50 * G0, new Vector3(0.2, 1, 0).normalize());
    core.ship.vel.set(2e8, 0, 0); // a sideways start
    let tau = 0;
    for (let i = 0; i < 50; i++) {
      const dTau = 3600 * (1 + i);
      const dt = core.universeTimeFor(dTau);
      fly(core, dt, dt);
      tau += dTau;
      expect(Math.abs(core.ship.shipTime / tau - 1)).toBeLessThan(1e-12);
    }
    expect(core.ship.gamma).toBeGreaterThan(500);
    // coasting: the universe runs γ times faster
    core.ship.throttle = 0;
    expect(core.universeTimeFor(1) / core.ship.gamma).toBeCloseTo(1, 12);
  });

  it('the twins: out and back at 1 g, the traveller comes home younger by the closed form', () => {
    const core = deepSpace(G0);
    const leg = flipAndBurn(1 * LY, G0);
    const nose = (s: number) => core.ship.quat.setFromUnitVectors(new Vector3(0, 0, -1), X.clone().multiplyScalar(s));
    let t = 0;
    for (const s of [1, -1, -1, 1]) { nose(s); fly(core, leg.t / 2, 1e6); t += leg.t / 2; }
    expect(core.ship.upos.toVector3().length()).toBeLessThan(1e-6 * LY);
    expect(Math.abs(core.ship.shipTime / (2 * leg.tau) - 1)).toBeLessThan(1e-12);
    expect(t - core.ship.shipTime).toBeCloseTo(2 * (leg.t - leg.tau), -3);
  });
});

describe('gravity at speed', () => {
  function hole(massSun: number) {
    const field = new GravityField();
    const gm = G * massSun * MSUN;
    const src = makeSource({ name: 'BH', gm, rs: (2 * gm) / (C * C), upos: UPos.from(4e19, 1e19, -2e19) });
    field.sources = [src];
    return { field, src };
  }

  it('an orbit at 0.4 c keeps its energy γc² + Φ and its angular momentum r × w', () => {
    const { field, src } = hole(10);
    const core = new FlightCore(field);
    core.spec = { ...SHIP_SPEC, tidalLimit: Infinity };
    core.setCircularOrbit(src, 6 * src.rs, new Vector3(1, 0, 0), new Vector3(0, 0, 1));
    core.ship.vel.multiplyScalar(1.05);
    const state = () => {
      core.syncRel();
      const r = core.rel, w = core.relW;
      return { E: lorentz(w) * C * C - src.gm / (r.length() - src.rs), L: r.clone().cross(w).length(), v: core.relVel.length() };
    };
    const s0 = state();
    expect(s0.v / C).toBeGreaterThan(0.3);
    const T = 2 * Math.PI * Math.sqrt((6 * src.rs) ** 3 / src.gm);
    fly(core, 5 * T, T / 50);
    const s1 = state();
    expect(core.event).toBeNull();
    expect(Math.abs(s1.E / s0.E - 1)).toBeLessThan(1e-6);
    expect(Math.abs(s1.L / s0.L - 1)).toBeLessThan(1e-9);
  });

  it('periapses advance within 10 % of Schwarzschild’s rate from 6 to 10 rs (Newtonian motion with the pseudo-potential: 30 % short)', () => {
    for (const k of [6, 8, 10]) {
      const { field, src } = hole(10);
      const core = new FlightCore(field);
      core.spec = { ...SHIP_SPEC, tidalLimit: Infinity };
      core.setCircularOrbit(src, k * src.rs, new Vector3(1, 0, 0), new Vector3(0, 0, 1));
      core.ship.vel.multiplyScalar(1.002);
      const T = 2 * Math.PI * Math.sqrt((k * src.rs) ** 3 / src.gm);
      let last = 0, turned = 0, lastRv = 0;
      const peri: number[] = [];
      for (let t = 0; t < 10 * T; t += T / 200) {
        fly(core, T / 200, T / 200);
        const r = core.ship.upos.sub(src.upos, new Vector3()), v = core.ship.vel.clone().sub(src.vel);
        const a = Math.atan2(r.y, r.x);
        turned += a - last - 2 * Math.PI * Math.round((a - last) / (2 * Math.PI));
        last = a;
        if (lastRv < 0 && r.dot(v) >= 0) peri.push(turned);
        lastRv = r.dot(v);
      }
      // nearly circular: the advance per radial period is 2π(Ω_φ/Ω_r - 1); Schwarzschild's Ω_r/Ω_φ = √(1 - 3rs/r)
      const adv = peri[2] - peri[1] - 2 * Math.PI;
      const schw = 2 * Math.PI * (1 / Math.sqrt(1 - 3 / k) - 1);
      expect(Math.abs(adv / schw - 1)).toBeLessThan(0.1);
    }
  });

  it('a sideways burn at γ ≈ 10⁹ past a star: no NaN, the burn turns the motion at a/γ, the star pulls', () => {
    const field = new GravityField();
    const star = makeSource({ name: 'Star', gm: G * MSUN, radius: 7e8, upos: UPos.from(1e16, 0, 0) });
    field.sources = [star];
    const core = new FlightCore(field);
    core.ship.upos.copy(star.upos).addXYZ(-1e13, 1e11, 0);
    core.ship.vel.set(1, 0, 0);
    core.syncRel();
    core.relW.set(1e9 * C, 0, 0);
    core.place();
    core.ship.drive = 'reactionless';
    core.ship.driveAccel = 1e3 * G0;
    core.ship.throttle = 1;
    core.ship.quat.setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(0, 1, 0));
    fly(core, 200, 0.5);
    const r = core.ship.upos.sub(star.upos, new Vector3()), w = core.ship.properVelocity();
    expect(Number.isFinite(r.x) && Number.isFinite(core.ship.shipTime) && Number.isFinite(core.ship.gamma)).toBe(true);
    expect(r.x / (-1e13 + 200 * C)).toBeCloseTo(1, 9);
    // across the motion: the drive's a/γ, less the star's pull towards it (gravity changes w as at rest)
    const pull = (star.gm * 1e11) / Math.hypot(1e13, 1e11) ** 3;
    expect(w.y / (((1e3 * G0) / 1e9 - pull) * 200)).toBeCloseTo(1, 4);
    expect(core.ship.shipTime / (200 / 1e9)).toBeCloseTo(1, 6);
    expect(belowC(core.ship.vel.length())).toBe(true);
  });
});
