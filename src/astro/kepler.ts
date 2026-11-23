import { Matrix3, Vector3 } from 'three';
import { DEG } from '../core/units';

/**
 * Two-body (Keplerian) orbits. Handles elliptic, parabolic and hyperbolic
 * trajectories (comets). Angles in degrees at the API boundary, radians inside.
 */
export interface OrbitalElements {
  /** periapsis distance (m) */
  q: number;
  e: number;
  /** inclination, ascending node, argument of periapsis (deg) relative to the reference plane */
  i: number;
  node: number;
  peri: number;
  /** time of periapsis passage, JD (TDB) */
  tp: number;
  /** gravitational parameter of the central body, m^3/s^2 */
  mu: number;
}

const TWO_PI = Math.PI * 2;

/** Solve Kepler's equation M = E - e sin E (elliptic). */
export function solveKeplerElliptic(M: number, e: number): number {
  M = M % TWO_PI;
  if (M > Math.PI) M -= TWO_PI;
  else if (M < -Math.PI) M += TWO_PI;
  let E = e < 0.8 ? M : Math.sign(M) * Math.PI * 0.85;
  if (M === 0) return 0;
  // Safeguarded Newton: keep a bracket so near-parabolic orbits converge.
  let lo = -Math.PI, hi = Math.PI;
  for (let k = 0; k < 60; k++) {
    const f = E - e * Math.sin(E) - M;
    if (f > 0) hi = E; else lo = E;
    const fp = 1 - e * Math.cos(E);
    let En = E - f / fp;
    if (!(En > lo && En < hi)) En = 0.5 * (lo + hi);
    if (Math.abs(En - E) < 1e-15) return En;
    E = En;
  }
  return E;
}

/** Solve M = e sinh H - H (hyperbolic). */
export function solveKeplerHyperbolic(M: number, e: number): number {
  let H = Math.asinh(M / e);
  for (let k = 0; k < 80; k++) {
    const f = e * Math.sinh(H) - H - M;
    const fp = e * Math.cosh(H) - 1;
    const dH = f / fp;
    H -= dH;
    if (Math.abs(dH) < 1e-14 * Math.max(1, Math.abs(H))) break;
  }
  return H;
}

const _m = new Matrix3();

/** Rotation matrix perifocal -> reference frame: Rz(node) Rx(i) Rz(peri). */
export function perifocalMatrix(iDeg: number, nodeDeg: number, periDeg: number, out = _m): Matrix3 {
  const ci = Math.cos(iDeg * DEG), si = Math.sin(iDeg * DEG);
  const cO = Math.cos(nodeDeg * DEG), sO = Math.sin(nodeDeg * DEG);
  const cw = Math.cos(periDeg * DEG), sw = Math.sin(periDeg * DEG);
  return out.set(
    cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si,
    sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si,
    sw * si, cw * si, ci,
  );
}

/**
 * Position (and optionally velocity) at JD `jd` in the elements' reference frame, metres (m/s).
 */
export function keplerState(el: OrbitalElements, jd: number, pos: Vector3, vel?: Vector3): Vector3 {
  const dt = (jd - el.tp) * 86400;
  const { q, e, mu } = el;
  let x: number, y: number, vx = 0, vy = 0;
  if (e < 0.99999) {
    const a = q / (1 - e);
    const n = Math.sqrt(mu / (a * a * a));
    const E = solveKeplerElliptic(n * dt, e);
    const cE = Math.cos(E), sE = Math.sin(E);
    const b = a * Math.sqrt(1 - e * e);
    x = a * (cE - e);
    y = b * sE;
    if (vel) {
      const r = a * (1 - e * cE);
      const f = Math.sqrt(mu * a) / r;
      vx = -f * sE;
      vy = f * Math.sqrt(1 - e * e) * cE;
    }
  } else if (e > 1.00001) {
    const a = q / (e - 1);
    const n = Math.sqrt(mu / (a * a * a));
    const H = solveKeplerHyperbolic(n * dt, e);
    const cH = Math.cosh(H), sH = Math.sinh(H);
    x = a * (e - cH);
    y = a * Math.sqrt(e * e - 1) * sH;
    if (vel) {
      const r = a * (e * cH - 1);
      const f = Math.sqrt(mu * a) / r;
      vx = -f * sH;
      vy = f * Math.sqrt(e * e - 1) * cH;
    }
  } else {
    // Parabolic: Barker's equation, s = tan(nu/2)
    const W = 3 * Math.sqrt(mu / (2 * q * q * q)) * dt;
    const Y = Math.cbrt(W / 2 + Math.sqrt((W * W) / 4 + 1));
    const s = Y - 1 / Y;
    x = q * (1 - s * s);
    y = 2 * q * s;
    if (vel) {
      const h = Math.sqrt(2 * mu * q);
      vx = (-mu / h) * (2 * s / (1 + s * s));
      vy = (mu / h) * (1 + (1 - s * s) / (1 + s * s));
    }
  }
  const R = perifocalMatrix(el.i, el.node, el.peri);
  pos.set(x, y, 0).applyMatrix3(R);
  if (vel) vel.set(vx, vy, 0).applyMatrix3(R);
  return pos;
}

