import { Vector3 } from 'three';
import type { UPos } from '../core/upos';
import { C, type GravitySource } from '../sim/Gravity';
import { boostProper, flipAndBurn } from '../sim/Relativity';

/** the autopilot plans its burns at this share of the drive's acceleration (the rest steers and holds against gravity) */
export const PLAN = 0.8;
/** the last stretch: the distance falls by e every SETTLE seconds */
const SETTLE = 20;
/** about the time the reaction wheels take to turn the ship round (s): braking starts this much early */
const TURN = 8;
/** round a world in its way, the autopilot keeps outside this many of its radii */
const KEEP = 1.3;

/** what the autopilot flies to: anything with a place (a body, a station, a star) */
interface SpaceObjectLike { readonly upos: UPos }

/** The situation, relative to the arrival point (the slot), which moves with the target. */
export interface Situation {
  /** from the slot to the ship (m, world) */
  rel: Vector3;
  /** the ship's proper velocity relative to the slot (m/s) */
  w: Vector3;
  /** the slot's own acceleration (an orbit's centripetal pull), and gravity's at the ship less the target's (m/s²) */
  slotAccel: Vector3;
  gravity: Vector3;
  /** the ship's nose (unit, world) */
  nose: Vector3;
  /** the drive's acceleration at full throttle, and the RCS's (m/s²) */
  drive: number;
  rcs: number;
  /** universe seconds of the last frame */
  dt: number;
  /** the arrival distance from the target (m) and the slot's orbital speed (m/s, 0 for none) */
  radius: number;
  orbit: number;
}

export interface Steering {
  /** where the nose should point (unit, world), and the main drive's throttle */
  aim: Vector3;
  throttle: number;
  /** the RCS's acceleration wanted (m/s², world) */
  rcs: Vector3;
  /** the nose is off the aim (time should run at 1x while it turns) */
  turning: boolean;
  /** proper time and universe time to go (s), by flip-and-burn from here */
  tauGo: number;
  tGo: number;
  phase: 'turning' | 'accelerating' | 'braking' | 'arriving' | 'holding';
  arrived: boolean;
}

/**
 * The slot: the arrival point `radius` from the target on the ship's side (`from`: the ship less
 * the target, m), moving with the target (`targetVel`), on a circular orbit about it if it pulls
 * (`gm` > 0, `rs` for a black hole's pseudo-potential; the orbit's normal `axis`, the ecliptic's if
 * none). Fills the situation's rel, w (from the ship's proper velocity `shipW`), slotAccel, orbit.
 */
export function placeSlot(s: Situation, from: Vector3, shipW: Vector3, targetVel: Vector3, gm: number, rs: number, axis: Vector3 | null): void {
  const dist = from.length();
  const out = dist > 0 ? _t.copy(from).divideScalar(dist) : _t.set(1, 0, 0);
  const v = _e.copy(targetVel);
  s.slotAccel.set(0, 0, 0);
  s.orbit = 0;
  if (gm > 0) {
    const n = axis && axis.lengthSq() > 0 ? _c.copy(axis).normalize() : _c.set(0, -0.3978, 0.9175);
    const t = n.cross(out);
    if (t.lengthSq() < 1e-6) t.set(-out.y, out.x, 0);
    const R = s.radius, a = rs > 0 ? gm / (R - rs) ** 2 : gm / (R * R);
    s.orbit = Math.sqrt(R * a);
    v.addScaledVector(t.normalize(), s.orbit);
    s.slotAccel.addScaledVector(out, -(s.orbit * s.orbit) / R);
  }
  s.rel.copy(out).multiplyScalar(dist - s.radius);
  boostProper(shipW, v.negate(), s.w);
}

/**
 * The autopilot's guidance, every frame. The ship is steered towards the proper velocity from which
 * braking at PLAN times the drive's acceleration stops it exactly at the slot (w = c√(x(2 + x)),
 * x = Ad/c²: the relativistic stopping distance), or for the last stretch towards a gentle
 * approach; with the deceleration that curve asks for, what holds the ship on the slot's path
 * against gravity, and feedback over a few frames, never quicker than the ship can turn. The flip
 * comes of itself where the ship meets the braking curve. The drive pushes along the nose, so it
 * pushes as the nose comes onto the aim; small corrections go to the RCS without turning.
 */
export function steer(s: Situation, out: Steering): Steering {
  const A = PLAN * s.drive;
  const d = s.rel.length();
  const toward = d > 0 ? _t.copy(s.rel).divideScalar(-d) : _t.set(0, 0, 0);
  // on the braking curve dw/dt = -A exactly (reckoned from where the ship will be once it has
  // turned round); on the gentle one the distance falls by e every SETTLE s
  const closing = s.w.dot(toward) / Math.hypot(1, s.w.length() / C);
  const x = (A * Math.max(0, d - Math.max(0, closing) * TURN)) / (C * C);
  const brake = C * Math.sqrt(x * (2 + x)), soft = d / SETTLE;
  const decel = brake < soft ? A : soft / SETTLE;
  const err = _e.copy(toward).multiplyScalar(Math.min(brake, soft)).sub(s.w);
  const cmd = _c.copy(err).divideScalar(Math.max(3 * s.dt, 5)).addScaledVector(toward, -decel).add(s.slotAccel).sub(s.gravity);
  if (cmd.length() < s.rcs) {
    out.throttle = 0;
    out.rcs.copy(cmd);
    out.turning = false;
  } else {
    out.rcs.set(0, 0, 0);
    out.aim.copy(cmd).normalize();
    const c = s.nose.dot(out.aim);
    out.turning = c < 0.97;
    out.throttle = Math.min(1, cmd.length() / s.drive) * Math.max(0, Math.min(1, (c - 0.9) / 0.09));
  }
  const fb = flipAndBurn(d, A, s.w.dot(toward));
  out.tauGo = fb.tau;
  out.tGo = fb.t;
  out.phase = out.turning ? 'turning' : d < s.radius * 0.05 + 1e3 ? 'arriving' : cmd.dot(toward) >= 0 ? 'accelerating' : 'braking';
  out.arrived = d < Math.max(0.01 * s.radius, 30) && s.w.length() < Math.max(0.01 * s.orbit, 0.5);
  return out;
}

