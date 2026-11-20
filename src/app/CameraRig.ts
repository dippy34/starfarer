import { Matrix4, Quaternion, Vector3 } from 'three';
import { UPos } from '../core/upos';
import type { SpaceObject } from '../universe/Body';
import type { Drag, Point } from './Gestures';
import type { Input } from './Input';
import { approachWeight } from '../universe/Scale';

/** no pointer turns the camera about its target faster than this (rad per pixel) */
const ORBIT_RATE = 0.005;
/** a wheel tick changes the height above the target by this factor */
const WHEEL_STEP = Math.log(1.18);
/** zooming out stops here (m): the edge of what there is to see */
const FARTHEST = 5e26;

/**
 * `fov` is the vertical field of view of a wide (landscape) view. In an upright view, as on a
 * phone, the same vertical angle would leave a sliver of the scene across, so the view opens up:
 * by the frame's shape, to at most 1.5 times as tall (50° becomes 70°).
 */
export function verticalFov(fov: number, aspect: number): number {
  if (aspect >= 1) return fov;
  return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * Math.min(1 / aspect, 1.5)) * 180) / Math.PI;
}

/**
 * Camera state in universal coordinates plus the flight model: free fly with speed proportional
 * to altitude, orbit and zoom about the target (what the camera last flew to), and a logarithmic
 * "go to" autopilot.
 *
 * Pointers act on the target as on a globe under the hand: a drag that starts on its surface
 * carries that point of the surface along with the pointer, a pinch or the wheel changes the
 * height above the surface by a factor (so it eases all the way down), keeping what is under the
 * pointer under it.
 */
export class CameraRig {
  readonly upos = new UPos();
  readonly quat = new Quaternion();
  /** vertical field of view of a wide view (degrees); see `fovY` */
  fov = 50;
  /** the view's size in CSS pixels (pointer positions are in these) */
  readonly viewport = { width: 1280, height: 720 };
  /**
   * How far above the middle of the view the camera holds what it is aimed at (rad). On an upright
   * phone the foot of the screen is under the interface: the subject belongs in the room left
   * above it (the app sets this from the layout). Used wherever the camera is aimed: `lookAt`
   * and the autopilot's turn.
   */
  aim = 0;
  /** what one finger does while there is a target: turn the camera about it, or look around */
  touchDrag: 'orbit' | 'look' = 'orbit';
  /**
   * The target as a pointer finds it, set by the app every frame: the radius of its surface under
   * the camera (0: nothing solid to take hold of, as with a nebula or a galaxy) and the closest
   * that zooming brings the camera to its centre (m).
   */
  surface = 0;
  closest = 1;
  /**
   * The vertical of the world the camera is near (unit vector, set by the app) and how much it
   * counts: 0 in open space, 1 near the ground, where looking round keeps the horizon level.
   */
  readonly vertical = new Vector3(0, 0, 1);
  verticalWeight = 0;
  /** body the camera co-moves with (so planets do not run away under time acceleration) */
  anchor: SpaceObject | null = null;
  private anchorPrev = new UPos();
  /** user speed multiplier (mouse wheel / +-) */
  speedFactor = 1;
  /** current linear speed (m/s), for the HUD */
  speed = 0;
  /** distance to the nearest surface (m), provided by the app every frame */
  altitude = 1e9;
  /** what the camera orbits and zooms about: the last destination, until the explorer goes elsewhere */
  target: SpaceObject | null = null;
  /**
   * Ship flight (game mode): the velocity follows the controls over this many seconds and is kept
   * (slowly damped by "flight assist") when they are released. 0 = classic free fly.
   */
  inertia = 0;
  /** brake held (ship flight): stop quickly */
  braking = false;
  /** forward thrust command -1..1 (for the cockpit display) */
  thrust = 0;
  private goto: GotoState | null = null;
  /**
   * Seconds for which the camera still counts as climbing away after a zoom out: standing on the
   * ground, the app keeps the eye at standing height (App.keepAboveGround) unless it is leaving.
   */
  rising = 0;
  /** a zoom under way (zoomToward): the factor still to apply (log), where it holds on, the time left */
  private gliding: { log: number; at: Point; left: number } | null = null;
  private velocity = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private rayA = new Vector3();
  private rayB = new Vector3();
  private hitA = new Vector3();
  private hitB = new Vector3();
  private q = new Quaternion();