/** Elements from mean anomaly at an epoch (elliptic orbits). */
export function elementsFromMeanAnomaly(
  aMeters: number, e: number, iDeg: number, nodeDeg: number, periDeg: number,
  MDeg: number, epochJd: number, mu: number,
): OrbitalElements {
  const n = Math.sqrt(mu / (aMeters * aMeters * aMeters)); // rad/s
  const tp = epochJd - (MDeg * DEG) / n / 86400;
  return { q: aMeters * (1 - e), e, i: iDeg, node: nodeDeg, peri: periDeg, tp, mu };
}

/** Osculating elements from a state vector (any inertial frame). */
export function stateToElements(r: Vector3, v: Vector3, mu: number, jd: number): OrbitalElements {
  const h = new Vector3().crossVectors(r, v);
  const rn = r.length();
  const evec = new Vector3().crossVectors(v, h).divideScalar(mu).sub(r.clone().divideScalar(rn));
  const e = evec.length();
  const hn = h.length();
  const i = Math.acos(Math.max(-1, Math.min(1, h.z / hn)));
  const nvec = new Vector3(-h.y, h.x, 0);
  const nn = nvec.length();
  let node = nn > 1e-12 * hn ? Math.atan2(nvec.y, nvec.x) : 0;
  let peri: number;
  if (e > 1e-10) {
    if (nn > 1e-12 * hn) {
      peri = Math.acos(Math.max(-1, Math.min(1, nvec.dot(evec) / (nn * e))));
      if (evec.z < 0) peri = TWO_PI - peri;
    } else {
      peri = Math.atan2(evec.y, evec.x);
      if (h.z < 0) peri = -peri;
    }
  } else {
    peri = 0;
  }
  // true anomaly
  let nu: number;
  if (e > 1e-10) {
    nu = Math.acos(Math.max(-1, Math.min(1, evec.dot(r) / (e * rn))));
    if (r.dot(v) < 0) nu = TWO_PI - nu;
  } else {
    const ref = nn > 1e-12 * hn ? nvec.clone().normalize() : new Vector3(1, 0, 0);
    nu = Math.acos(Math.max(-1, Math.min(1, ref.dot(r) / rn)));
    if (r.z < 0 && nn > 1e-12 * hn) nu = TWO_PI - nu;
  }
  const p = (hn * hn) / mu;
  const q = p / (1 + e);
  let tp: number;
  if (e < 1) {
    const a = q / (1 - e);
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    const M = E - e * Math.sin(E);
    const n = Math.sqrt(mu / (a * a * a));
    tp = jd - M / n / 86400;
  } else {
    const a = q / (e - 1);
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    const M = e * Math.sinh(H) - H;
    const n = Math.sqrt(mu / (a * a * a));
    tp = jd - M / n / 86400;
  }
  if (node < 0) node += TWO_PI;
  return { q, e, i: i / DEG, node: node / DEG, peri: peri / DEG, tp, mu };
}

/**
 * An orbit whose energy is nearer nothing than this share of μ/d counts as open: one whose speed is
 * within half a millionth of the speed of escape where it is (the energy against μ/d is
 * (v / v_escape)² − 1). Bound, its far end would be over a million times as far out as it is now
 * (2a = μ/|E|), reached in no time that matters. A world thrown at the speed of escape is on the
 * edge, and rounding and what goes with it put it on either side: Mars thrown with its moons swings
 * about their common centre by some 3×10⁻⁵ m/s (e = 1 ± 2.5×10⁻⁹). A tolerance on e itself would
 * not do: a world falling straight in has e = 1, whatever its energy.
 */
