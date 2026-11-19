/**
 * Astronomy helpers: sky coordinates, reference-frame rotations, Kepler orbits.
 * World axes are ICRS equatorial (x → RA 0h/Dec 0°, z → north celestial pole).
 */
import { type Mat3, type V3, mat3MulV, mat3Transpose } from './math';

export const DEG = Math.PI / 180;

/** Unit vector for right ascension / declination in degrees. */
export function raDecToUnit(raDeg: number, decDeg: number): V3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return { x: c * Math.cos(ra), y: c * Math.sin(ra), z: Math.sin(dec) };
}

/** Right ascension / declination (degrees) of a direction vector. */
export function unitToRaDec(v: V3): { ra: number; dec: number } {
  const r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  let ra = Math.atan2(v.y, v.x) / DEG;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.asin(Math.max(-1, Math.min(1, v.z / r))) / DEG };
}

/** ICRS → Galactic rotation (ESA Hipparcos & Tycho Catalogues, Vol. 1, eq. 1.5.11). */
export const ICRS_TO_GAL: Mat3 = [
  -0.0548755604162154, -0.873437090234885, -0.4838350155487132,
  0.4941094278755837, -0.4448296299600112, 0.7469822444972189,
  -0.8676661490190047, -0.1980763734312015, 0.4559837761750669,
];
export const GAL_TO_ICRS: Mat3 = mat3Transpose(ICRS_TO_GAL);

/** Mean obliquity of the ecliptic at J2000 (IAU 2006). */
export const OBLIQUITY = 23.4392911 * DEG;
const COS_E = Math.cos(OBLIQUITY);
const SIN_E = Math.sin(OBLIQUITY);

/** Ecliptic (J2000) → ICRS equatorial. */
export function eclipticToIcrs(v: V3): V3 {
  return { x: v.x, y: COS_E * v.y - SIN_E * v.z, z: SIN_E * v.y + COS_E * v.z };
}

export const galacticToIcrs = (v: V3): V3 => mat3MulV(GAL_TO_ICRS, v);
export const icrsToGalactic = (v: V3): V3 => mat3MulV(ICRS_TO_GAL, v);

/** Format RA (deg) as "12h 34m 56.7s". */
export function formatRa(raDeg: number): string {
  const h = (((raDeg % 360) + 360) % 360) / 15;
  const hh = Math.floor(h);
  const m = (h - hh) * 60;
  const mm = Math.floor(m);
  return `${hh}h ${String(mm).padStart(2, '0')}m ${((m - mm) * 60).toFixed(1).padStart(4, '0')}s`;
}

/** Format Dec (deg) as "+12° 34′ 56″". */
export function formatDec(decDeg: number): string {
  const s = decDeg < 0 ? '−' : '+';
  const a = Math.abs(decDeg);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  const mm = Math.floor(m);
  return `${s}${d}° ${String(mm).padStart(2, '0')}′ ${String(Math.round((m - mm) * 60)).padStart(2, '0')}″`;
}

/** Classical Keplerian elements. Angles in radians, lengths in metres, times in seconds. */
export interface OrbitElements {
  /** Semi-major axis. */
  a: number;
  /** Eccentricity (0 ≤ e < 1). */
  e: number;
  /** Inclination to the reference plane. */
  i: number;
  /** Longitude of the ascending node. */
  node: number;
  /** Argument of periapsis. */
  peri: number;
  /** Mean anomaly at epoch t = 0 (J2000). */
  m0: number;
  /** Orbital period in seconds. */
  period: number;
}

/** Solve Kepler's equation M = E − e·sin E by Newton iteration. */
export function solveKepler(meanAnomaly: number, e: number): number {
  let M = meanAnomaly % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  else if (M < -Math.PI) M += 2 * Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 12; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/**
 * Position on a Kepler orbit at time t (seconds since J2000), in the orbit's
 * reference frame (x toward the reference direction, z normal to the reference plane).
 */
export function orbitPosition(el: OrbitElements, t: number, out?: V3): V3 {
  const o = out ?? { x: 0, y: 0, z: 0 };
  const M = el.m0 + (2 * Math.PI * t) / el.period;
  const E = solveKepler(M, el.e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  // Position in the orbital plane (periapsis along +x).
  const px = el.a * (cosE - el.e);
  const py = el.a * Math.sqrt(1 - el.e * el.e) * sinE;
  const cw = Math.cos(el.peri);
  const sw = Math.sin(el.peri);
  const cn = Math.cos(el.node);
  const sn = Math.sin(el.node);
  const ci = Math.cos(el.i);
  const si = Math.sin(el.i);
  const x1 = cw * px - sw * py;
  const y1 = sw * px + cw * py;
  o.x = cn * x1 - sn * ci * y1;
  o.y = sn * x1 + cn * ci * y1;
  o.z = si * y1;
  return o;
}

/** Orbital period from Kepler's third law (a in metres, total mass in kg). */
export function orbitalPeriod(a: number, totalMassKg: number): number {
  return 2 * Math.PI * Math.sqrt((a * a * a) / (6.6743e-11 * totalMassKg));
}