  /** vertical field of view of this view (degrees): `fov`, opened up when the view is upright */
  get fovY(): number {
    return verticalFov(this.fov, this.viewport.width / this.viewport.height);
  }

  /**
   * How much farther than in a wide view the camera stands back from what it frames, so that it
   * takes the same share of the view's narrower side (1 on a wide screen, about 1.4 on a phone held upright).
   */
  get framing(): number {
    const aspect = this.viewport.width / this.viewport.height;
    return aspect >= 1 ? 1 : Math.tan((this.fov * Math.PI) / 360) / (Math.tan((this.fovY * Math.PI) / 360) * aspect);
  }

  /** the angle one CSS pixel spans at the middle of the view (rad) */
  get pixelAngle(): number {
    return (2 * Math.tan((this.fovY * Math.PI) / 360)) / this.viewport.height;
  }

  /** The direction (unit, world axes) seen at a point of the view (CSS px). */
  ray(x: number, y: number, out = new Vector3()): Vector3 {
    const { width, height } = this.viewport;
    const t = Math.tan((this.fovY * Math.PI) / 360);
    return out.set(((2 * x) / width - 1) * t * (width / height), (1 - (2 * y) / height) * t, -1).normalize().applyQuaternion(this.quat);
  }

  get autopilot(): boolean {
    return this.goto !== null;
  }

  /** current velocity (m/s, world axes; free flight only) */
  get vel(): Vector3 {
    return this.velocity;
  }

  /** Kill the current velocity (docking, landing). */
  stop(): void {
    this.velocity.set(0, 0, 0);
    this.speed = 0;
  }

  /** seconds left on the current autopilot flight (0 if none) */
  get gotoRemaining(): number {
    return this.goto ? this.goto.T - this.goto.t : 0;
  }

  /** Re-anchor without moving: the camera keeps its absolute position. */
  setAnchor(a: SpaceObject | null): void {
    if (a === this.anchor) return;
    this.anchor = a;
    if (a) this.anchorPrev.copy(a.upos);
  }

  /** Apply the anchor's motion since the previous frame (call after objects were updated). */
  followAnchor(): void {
    if (!this.anchor) return;
    const d = this.anchor.upos.sub(this.anchorPrev, this.tmp);
    this.upos.addVec(d);
    this.anchorPrev.copy(this.anchor.upos);
  }

