import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { propagateKepler } from '../src/sim/Kepler';
import { keplerDrift } from '../src/sim/KeplerDrift';

const MU = 1.32712440018e20; // the Sun
const AU = 149_597_870_700;

/** A repeatable stream of numbers in [0, 1). */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** A state with periapsis q, eccentricity e, at true anomaly nu, in a tilted plane. */
function state(q: number, e: number, nu: number, tilt = 0.4): { r: Float64Array; v: Float64Array } {
  const p = q * (1 + e);
  const rr = p / (1 + e * Math.cos(nu));
  const k = Math.sqrt(MU / p);
  const x = rr * Math.cos(nu), y = rr * Math.sin(nu);
  const vx = -k * Math.sin(nu), vy = k * (e + Math.cos(nu));
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return { r: new Float64Array([x, y * c, y * s]), v: new Float64Array([vx, vy * c, vy * s]) };
}

const energy = (r: Float64Array, v: Float64Array) => (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - MU / Math.hypot(r[0], r[1], r[2]);
const momentum = (r: Float64Array, v: Float64Array) => [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
const dist = (a: Float64Array, b: Float64Array) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('two-body motion on plain arrays', () => {
  it('agrees with the propagator the ship uses, on ellipses, hyperbolas and near-parabolas, either way in time', () => {
    const rnd = stream(20261120);
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      const q = AU * 10 ** (rnd() * 3 - 2);
      const e = i % 4 === 0 ? 1 + (rnd() - 0.5) * 2e-4 : i % 4 === 1 ? 1 + rnd() * 3 : rnd() * 0.99;
      const nu = (rnd() - 0.5) * (e < 1 ? 2 * Math.PI : 2 * Math.acos(-1 / Math.max(e, 1.0001)) * 0.8);
      const { r, v } = state(q, e, nu);
      // a step from a hundredth of the time round the periapsis to a hundred times it
      const dt = (rnd() < 0.5 ? -1 : 1) * 2 * Math.PI * Math.sqrt(q ** 3 / MU) * 10 ** (rnd() * 4 - 2);
      const R = new Vector3(r[0], r[1], r[2]), V = new Vector3(v[0], v[1], v[2]);
      const small = { r: r.slice(), v: v.slice() };
      const refOk = propagateKepler(R, V, MU, dt);
      const ok = keplerDrift(r, v, 0, MU, dt);
      expect(ok, `case ${i}: e ${e}`).toBe(true);
      const scale = Math.hypot(r[0], r[1], r[2]);
      // (the ship's propagator gives up on some long steps along a hyperbola: those are left out)
      if (refOk) worst = Math.max(worst, Math.hypot(r[0] - R.x, r[1] - R.y, r[2] - R.z) / scale);
      // one step lands where a hundred small ones do
      if (i % 10 === 0) {
        for (let k = 0; k < 100; k++) keplerDrift(small.r, small.v, 0, MU, dt / 100);
        expect(dist(small.r, r) / scale, `case ${i}: e ${e}`).toBeLessThan(1e-9);
      }
    }
    // (the two differ by the rounding of either: a few parts in 10¹⁰ where a long step ends near a fast periapsis)
    expect(worst).toBeLessThan(2e-9);
  });

  it('keeps energy and angular momentum to rounding over a hundred thousand steps of a twentieth of an orbit', () => {
    // (each pass of a tight periapsis in one long step costs more rounding: the bound grows with the eccentricity)
    for (const [e, bound] of [[0, 2e-12], [0.2, 2e-12], [0.6, 2e-12], [0.95, 1e-10]]) {
      const { r, v } = state(AU * (1 - e), e, 0.3);
      const E0 = energy(r, v), L0 = momentum(r, v);
      const period = 2 * Math.PI * Math.sqrt(AU ** 3 / MU);
      for (let i = 0; i < 100_000; i++) keplerDrift(r, v, 0, MU, period / 20);
      const L = momentum(r, v);
      expect(Math.abs(energy(r, v) / E0 - 1), `e ${e}`).toBeLessThan(bound);
      expect(Math.hypot(L[0] - L0[0], L[1] - L0[1], L[2] - L0[2]) / Math.hypot(...L0), `e ${e}`).toBeLessThan(bound);
    }
  });

  it('comes back to where it started after one period, however the period is cut up, and after any step taken back', () => {
    const { r, v } = state(0.3 * AU, 0.7, 1.1);
    const a = (0.3 * AU) / (1 - 0.7);
    const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU);
    const r0 = r.slice(), v0 = v.slice();
    for (const n of [1, 7, 20, 365]) {
      const rr = r0.slice(), vv = v0.slice();
      for (let i = 0; i < n; i++) keplerDrift(rr, vv, 0, MU, period / n);
      expect(dist(rr, r0) / a, `${n} steps`).toBeLessThan(1e-11);
    }
    // a thousand periods in one go
    keplerDrift(r, v, 0, MU, 1000 * period);
    expect(dist(r, r0) / a).toBeLessThan(1e-10);
    // there and back
    const rnd = stream(7);
    for (let i = 0; i < 200; i++) {
      const s = state(AU * (0.1 + rnd()), rnd() * 1.8, (rnd() - 0.5) * 2);
      const start = s.r.slice();
      const dt = (rnd() - 0.5) * 4e7;
      keplerDrift(s.r, s.v, 0, MU, dt);
      keplerDrift(s.r, s.v, 0, MU, -dt);
      expect(dist(s.r, start) / Math.hypot(start[0], start[1], start[2])).toBeLessThan(1e-11);
    }
  });

  it('writes where it is told and leaves the rest alone; without a mass the path is a straight line', () => {
    const r = new Float64Array([9, 9, 9, AU, 0, 0, 9, 9, 9]), v = new Float64Array([9, 9, 9, 0, 29_784.69, 0, 9, 9, 9]);
    const ro = new Float64Array(6), vo = new Float64Array(6);
    keplerDrift(r, v, 3, MU, 86_400, ro, vo, 3);
    expect(Array.from(r)).toEqual([9, 9, 9, AU, 0, 0, 9, 9, 9]);
    expect(Array.from(ro.subarray(0, 3))).toEqual([0, 0, 0]);
    // a day of the Earth's orbit: about a degree
    expect(Math.atan2(ro[4], ro[3]) * (180 / Math.PI)).toBeCloseTo(360 / 365.2569, 3);
    keplerDrift(r, v, 3, 0, 100);
    expect(Array.from(r.subarray(3, 6))).toEqual([AU, 2_978_469, 0]);
    expect(Array.from(v.subarray(3, 6))).toEqual([0, 29_784.69, 0]);
  });
});