export const OPEN_EDGE = 1e-6;

/**
 * Is the orbit of a body `d` (m) from what it goes round, with `energy` (J/kg: v²/2 − μ/d) about `mu`
 * (m³/s²), open? One rule for what the card says (src/app/Powers.ts: orbitOf) and the line drawn
 * (src/render/Orbits.ts).
 */
export function isOpen(energy: number, mu: number, d: number): boolean {
  return !(energy < -OPEN_EDGE * (mu / d));
}

/**
 * Where a body on an open path (nearest `q` m; a parabola, e = 1, or a hyperbola, e > 1) goes on to
 * from true anomaly `nu0` (rad) until it is `far` m out: as offsets (m) from where it is now, x and y
 * in the plane of the path (x towards the nearest point), into `out` two numbers a point; `n` even
 * steps of true anomaly, and before them `refine` more, halving towards the start. From q and the
 * true anomaly, r = q (1 + e) / (1 + e cos ν), which holds for any e: a parabola has no semi-major
 * axis to work from. Returns how many points (the first is where it is now: 0, 0).
 */
export function openPath(q: number, e: number, nu0: number, far: number, n: number, refine: number, out: Float64Array): number {
  const p = q * (1 + e);
  // (it can never turn as far as the asymptote of a hyperbola, or the far end of a parabola)
  const limit = e > 1 ? Math.acos(-1 / e) : Math.PI;
  const c = (p / far - 1) / e;
  const end = Math.min(limit * (1 - 1e-9), c <= -1 ? limit : Math.acos(Math.min(1, c)));
  const r0 = p / (1 + e * Math.cos(nu0)), x0 = r0 * Math.cos(nu0), y0 = r0 * Math.sin(nu0);
  let k = 0;
  const put = (nu: number) => {
    const r = p / (1 + e * Math.cos(nu));
    out[k++] = r * Math.cos(nu) - x0;
    out[k++] = r * Math.sin(nu) - y0;
  };
  out[k++] = 0;
  out[k++] = 0;
  if (!(end > nu0)) return 1;
  const step = (end - nu0) / n;
  for (let i = refine; i >= 1; i--) put(nu0 + step * Math.pow(0.5, i));
  for (let i = 1; i <= n; i++) put(nu0 + i * step);
  return k / 2;
}

/** Orbital period in days (Infinity for open orbits). */
export function periodDays(el: OrbitalElements): number {
  if (el.e >= 1) return Infinity;
  const a = el.q / (1 - el.e);
  return (TWO_PI * Math.sqrt((a * a * a) / el.mu)) / 86400;
}

/** Sample the orbit path (perifocal ellipse) in the reference frame; for open orbits sample +-range. */
export function sampleOrbit(el: OrbitalElements, n: number, out: Float64Array, maxRadius = Infinity): number {
  const R = perifocalMatrix(el.i, el.node, el.peri, new Matrix3());
  const e = el.e;
  const p = el.q * (1 + e);
  const tmp = new Vector3();
  let nuMax = Math.PI;
  if (e >= 1) {
    nuMax = Math.acos(-1 / e) * 0.999;
    if (Number.isFinite(maxRadius)) {
      const c = (p / maxRadius - 1) / e;
      if (c > -1 && c < 1) nuMax = Math.min(nuMax, Math.acos(c));
    }
  }
  let count = 0;
  for (let k = 0; k < n; k++) {
    // Denser sampling near periapsis: uniform in eccentric anomaly for ellipses.
    let nu: number;
    if (e < 1) {
      const E = (k / n) * TWO_PI - Math.PI;
      nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    } else {
      nu = -nuMax + (2 * nuMax * k) / (n - 1);
    }
    const r = p / (1 + e * Math.cos(nu));
    tmp.set(r * Math.cos(nu), r * Math.sin(nu), 0).applyMatrix3(R);
    out[count * 3] = tmp.x;
    out[count * 3 + 1] = tmp.y;
    out[count * 3 + 2] = tmp.z;
    count++;
  }
  return count;
}