  forward(out = new Vector3()): Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }
  up(out = new Vector3()): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }
  right(out = new Vector3()): Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }

  lookAt(dir: Vector3, upHint?: Vector3): void {
    const up = upHint ?? this.up(new Vector3());
    const m = new Matrix4().lookAt(new Vector3(0, 0, 0), dir, up);
    this.quat.setFromRotationMatrix(m);
    if (this.aim) this.quat.multiply(this.q.setFromAxisAngle(AXIS_X, -this.aim));
  }

  /**
   * Begin the autopilot towards `target`, stopping at `finalDistance` from its centre.
   *
   * The distance follows a curve in log space: the stretch where the target is still a dot
   * (farther than ~300 radii) is crossed quickly, and the time goes into the approach where
   * it visibly grows, easing to a stop. Monotone cubic Hermite, so there is no overshoot and
   * no change of pace between the two stretches.
   *
   * `arriveDir` (unit, from the target): swing round to arrive from that side, during the
   * visible approach, keeping the target in view.
   */
  flyTo(target: SpaceObject, finalDistance: number, duration?: number, rotate = true, arriveDir?: Vector3): void {
    const rel = this.upos.sub(target.upos, new Vector3());
    const d0 = Math.max(rel.length(), 1e-3);
    const d1 = Math.max(finalDistance, 1);
    const dir = rel.clone().divideScalar(d0);
    if (!Number.isFinite(dir.x)) dir.set(0, 0, 1);
    const L0 = Math.log(d0), L1 = Math.log(d1);
    let knots: Knot[];
    if (duration !== undefined) {
      knots = [{ t: 0, L: L0, m: 0 }, { t: Math.max(duration, 1e-3), L: L1, m: 0 }];
    } else {
      const Lv = Math.max(L1, Math.log(Math.max(target.radius, 1) * 300));
      if (L0 > Lv + 0.7) {
        const TA = clamp(1.0 + 0.15 * (L0 - Lv), 1.7, 3.6);
        // giants: a slower, heavier final approach (approachWeight: Jupiter ~1.75x, Sun 2x)
        const TB = clamp(1.4 + 0.5 * Math.abs(Lv - L1), 2.4, 4.6) * approachWeight(target.radius);
        const sA = (Lv - L0) / TA, sB = (L1 - Lv) / TB;
        const mJ = sA * sB > 0 ? (2 * sA * sB) / (sA + sB) : 0;
        knots = [{ t: 0, L: L0, m: 0 }, { t: TA, L: Lv, m: mJ }, { t: TA + TB, L: L1, m: 0 }];
      } else {
        knots = [{ t: 0, L: L0, m: 0 }, { t: clamp(1.8 + 0.5 * Math.abs(L0 - L1), 2.2, 4.6) * (L1 < L0 ? approachWeight(target.radius) : 1), L: L1, m: 0 }];
      }
    }
    const T = knots[knots.length - 1].t;
    const up = this.up(new Vector3());
    const swing = arriveDir && arriveDir.angleTo(dir) > 1e-4 ? new Quaternion().setFromUnitVectors(dir, arriveDir.clone().normalize()) : null;
    const Ls = Math.min(L0, Math.log(Math.max(target.radius, 1) * 300) + 2);
    this.target = target;
    this.goto = {
      target, dir, knots, t: 0, T, fastUntil: knots.length > 2 ? knots[1].t : 0, q0: this.quat.clone(), rotate, up,
      swing, swingFrom: Ls, swingTo: L1,
    };
    this.setAnchor(target);
  }

  /**
   * External inputs for the current frame (VR controllers). `move` is a world-space
   * direction with length 0..1; orbit/zoom are in "drag pixels" / "wheel ticks" per second.
   * Cleared after every update.
   */
  readonly ext = { move: new Vector3(), boost: 1, orbitX: 0, orbitY: 0, zoom: 0, throttle: -1, rot: new Vector3() };

  private clearExt(): void {
    this.ext.move.set(0, 0, 0);
    this.ext.boost = 1;
    this.ext.orbitX = this.ext.orbitY = this.ext.zoom = 0;
    this.ext.throttle = -1;
    this.ext.rot.set(0, 0, 0);
  }

  /** Physics flight drives the camera itself (src/game/Flight.ts): it only clears the controller inputs. */
  updateExternal(): void {
    this.clearExt();
  }

  /**
   * Turn the camera, its place and its view together, about a point (a world's centre) by `turn`:
   * what a world's spin does to an explorer standing on it.
   */
  carry(centre: UPos, turn: Quaternion): void {
    this.rotateAbout(this.upos.sub(centre, this.tmp), turn);
  }

  /** Rotate the view about its own vertical axis (VR snap turn). */
  turn(angleRad: number): void {
    this.quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angleRad));
  }

  /**
   * Zoom on the target over a moment (a double tap on it): the height changes by the factor e^`log`
   * (negative: closer), and what is at `at` in the view stays there.
   */
  zoomToward(at: Point, log: number, seconds = 0.45): void {
    if (this.target && !this.goto) this.gliding = { log, at: { x: at.x, y: at.y }, left: seconds };
  }

  /** Stop the autopilot where it is: between two places, with nothing to orbit. */
  cancelGoto(): void {
    if (!this.goto) return;
    this.goto = null;
    this.target = null;
  }

  /** Autopilot progress 0..1 (1 when idle). */
  get gotoProgress(): number {
    return this.goto ? this.goto.t / this.goto.T : 1;
  }

  /** true while the autopilot crosses the far stretch where the target is still a dot */
  get gotoCruising(): boolean {
    return !!this.goto && this.goto.t < this.goto.fastUntil;
  }

  update(dt: number, input: Input): void {
    this.rising = Math.max(0, this.rising - dt);
    this.step(dt, input);
    this.clearExt();
  }

  private step(dt: number, input: Input): void {
    const f = input.consume();
    const k = input.keys;
    const flying = this.goto !== null;
    const px = this.pixelAngle;

    // Looking around: the view turns the way the mouse moves; under fingers the sky goes where
    // they go. One finger looks when there is nothing to orbit, during a flight, or when set to.
    const mouseRate = (this.fov / 50) * 0.0025;
    const fingerLooks = !this.target || flying || this.touchDrag === 'look';
    const sx = f.pan.dx + (fingerLooks ? f.touch.dx : 0), sy = f.pan.dy + (fingerLooks ? f.touch.dy : 0);
    const yaw = sx * px - f.look.dx * mouseRate, pitch = sy * px - f.look.dy * mouseRate;
    if (yaw || pitch) {
      this.lookBy(yaw, pitch);
      if (this.goto) this.goto.rotate = false;
    }
    // Roll: Q/E, or a twist of two fingers (the view turns with them)
    const roll = ((k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0)) * dt * 1.2 + f.twist;
    if (roll) this.quat.multiply(this.q.setFromAxisAngle(AXIS_Z, roll));

    // Orbit: a pointer takes hold of the target; a controller turns about it at a steady rate
    if (this.target && !flying) {
      if (f.orbit.dx || f.orbit.dy) this.orbitBy(f.orbit);
      if (!fingerLooks && (f.touch.dx || f.touch.dy)) this.orbitBy(f.touch);
      if (this.ext.orbitX || this.ext.orbitY) this.turnAbout(-this.ext.orbitX * 400 * dt * ORBIT_RATE, -this.ext.orbitY * 400 * dt * ORBIT_RATE);
    }

    // Zoom: the wheel, a pinch or a controller change the height above the target by a factor.
    // With nothing to zoom on, the wheel sets the flying speed and a pinch moves along the view.
    const ticks = f.wheel + this.ext.zoom * 6 * dt;
    if (this.target && !flying) {
      const log = ticks * WHEEL_STEP + f.pinch;
      const g = this.gliding;
      if (log) {
        // (the hand takes over from a zoom under way)
        this.gliding = null;
        this.zoomBy(log, f.pinch ? f.pinchAt : f.wheel ? f.wheelAt : null);
      } else if (g) {
        // the same share of what is left each moment: an even pace in log height
        const part = Math.min(1, dt / g.left);
        this.zoomBy(g.log * part, g.at);
        g.log -= g.log * part;
        g.left -= dt;
        if (g.left <= 1e-6) this.gliding = null;
      }
    } else {
      this.gliding = null;
      if (ticks) this.speedFactor = clamp(this.speedFactor * Math.pow(1.5, -ticks), 1e-4, 1e6);
      if (f.pinch && !flying) this.upos.addVec(this.forward(this.rayA), clamp(1 - Math.exp(f.pinch), -4, 0.9) * this.altitude);
    }

    // Autopilot
    if (this.goto) {
      const g = this.goto;
      g.t = Math.min(g.T, g.t + dt);
      const s = g.t / g.T;
      const L = hermite(g.knots, g.t);
      const dir = g.dir.clone();
      if (g.swing) {
        // inward or outward: progress from swingFrom to swingTo in log distance
        const span = g.swingTo - g.swingFrom;
        const w = Math.abs(span) < 1e-6 ? 1 : smooth((L - g.swingFrom) / span);
        dir.applyQuaternion(new Quaternion().slerp(g.swing, w));
      }
      const want = g.target.upos.clone().addVec(dir, Math.exp(L));
      this.upos.copy(want);
      if (g.rotate) {
        const look = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), dir.negate(), g.up));
        if (this.aim) look.multiply(this.q.setFromAxisAngle(AXIS_X, -this.aim));
        this.quat.copy(g.q0).slerp(look, Math.min(1, smooth(s / 0.35)));
      }
      this.speed = 0;
      if (g.t >= g.T) this.goto = null;
      return;
    }

    // Translation (WASD + R/F), speed proportional to altitude
    const move = this.tmp2.set(
      (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      (k.has('KeyR') ? 1 : 0) - (k.has('KeyF') ? 1 : 0),
      (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0),
    );
    let mult = this.speedFactor;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) mult *= 10;
    if (k.has('ControlLeft') || k.has('ControlRight')) mult *= 0.1;
    const base = Math.max(this.altitude, 1) * 0.8 * mult;
    let wantVel = move.lengthSq() > 0 ? move.normalize().applyQuaternion(this.quat).multiplyScalar(base) : new Vector3();
    if (this.ext.move.lengthSq() > 1e-6) wantVel = this.ext.move.clone().multiplyScalar(base * this.ext.boost);
    const fwd = this.forward(new Vector3());
    this.thrust = wantVel.lengthSq() > 0 ? wantVel.dot(fwd) / wantVel.length() : 0;
    if (this.inertia > 0) {
      // ship: momentum carries on; flight assist (or the brake) bleeds it off
      if (wantVel.lengthSq() > 0) this.velocity.lerp(wantVel, 1 - Math.exp(-dt / this.inertia));
      else this.velocity.multiplyScalar(Math.exp(-dt / (this.braking ? 0.25 : 6)));
      if (this.braking && wantVel.lengthSq() > 0) this.velocity.multiplyScalar(Math.exp(-dt / 0.25));
      // never faster than the local speed scale allows (it shrinks near surfaces)
      const vmax = Math.max(this.altitude, 1) * 0.8 * this.speedFactor * 12;
      if (this.velocity.length() > vmax) this.velocity.setLength(vmax);
      if (this.velocity.length() < base * 1e-4) this.velocity.set(0, 0, 0);
    } else {
      // Smooth acceleration
      const a = 1 - Math.exp(-dt * 6);
      this.velocity.lerp(wantVel, a);
      if (move.lengthSq() === 0 && this.velocity.length() < base * 1e-3) this.velocity.set(0, 0, 0);
    }
    // Never fly through a surface: limit the step to 90 % of the altitude
    let step = this.velocity.length() * dt;
    if (step > this.altitude * 0.9 && this.altitude > 0) step = this.altitude * 0.9;
    if (step > 0) this.upos.addVec(this.velocity.clone().normalize(), step);
    this.speed = dt > 0 ? step / dt : 0;
  }

  /**
   * Turn the view in place: `yaw` to the left, `pitch` up (rad). Near a world the turn is about its
   * vertical, so the horizon stays level, and the view stops short of straight up and straight down.
   */
  private lookBy(yaw: number, pitch: number): void {
    const w = this.verticalWeight;
    const up = this.up(this.tmp2);
    if (w > 0) up.lerp(this.vertical, w).normalize();
    if (w > 0.5) {
      const el = Math.asin(clamp(this.forward(this.rayA).dot(this.vertical), -1, 1));
      pitch = pitch > 0 ? Math.max(0, Math.min(pitch, LOOK_LIMIT - el)) : Math.min(0, Math.max(pitch, -LOOK_LIMIT - el));
    }
    this.quat.premultiply(this.q.setFromAxisAngle(up, yaw));
    this.quat.multiply(this.q.setFromAxisAngle(AXIS_X, pitch));
  }

  /**
   * A pointer's drag carries the camera round its target. Where the drag is on the target's surface,
   * the point that was under the pointer goes where the pointer went (the globe turns under the
   * hand, the ground slides under it close up). Off the surface, or with nothing solid to hold, the
   * camera turns at a steady rate, never faster than the ground straight below would follow.
   */
  private orbitBy(d: Drag): void {
    const rel = this.upos.sub(this.target!.upos, this.tmp);
    const dist = rel.length();
    const s = this.surface;
    const solid = s > 0 && dist > s;
    const below = solid ? (this.pixelAngle * (dist - s)) / s : Infinity;
    if (solid) {
      const from = hitSphere(rel, this.ray(d.x - d.dx, d.y - d.dy, this.rayA), s, this.hitA);
      const to = from && hitSphere(rel, this.ray(d.x, d.y, this.rayB), s, this.hitB);
      if (from && to) {
        const q = this.q.setFromUnitVectors(to.normalize(), from.normalize());
        // towards the edge of the disc and the horizon a pixel spans ever more ground: it never
        // carries the camera more than 30 times as far as straight below, or twice the steady rate
        const angle = 2 * Math.asin(Math.min(1, Math.hypot(q.x, q.y, q.z)));
        const most = Math.hypot(d.dx, d.dy) * Math.min(2 * ORBIT_RATE, 30 * below);
        if (angle > most) q.slerp(IDENTITY, 1 - most / angle);
        this.rotateAbout(rel, q);
        return;
      }
    }
    const rate = Math.min(ORBIT_RATE, below);
    this.turnAbout(-d.dx * rate, -d.dy * rate);
  }

  /** Turn the camera about its target: `yaw` about the view's up, `pitch` about its right (rad). */
  private turnAbout(yaw: number, pitch: number): void {
    const rel = this.upos.sub(this.target!.upos, this.tmp);
    const q = new Quaternion().setFromAxisAngle(this.up(this.rayA), yaw).multiply(this.q.setFromAxisAngle(this.right(this.rayB), pitch));
    this.rotateAbout(rel, q);
  }

  /** Rotate the camera, its place and its view together, about the target it is `rel` from. */
  private rotateAbout(rel: Vector3, q: Quaternion): void {
    this.upos.addVec(this.tmp2.copy(rel).applyQuaternion(q).sub(rel));
    this.quat.premultiply(q);
  }

  /**
   * Change the height above the target's surface by the factor e^`log` (negative: closer), down to
   * `closest`. What is under the pointer at `at` stays under it: the globe turns as it grows.
   */
  private zoomBy(log: number, at: Point | null): void {
    const rel = this.upos.sub(this.target!.upos, this.tmp);
    const dist = rel.length();
    if (!(dist > 0)) return;
    const s = Math.min(this.surface, dist);
    const h = Math.max(dist - s, 1e-3);
    // (a camera already closer than zooming goes is not pushed back out by it)
    const lowest = Math.min(h, Math.max(this.closest - s, 1e-3));
    const nh = clamp(h * Math.exp(log), lowest, Math.max(h, FARTHEST - s));
    if (nh > h) this.rising = 1.5;
    const held = at && s > 0 && dist > s ? hitSphere(rel, this.ray(at.x, at.y, this.rayA), s, this.hitA) : null;
    this.upos.addVec(rel, (nh - h) / dist);
    if (!held) return;
    rel.multiplyScalar(1 + (nh - h) / dist);
    const now = hitSphere(rel, this.rayA, s, this.hitB);
    if (!now) return;
    const q = this.q.setFromUnitVectors(now.normalize(), held.normalize());
    if (Math.hypot(q.x, q.y, q.z) < 0.25) this.rotateAbout(rel, q);
  }
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const IDENTITY = new Quaternion();
/** looking round near the ground stops this far (rad) above and below the horizon */
const LOOK_LIMIT = 1.55;

