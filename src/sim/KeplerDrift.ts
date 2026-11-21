/**
 * Two-body motion on plain arrays, for the N-body engine (src/sim/NBody.ts): the same universal
 * variable as src/sim/Kepler.ts (one formulation for ellipses, parabolas and hyperbolas, exact to
 * rounding for any step), written for an inner loop: no objects, no allocation, and the series of
 * the Stumpff functions wherever the step is a small part of an orbit, which is every step the
 * engine takes.
 *
 * With X the universal anomaly, β = 2μ/r₀ − v₀² (μ over the semi-major axis), η = r₀·v₀ and
 * ζ = μ − βr₀, Kepler's equation is r₀X + ηG₂ + ζG₃ = Δt, where Gₙ = Xⁿcₙ(βX²) and cₙ are the
 * Stumpff functions. Its left side grows with X at the rate r > 0, so Newton's method is kept
 * inside a bracket and cannot fail.
 */

const TWO_PI = 2 * Math.PI;

/** c₂ and c₃ of the last call to `stumpff` */
let c2 = 0.5, c3 = 1 / 6;

/** The Stumpff functions c₂(z) = (1 − cos√z)/z and c₃(z) = (√z − sin√z)/√z³, continued to z ≤ 0. */
function stumpff(z: number): void {
  if (z > 1) {
    const s = Math.sqrt(z);
    c2 = (1 - Math.cos(s)) / z;
    c3 = (s - Math.sin(s)) / (z * s);
  } else if (z < -1) {
    const s = Math.sqrt(-z);
    c2 = (1 - Math.cosh(s)) / z;
    c3 = (Math.sinh(s) - s) / (-z * s);
  } else {
    // Σ (−z)ᵏ/(2k+2)! and Σ (−z)ᵏ/(2k+3)!: ten terms reach rounding at |z| = 1, where the closed
    // forms above would still lose digits to cancellation
    c2 = 1 / 2 - z * (1 / 24 - z * (1 / 720 - z * (1 / 40320 - z * (1 / 3628800 - z * (1 / 479001600 - z * (1 / 87178291200
      - z * (1 / 20922789888000 - z * (1 / 6402373705728000 - z / 2432902008176640000))))))));
    c3 = 1 / 6 - z * (1 / 120 - z * (1 / 5040 - z * (1 / 362880 - z * (1 / 39916800 - z * (1 / 6227020800 - z * (1 / 1307674368000
      - z * (1 / 355687428096000 - z * (1 / 121645100408832000 - z / 51090942171709440000))))))));
  }
}

/**
 * Move the state (r, v) at offset `o` of the arrays `r` and `v` along its two-body orbit about a
 * point mass `mu` (m³/s²) by `dt` seconds (either sign), writing the result at offset `oo` of `ro`
 * and `vo` (by default in place). With `mu` 0 the motion is a straight line. Returns false if the
 * iteration did not settle (the result is then the best it reached).
 */
export function keplerDrift(
  r: Float64Array, v: Float64Array, o: number, mu: number, dt: number,
  ro: Float64Array = r, vo: Float64Array = v, oo: number = o,
): boolean {
  const x = r[o], y = r[o + 1], z = r[o + 2];
  const vx = v[o], vy = v[o + 1], vz = v[o + 2];
  const r0 = Math.sqrt(x * x + y * y + z * z);
  if (!(mu > 0) || !(r0 > 0) || dt === 0) {
    ro[oo] = x + vx * dt; ro[oo + 1] = y + vy * dt; ro[oo + 2] = z + vz * dt;
    vo[oo] = vx; vo[oo + 1] = vy; vo[oo + 2] = vz;
    return true;
  }
  const eta = x * vx + y * vy + z * vz;
  const beta = 2 * mu / r0 - (vx * vx + vy * vy + vz * vz);
  const zeta = mu - beta * r0;
  // whole turns of an ellipse are dropped: what is left is at most half a turn either way
  if (beta > 0) {
    const period = TWO_PI * mu / (beta * Math.sqrt(beta));
    if (Math.abs(dt) > 0.5 * period) dt -= Math.round(dt / period) * period;
  }
  // first guess: the series of X in dt to the third order (a small part of an orbit); for a
  // longer step the circle's X = β dt / μ, or far along a hyperbola its asymptote, where X grows
  // only with the logarithm of the time
  const u = dt / r0;
  const a = (0.5 * eta) / r0, b = zeta / (6 * r0);
  let X = u;
  if (Math.abs(a * u) < 0.25 && Math.abs(b * u * u) < 0.25) X = u * (1 - a * u + (2 * a * a - b) * u * u);
  else if (beta > 0) X = (beta * dt) / mu;
  else if (beta < 0) {
    const w = Math.sqrt(-beta), s = dt > 0 ? 1 : -1;
    const far = s * Math.log((-2 * beta * dt) / (eta + (s * zeta) / w)) / w;
    if (Number.isFinite(far) && far * dt > 0) X = far;
  }
  // X has the sign of dt and the root lies between `lo` and `hi`
  let lo = dt > 0 ? 0 : -Infinity, hi = dt > 0 ? Infinity : 0;
  let ok = false;
  let last = Infinity;
  let G1 = 0, G2 = 0, G3 = 0;
  for (let i = 0; i < 80; i++) {
    const X2 = X * X;
    const zz = beta * X2;
    stumpff(zz);
    G1 = X * (1 - zz * c3); G2 = X2 * c2; G3 = X2 * X * c3;
    if (ok) break;
    const F = r0 * X + eta * G2 + zeta * G3 - dt;
    // (far out on a hyperbola sinh overflows: X is then too far its own way)
    const far = !Number.isFinite(F);
    if (far ? X > 0 : F > 0) hi = X; else lo = X;
    let Xn = far ? NaN : X - F / (r0 + eta * G1 + zeta * G2);
    // a Newton step leaves the bracket on its closed side: halve it (or, with no number to go on
    // and a side still open, reach twice as far). Down the steep side of a hyperbola Newton
    // creeps: a step that is still large and no shorter than half the last one halves the bracket too.
    let step = Math.abs(Xn - X);
    const creeping = step > 0.5 * last && step > 1e-6 * Math.abs(X) && lo !== -Infinity && hi !== Infinity;
    if (!(Xn >= lo && Xn <= hi) || creeping) {
      Xn = hi === Infinity ? 2 * lo : lo === -Infinity ? 2 * hi : 0.5 * (lo + hi);
      step = Math.abs(Xn - X);
    }
    // settled: the step is at rounding, or has stopped shrinking where rounding is all that is left
    const size = Math.abs(Xn);
    ok = step <= 4e-16 * size || (step >= last && last <= 1e-9 * size);
    last = step;
    X = Xn;
  }
  const rn = r0 + eta * G1 + zeta * G2;
  // f − 1, g, df/dt and dg/dt − 1 of Gauss: the small differences are formed first, so a short
  // step changes the state by exactly its small amount
  const f = (-mu * G2) / r0, g = dt - mu * G3;
  const fd = (-mu * G1) / (r0 * rn), gd = (-mu * G2) / rn;
  ro[oo] = x + (f * x + g * vx); ro[oo + 1] = y + (f * y + g * vy); ro[oo + 2] = z + (f * z + g * vz);
  vo[oo] = vx + (fd * x + gd * vx); vo[oo + 1] = vy + (fd * y + gd * vy); vo[oo + 2] = vz + (fd * z + gd * vz);
  return ok;
}
