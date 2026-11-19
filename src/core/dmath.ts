/**
 * Deterministic transcendental functions.
 *
 * ECMAScript only guarantees correctly-rounded results for + − × ÷ and
 * Math.sqrt. Math.sin/cos/exp/log/pow are "implementation-approximated" and
 * may differ in the last bit between JS engines — enough to flip a threshold
 * decision in a generator and break "same coordinates, same universe,
 * forever". The procedural generators therefore use these arithmetic-only
 * versions (accurate to ~1e-14), which are bit-identical everywhere.
 *
 * Rendering code is free to use the faster Math.* built-ins.
 */

const LN2 = 0.6931471805599453;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Detect endianness once so the exponent word index is right everywhere.
f64[0] = 1;
const HI = u32[1] === 0x3ff00000 ? 1 : 0;

/** Exact 2^k for integer k in the normal double range. */
function pow2(k: number): number {
  if (k < -1022) return 0;
  if (k > 1023) return Infinity;
  u32[HI] = (k + 1023) << 20;
  u32[1 - HI] = 0;
  return f64[0]!;
}

/** Deterministic natural logarithm. */
export function dlog(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  // Split x = m · 2^e with m in [1, 2) by reading the IEEE exponent bits.
  let e = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 4503599627370496; // scale subnormals by 2^52
    e = -52;
  }
  f64[0] = x;
  e += ((u32[HI]! >>> 20) & 0x7ff) - 1023;
  u32[HI] = (u32[HI]! & 0x000fffff) | 0x3ff00000;
  let m = f64[0]!;
  if (m > 1.4142135623730951) {
    m *= 0.5;
    e += 1;
  }
  // log(m) = 2·atanh(s), s = (m−1)/(m+1), |s| ≤ 0.1716 → fast series.
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = s;
  for (let k = 3; k <= 27; k += 2) {
    term *= s2;
    sum += term / k;
  }
  return 2 * sum + e * LN2;
}

/** Deterministic exponential. */
export function dexp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.2) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  // Taylor series on |r| ≤ 0.347.
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 16; i++) {
    term *= r / i;
    sum += term;
  }
  return k < -1022 ? sum * pow2(k + 60) * pow2(-60) : sum * pow2(k);
}

/** Deterministic power for positive bases. */
export function dpow(base: number, exponent: number): number {
  if (exponent === 0) return 1;
  if (base === 0) return exponent > 0 ? 0 : Infinity;
  if (base < 0) {
    // Only integer exponents make sense for negative bases.
    const r = dexp(exponent * dlog(-base));
    return Math.abs(exponent % 2) === 1 ? -r : r;
  }
  return dexp(exponent * dlog(base));
}

export function dlog10(x: number): number {
  return dlog(x) / 2.302585092994046;
}

export function dpow10(x: number): number {
  return dexp(x * 2.302585092994046);
}

function sinKernel(r: number): number {
  const r2 = r * r;
  // Taylor to r^15 on |r| ≤ π/4.
  return r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800 - r2 / 1307674368000)))))));
}

function cosKernel(r: number): number {
  const r2 = r * r;
  return 1 + r2 * (-0.5 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 / 20922789888000)))))));
}

/** Deterministic sine. */
export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  // Reduce to q quarter-turns + r, |r| ≤ π/4.
  const q = Math.round(x / HALF_PI);
  const r = x - q * HALF_PI;
  switch (((q % 4) + 4) % 4) {
    case 0:
      return sinKernel(r);
    case 1:
      return cosKernel(r);
    case 2:
      return -sinKernel(r);
    default:
      return -cosKernel(r);
  }
}

/** Deterministic cosine. */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** Deterministic arctangent. */
export function datan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  const inv = a > 1;
  if (inv) a = 1 / a;
  // Two half-angle reductions bring |a| below ~0.2 for a quickly converging series.
  a = a / (1 + Math.sqrt(1 + a * a));
  a = a / (1 + Math.sqrt(1 + a * a));
  const a2 = a * a;
  let term = a;
  let sum = a;
  for (let k = 3; k <= 25; k += 2) {
    term *= -a2;
    sum += term / k;
  }
  let r = 4 * sum;
  if (inv) r = HALF_PI - r;
  return neg ? -r : r;
}

/** Deterministic two-argument arctangent. */
export function datan2(y: number, x: number): number {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + Math.PI : datan(y / x) - Math.PI;
  return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
}

export function dasin(x: number): number {
  const c = x < -1 ? -1 : x > 1 ? 1 : x;
  return datan2(c, Math.sqrt(1 - c * c));
}

export function dacos(x: number): number {
  return HALF_PI - dasin(x);
}

export { TWO_PI, HALF_PI };
