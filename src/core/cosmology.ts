/**
 * Flat ΛCDM cosmology (Planck 2018 TT,TE,EE+lowE+lensing+BAO):
 * H0 = 67.66 km/s/Mpc, Ωm = 0.3111, plus radiation so that distances stay
 * sensible out to the CMB.
 *
 * Redshift-derived positions in Starfarer are *comoving* distances: the
 * universe is drawn as it is "now", not as we see it via ancient light.
 */

export const H0 = 67.66; // km/s/Mpc
export const OMEGA_M = 0.3111;
export const OMEGA_R = 9.18e-5; // photons + 3 massless neutrinos
export const OMEGA_L = 1 - OMEGA_M - OMEGA_R;
const C_KMS = 299_792.458;
/** Hubble distance c/H0 in Mpc. */
export const HUBBLE_DISTANCE_MPC = C_KMS / H0;
/** Hubble time 1/H0 in Gyr. */
export const HUBBLE_TIME_GYR = 977.7922216807892 / H0;

/** Dimensionless Hubble parameter E(z) = H(z)/H0. */
export function hubbleE(z: number): number {
  const a = 1 + z;
  return Math.sqrt(OMEGA_R * a * a * a * a + OMEGA_M * a * a * a + OMEGA_L);
}

/** Composite Simpson integration of f over [a, b] with n (even) intervals. */
function simpson(f: (x: number) => number, a: number, b: number, n: number): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 === 0 ? 2 : 4);
  return (s * h) / 3;
}

/** Line-of-sight comoving distance in Mpc by direct numerical integration. */
export function comovingDistanceExact(z: number): number {
  if (z <= 0) return 0;
  // Integrate in u = ln(1+z) so the integrand stays smooth out to the CMB.
  const n = Math.max(32, 2 * Math.ceil(Math.log1p(z) * 200));
  return HUBBLE_DISTANCE_MPC * simpson((u) => Math.exp(u) / hubbleE(Math.exp(u) - 1), 0, Math.log1p(z), n);
}

/** Lookback time in Gyr. */
export function lookbackTimeGyr(z: number): number {
  if (z <= 0) return 0;
  const n = Math.max(32, 2 * Math.ceil(Math.log1p(z) * 200));
  return HUBBLE_TIME_GYR * simpson((u) => 1 / hubbleE(Math.exp(u) - 1), 0, Math.log1p(z), n);
}

// ---- Fast table-based versions for decoding millions of catalogue redshifts ----

/** Table spacing in redshift, and its upper limit. */
const DZ = 0.002;
const Z_MAX = 12;
let table: Float64Array | null = null;

function ensureTable(): Float64Array {
  if (table) return table;
  const n = Math.round(Z_MAX / DZ) + 1;
  const t = new Float64Array(n);
  // Cumulative Simpson: integrate each cell from the previous table value.
  for (let i = 1; i < n; i++) {
    const z0 = (i - 1) * DZ;
    const z1 = i * DZ;
    const zm = (z0 + z1) / 2;
    t[i] = t[i - 1]! + (HUBBLE_DISTANCE_MPC * DZ * (1 / hubbleE(z0) + 4 / hubbleE(zm) + 1 / hubbleE(z1))) / 6;
  }
  table = t;
  return t;
}

/** Comoving distance in Mpc (table lookup with linear interpolation; ~1e-7 relative accuracy). */
export function comovingDistanceMpc(z: number): number {
  if (z <= 0) return 0;
  if (z >= Z_MAX) return comovingDistanceExact(z);
  const t = ensureTable();
  const f = z / DZ;
  const i = Math.floor(f);
  return t[i]! + (t[i + 1]! - t[i]!) * (f - i);
}

/** Inverse: redshift at a given comoving distance in Mpc. */
export function redshiftAtComovingMpc(d: number): number {
  if (d <= 0) return 0;
  const t = ensureTable();
  if (d >= t[t.length - 1]!) {
    // Beyond the table: bisection on the exact integral (rare; only near the CMB).
    let lo = Z_MAX;
    let hi = 1200;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (comovingDistanceExact(mid) < d) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! < d) lo = mid;
    else hi = mid;
  }
  return (lo + (d - t[lo]!) / (t[hi]! - t[lo]!)) * DZ;
}

/** Distance modulus μ = 5·log10(d_L / 10 pc), with luminosity distance d_L = (1+z)·d_C. */
export function distanceModulus(z: number): number {
  const dl = comovingDistanceMpc(z) * (1 + z);
  return 5 * Math.log10(Math.max(dl, 1e-9) * 1e5);
}