/**
 * Stop: brake to rest in the frame of `s` (the nearest world's, or a star's) and hold there against
 * the pull that is left, on the drive along the nose. The situation is the ship's own place (rel 0,
 * slot at rest in that frame, its gravity less the world's): the autopilot's guidance with nothing
 * to fly to, so it only kills the velocity, never faster than the ship can turn, then holds. The time
 * to go is the braking's at the full drive: (c/a) asinh(w/c) aboard, w/a in that frame (dw/dt = a
 * along a straight line); `phase` says turning, braking or holding (arrived: at rest).
 */
export function brake(s: Situation, out: Steering): Steering {
  s.rel.set(0, 0, 0);
  steer(s, out);
  const w = s.w.length();
  out.tauGo = (C / s.drive) * Math.asinh(w / C);
  out.tGo = w / s.drive;
  out.phase = out.turning ? 'turning' : out.arrived ? 'holding' : 'braking';
  return out;
}

/**
 * A world in the way: the first of `worlds` (not `target` itself) that the straight path from the
 * ship to the target passes within 1.1 of its radius of, or that the ship's own motion (`vel`,
 * m/s, world) would, carried on as far as the target is (fast, a turn towards the target is a wide
 * curve: the line to it can be clear while the ship's path is not). Its detour point goes to `out`
 * (from the world's centre, m): where the tangent from the ship to the sphere of KEEP radii touches
 * it, on the target's side, carried out to the ship's distance or 2.2 radii, whichever is more
 * (from inside that sphere: straight up). The chord to it misses the sphere; flown towards, and
 * worked out again every frame from where the worlds are then, it leads round the world the
 * shortest way until the target is in sight. Null when the way is clear.
 */
export function inTheWay(ship: UPos, vel: Vector3, target: SpaceObjectLike, worlds: readonly GravitySource[], out: Vector3): GravitySource | null {
  for (const w of worlds) {
    if (w.obj === target || !(w.radius > 0)) continue;
    const R = w.radius, from = ship.sub(w.upos, _t), to = target.upos.sub(w.upos, _e);
    const seg = _c.copy(to).sub(from), d = seg.length();
    const ahead = _a.copy(vel).sub(w.vel);
    if (!skims(from, seg, 1.1 * R, false) && !(ahead.lengthSq() > 0 && skims(from, ahead.setLength(d), 1.1 * R, true))) continue;
    const r = from.length(), up = from.normalize();
    // round towards the target, in the plane of the ship, the world and the target (straight across: any way)
    const round = _c.copy(to).addScaledVector(up, -to.dot(up));
    if (round.lengthSq() < 1e-12 * to.lengthSq()) {
      round.set(-up.y, up.x, 0);
      if (round.lengthSq() < 1e-12) round.set(0, -up.z, up.y);
    }
    const a = r > KEEP * R ? Math.acos((KEEP * R) / r) : 0;
    out.copy(up).multiplyScalar(Math.cos(a)).addScaledVector(round.normalize(), Math.sin(a)).multiplyScalar(Math.max(r, 2.2 * R));
    return w;
  }
  return null;
}

/**
 * The time warp the autopilot allows: 1x while the ship turns; in one frame of `realDt` seconds at
 * most a twentieth of the proper time to go (so the arrival is resolved; the last stretch's gentle
 * approach counts as two SETTLE times at least) and at most the proper time in which the drive
 * (`drive`, m/s²) changes the rapidity by a tenth (so the steering keeps up at any Lorentz factor,
 * where a frame's push multiplies the speed's distance from c).
 */
export function autopilotRate(rate: number, s: Steering, realDt: number, drive: number): number {
  if (s.turning) rate = Math.min(rate, 1);
  return Math.min(rate, Math.max(1, Math.min(0.05 * Math.max(s.tauGo, 2 * SETTLE), (0.1 * C) / drive) / Math.max(realDt, 1e-3)));
}

/**
 * Does the segment from `p` along `seg` come within `r` of the origin, beyond its start (and, with
 * `end`, at its end too: a dive that has not yet reached its lowest point)?
 */
function skims(p: Vector3, seg: Vector3, r: number, end: boolean): boolean {
  const l2 = seg.lengthSq();
  const k = l2 > 0 ? -p.dot(seg) / l2 : 0;
  if (k <= 0 || (k >= 1 && !end)) return false;
  return _s.copy(p).addScaledVector(seg, Math.min(k, 1)).lengthSq() < r * r;
}

const _t = new Vector3();
const _e = new Vector3();
const _c = new Vector3();
const _a = new Vector3();
const _s = new Vector3();