/**
 * Where the ray from `from` along `dir` (unit) first meets the sphere of radius `r` about the
 * origin; null when it misses the sphere or starts inside it.
 */
function hitSphere(from: Vector3, dir: Vector3, r: number, out: Vector3): Vector3 | null {
  const b = from.dot(dir);
  if (b >= 0) return null;
  const d = from.length();
  const disc = b * b - (d - r) * (d + r);
  if (d <= r || disc < 0) return null;
  return out.copy(from).addScaledVector(dir, -b - Math.sqrt(disc));
}

interface Knot { t: number; L: number; m: number }

interface GotoState {
  target: SpaceObject;
  dir: Vector3;
  knots: Knot[];
  t: number;
  T: number;
  fastUntil: number;
  q0: Quaternion;
  /** turn to face the target (off once the user looks around) */
  rotate: boolean;
  up: Vector3;
  /** rotation from `dir` to the arrival direction, applied between log-distances swingFrom -> swingTo */
  swing: Quaternion | null;
  swingFrom: number;
  swingTo: number;
}

/** Piecewise cubic Hermite through `knots` (value L, slope m). */
function hermite(k: Knot[], t: number): number {
  let i = 0;
  while (i < k.length - 2 && t > k[i + 1].t) i++;
  const a = k[i], b = k[i + 1];
  const h = b.t - a.t;
  const s = clamp((t - a.t) / h, 0, 1);
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * a.L + (s3 - 2 * s2 + s) * h * a.m + (-2 * s3 + 3 * s2) * b.L + (s3 - s2) * h * b.m;
}

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
