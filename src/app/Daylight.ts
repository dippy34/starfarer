import { Vector3 } from 'three';

/**
 * Day and night at a place on a turning world (pure: no app state).
 *
 * Seen from the world's ground the Sun turns about the axis W = Ω - ω: the world's spin ω and,
 * against it, the Sun's own drift along the sky from the world's motion round it, Ω = r × v / r²
 * (it makes the Moon's day 29.5 days, not the 27.3 of its spin). Over a day both are steady, so the
 * Sun's direction from the place turns by |W| t about W, and the Sun's height over the horizon of a
 * place with upward direction `up` is a + R cos(φ - δ): sunrise is where that crosses the height
 * asked for on its way up.
 */

/** the Sun's height over the horizon (rad) seen from a place whose upward direction is `up` */
export function sunHeight(up: Vector3, sunDir: Vector3): number {
  return Math.asin(Math.max(-1, Math.min(1, up.dot(sunDir) / (up.length() * sunDir.length()))));
}

/**
 * Seconds until the Sun next stands `height` (rad; 0: on the horizon) over the horizon of the place
 * and climbing, for a world spinning at `spin` (rad/s, world axes) and drifting round its sun at
 * `orbit` (rad/s, the Sun's apparent motion's own axis and rate); null where it never gets there
 * (a polar night, or a polar day for a height below the lowest it sinks to).
 */
export function sunriseIn(up: Vector3, sunDir: Vector3, spin: Vector3, orbit: Vector3, height = 0): number | null {
  const W = _w.copy(orbit).sub(spin);
  const rate = W.length();
  if (!(rate > 0)) return null;
  const k = W.divideScalar(rate);
  const u = _u.copy(up).normalize(), s = _s.copy(sunDir).normalize();
  const a = u.dot(k) * s.dot(k);
  const b = u.dot(s) - a;
  const c = u.dot(_c.crossVectors(k, s));
  const R = Math.hypot(b, c);
  if (R < 1e-12) return null;
  const x = (Math.sin(height) - a) / R;
  if (x > 1 || x < -1) return null;
  const TAU = 2 * Math.PI;
  let phi = (Math.atan2(c, b) - Math.acos(x)) % TAU;
  if (phi < 0) phi += TAU;
  if (phi < 1e-9) phi = TAU;
  return phi / rate;
}

/** The Sun's apparent drift along the sky of a world at `rel` (from its sun, m) moving at `vel` (m/s, relative to it): r × v / r². */
export function orbitDrift(rel: Vector3, vel: Vector3, out = new Vector3()): Vector3 {
  return out.crossVectors(rel, vel).divideScalar(Math.max(rel.lengthSq(), 1e-30));
}

const _w = new Vector3();
const _u = new Vector3();
const _s = new Vector3();
const _c = new Vector3();
