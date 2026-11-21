import { Vector3 } from 'three';
import { C } from './Gravity';

/*
 * Special relativity for the ship. Its motion is carried as proper velocity w = γv (m/s): finite
 * and exact at any Lorentz factor, where v itself rounds to c (at γ = 10⁹, 1 - v/c = 5·10⁻¹⁹, far
 * below what a double resolves next to 1). Nothing here overflows before the distances it gives do.
 */

/** Lorentz factor of a proper velocity: γ = √(1 + w²/c²). */
export function lorentz(w: Vector3): number {
  return Math.hypot(1, Math.hypot(w.x, w.y, w.z) / C);
}

/** Coordinate velocity v = w/γ of a proper velocity (below c, to rounding, however large w). */
export function velocityOf(w: Vector3, out: Vector3): Vector3 {
  return out.copy(w).divideScalar(lorentz(w));
}

/** Proper velocity w = γv of a coordinate velocity (held a hair below c, should one reach it). */
export function properVelocityOf(v: Vector3, out: Vector3): Vector3 {
  const b = Math.min(Math.hypot(v.x, v.y, v.z) / C, 1 - 1e-16);
  return out.copy(v).multiplyScalar(1 / Math.sqrt((1 - b) * (1 + b)));
}

/**
 * The proper velocity, in the frame where a frame F moves at coordinate velocity V, of a body whose
 * proper velocity in F is `w` (a Lorentz boost of its four-velocity). With -V it goes the other way.
 * Composed this way no speed ever adds up to c.
 */
export function boostProper(w: Vector3, V: Vector3, out: Vector3): Vector3 {
  const b2 = V.lengthSq() / (C * C);
  if (b2 === 0) return out.copy(w);
  const s = Math.sqrt(1 - Math.min(b2, 1 - 1e-16));
  const gV = 1 / s, gVm1 = b2 / (s * (1 + s)); // γ_V and γ_V - 1, without cancellation
  const n = _n.copy(V).normalize();
  const k = gVm1 * w.dot(n) + gV * lorentz(w) * Math.sqrt(V.lengthSq());
  return out.copy(w).addScaledVector(n, k);
}

/**
 * The motion under the ship's own drive alone, solved exactly: proper acceleration `a` (m/s², as
 * an accelerometer aboard reads it) along the unit vector `dir`, held for `h` seconds of coordinate
 * time (negative runs it backwards). `dir` is the direction in the ship's own rest frame, whose
 * axes are the frame's carried over by a pure boost. Updates the proper velocity `w`, writes the
 * displacement into `dr`, and returns the proper time that passed aboard.
 *
 * The solution (hyperbolic motion with a sideways velocity): with the proper velocity split into
 * p along `dir` and q across it, q/(γ + 1) stays constant, and in a parameter φ that grows
 * uniformly with proper time (dφ/dτ = Ω = εa/c, ε² = 1 - κ², κ = q/(c(γ + 1)))
 *   γ = (κ² + cosh φ)/ε²,  p = c sinh φ/ε,  t = (κ²φ + sinh φ)/(ε²Ω),
 *   x_along = c² cosh φ/(aε²),  x_across = q̂ κc²(φ + sinh φ)/(aε³)
 * (each up to its value at the start).
 * From rest (κ = 0) these are the textbook v = c tanh(aτ/c), x = (c²/a)(cosh(aτ/c) - 1),
 * t = (c/a) sinh(aτ/c). Given h, φ is found by Newton's method within a bracket.
 */
export function driveFlow(w: Vector3, dir: Vector3, a: number, h: number, dr: Vector3): number {
  const g0 = lorentz(w);
  if (!(a > 0) || h === 0) {
    dr.copy(w).multiplyScalar(h / g0);
    return h / g0;
  }
  const H = hyperbola(w, dir, a, g0);
  // solve κ²Δφ + sinh(φ0 + Δφ) - sinh φ0 = ε²Ωh for Δφ (the left side rises at a slope of at
  // least 1 + κ², which brackets the root). Two rounds of Δφ = asinh(sinh φ0 + ε²Ωh - κ²Δφ) - φ0
  // (exact when κ = 0, and contracting, by κ²/cosh φ < 1) land next to it however long the step
  // (Newton's method from afar would creep down the exponential one unit of φ at a time); Newton's
  // steps, kept inside the bracket, finish it.
  const target = H.e2 * H.omega * h;
  const bound = target / (1 + H.k2);
  let lo = Math.min(0, bound), hi = Math.max(0, bound);
  const sinh0 = Math.sinh(H.phi0);
  let d = 0;
  for (let i = 0; i < 2; i++) d = Math.asinh(sinh0 + target - H.k2 * d) - H.phi0;
  if (!(d >= lo && d <= hi)) d = 0.5 * (lo + hi);
  for (let i = 0; i < 100; i++) {
    const f = H.k2 * d + 2 * Math.cosh(H.phi0 + d / 2) * Math.sinh(d / 2) - target;
    if (f > 0) hi = d; else if (f < 0) lo = d; else break;
    const step = f / (H.k2 + Math.cosh(H.phi0 + d));
    if (Math.abs(step) <= 1e-15 * Math.abs(d)) { d -= step; break; }
    d = d - step > lo && d - step < hi ? d - step : 0.5 * (lo + hi);
    if (hi - lo <= 1e-15 * Math.abs(d)) break;
  }
  const sHalf = Math.sinh(d / 2);
  const dSinh = 2 * Math.cosh(H.phi0 + d / 2) * sHalf; // sinh φ - sinh φ0
  const dCosh = 2 * Math.sinh(H.phi0 + d / 2) * sHalf; // cosh φ - cosh φ0
  const g1 = (H.k2 + Math.cosh(H.phi0 + d)) / H.e2;
  dr.copy(dir).multiplyScalar((C * C * dCosh) / (a * H.e2));
  if (H.qn > 0) dr.addScaledVector(_q, (H.kappa * C * C * (d + dSinh)) / (a * H.e2 * H.e * H.qn));
  // w: p along, q across scaled by (γ + 1)/(γ0 + 1)
  w.copy(_q).multiplyScalar((g1 + 1) / (g0 + 1)).addScaledVector(dir, (C * Math.sinh(H.phi0 + d)) / H.e);
  return d / H.omega;
}

/** The coordinate time in which `tau` seconds pass aboard under the drive alone (as driveFlow). */
export function driveTime(w: Vector3, dir: Vector3, a: number, tau: number): number {
  const g0 = lorentz(w);
  if (!(a > 0)) return tau * g0;
  const H = hyperbola(w, dir, a, g0);
  const d = H.omega * tau;
  const dSinh = 2 * Math.cosh(H.phi0 + d / 2) * Math.sinh(d / 2);
  return (H.k2 * d + dSinh) / (H.e2 * H.omega);
}

/** The constants of the hyperbolic motion of driveFlow (into a shared object; across-part into _q). */
function hyperbola(w: Vector3, dir: Vector3, a: number, g0: number) {
  const p0 = w.dot(dir);
  const H = _hyp;
  H.qn = _q.copy(w).addScaledVector(dir, -p0).length();
  H.kappa = H.qn / (C * (g0 + 1));
  H.k2 = H.kappa * H.kappa;
  // ε² = 1 - κ², written so that nothing cancels when the motion is mostly across the thrust
  H.e2 = 2 / (g0 + 1) + (p0 / (C * (g0 + 1))) ** 2;
  H.e = Math.sqrt(H.e2);
  H.omega = (a * H.e) / C;
  H.phi0 = Math.asinh((p0 * H.e) / C);
  return H;
}
const _hyp = { qn: 0, kappa: 0, k2: 0, e2: 0, e: 0, omega: 0, phi0: 0 };

/** Rapidity η (cosh η = γ) of a proper velocity's size. */
export function rapidity(w: number): number {
  return Math.asinh(w / C);
}

export interface FlipAndBurn {
  /** proper time aboard (s) */
  tau: number;
  /** coordinate (universe) time (s) */
  t: number;
  /** the highest Lorentz factor on the way */
  gammaMax: number;
}

/**
 * Accelerate at proper acceleration `a` towards a point `dist` metres ahead, turn, and decelerate
 * to rest there, starting with proper velocity `w0` towards it (negative: away). Straight line,
 * no gravity. If the ship cannot stop in time it overshoots, stops, and comes back.
 */
export function flipAndBurn(dist: number, a: number, w0 = 0): FlipAndBurn {
  const k = (C * C) / a;
  const eta0 = rapidity(w0);
  const stop = k * (Math.cosh(eta0) - 1);
  if (eta0 > 0 && stop > dist) {
    // brake to a stop beyond the point, then the trip back from rest
    const back = flipAndBurn(stop - dist, a);
    return { tau: (C / a) * eta0 + back.tau, t: (C / a) * Math.sinh(eta0) + back.t, gammaMax: Math.max(Math.cosh(eta0), back.gammaMax) };
  }
  // accelerate from η0 to η1, then brake from η1 to 0: k(cosh η1 - cosh η0) + k(cosh η1 - 1) = dist
  const ch1 = (dist / k + Math.cosh(eta0) + 1) / 2;
  const eta1 = Math.acosh(ch1);
  return { tau: (C / a) * (2 * eta1 - eta0), t: (C / a) * (2 * Math.sinh(eta1) - Math.sinh(eta0)), gammaMax: ch1 };
}

const _n = new Vector3();
const _q = new Vector3();
