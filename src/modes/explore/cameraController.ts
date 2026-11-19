/**
 * The explorer's camera.
 *
 * State is a high-precision universe position plus an orientation quaternion.
 * Three behaviours share it:
 *   free flight — drag to look, throttle / pinch to move; speed scales with the
 *                 distance to the nearest object so one control works from a
 *                 planet's surface to intergalactic space
 *   orbit       — after flying to something, drag circles around it
 *   autopilot   — cinematic "fly to": the remaining distance shrinks
 *                 geometrically, so a trip across the universe and a hop to a
 *                 moon feel the same
 * The world tells the controller what is nearby through `Surroundings`.
 */
import * as THREE from 'three';
import { type UPos, uposAddInPlace, uposClone, uposCopy, uposSub } from '../../core/hp';
import { C } from '../../core/units';

/** What the camera needs to know about the world each frame. */
export interface Surroundings {
  /** Distance to the nearest surface / object edge, metres (always > 0). */
  nearest: number;
  /** Unit "up" direction of the nearest body when close to its surface (for horizon levelling), else null. */
  up: THREE.Vector3 | null;
  /** 0…1: how strongly the horizon should be levelled (1 when skimming a surface). */
  levelling: number;
  /**
   * Keep the camera outside solid bodies: adjusts `pos` if it is below the minimum
   * altitude and returns true if it had to.
   */
  collide(pos: UPos): boolean;
}

/** Something the camera can orbit or fly to. Position may move (planets). */
export interface CameraTarget {
  name: string;
  radius: number;
  /** Write the target's current centre into `out`. */
  position(out: UPos): UPos;
}

export interface FlightPlan {
  target: CameraTarget;
  /** Distance from the target's centre to stop at. */
  arriveDistance: number;
  /** Orbit the target on arrival. */
  focusOnArrival: boolean;
  onArrive?: () => void;
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3();
const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

export class CameraController {
  readonly pos: UPos;
  readonly quat = new THREE.Quaternion();
  /** Throttle −1…1 (set by the on-screen slider or keys). */
  throttle = 0;
  /** Current speed in m/s (for the HUD and the warp effect). */
  speed = 0;
  /** 0…1 strength of the boost/warp visual. */
  warp = 0;
  /** Extra shake amplitude 0…1 (black-hole proximity). */
  shake = 0;
  focus: CameraTarget | null = null;

  private flight: (FlightPlan & { t: number; duration: number; start: UPos; startQuat: THREE.Quaternion; startDist: number; side: THREE.Vector3; bump: number }) | null = null;
  private focusDistance = 1;
  private pendingZoom = 1;
  private readonly velocity = new THREE.Vector3();
  private readonly lookVel = new THREE.Vector2();
  private rollVel = 0;
  private readonly targetPos: UPos;
  private readonly scratch: UPos;
  private shakeTime = 0;
  private readonly shakeQuat = new THREE.Quaternion();

  constructor(start: UPos) {
    this.pos = uposClone(start);
    this.targetPos = uposClone(start);
    this.scratch = uposClone(start);
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  get flightProgress(): number {
    return this.flight ? this.flight.t / this.flight.duration : 0;
  }

  get destination(): CameraTarget | null {
    return this.flight?.target ?? null;
  }

  /** Orientation including transient shake — what the renderer should use. */
  renderQuat(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.quat).multiply(this.shakeQuat);
  }

  /** Jump instantly (restoring a link, start-up). */
  teleport(pos: UPos, quat?: THREE.Quaternion): void {
    uposCopy(this.pos, pos);
    if (quat) this.quat.copy(quat).normalize();
    this.velocity.set(0, 0, 0);
    this.flight = null;
    this.focus = null;
    this.throttle = 0;
  }

  /** Rotate the view by a drag of (dx, dy) radians. */
  look(dx: number, dy: number): void {
    if (this.flight) return;
    this.lookVel.x += dx;
    this.lookVel.y += dy;
  }

  roll(angle: number): void {
    if (!this.flight) this.rollVel += angle;
  }

  /** Pinch / wheel: factor > 1 moves toward what is ahead, < 1 away. */
  zoom(factor: number): void {
    if (!this.flight) this.pendingZoom *= factor;
  }

  /** Stop orbiting and stay where we are. */
  releaseFocus(): void {
    this.focus = null;
  }

  /** Start orbiting a target from the current position. */
  setFocus(target: CameraTarget): void {
    this.focus = target;
    target.position(this.targetPos);
    const d = uposSub(this.pos, this.targetPos);
    this.focusDistance = Math.max(target.radius * 1.0005, Math.hypot(d.x, d.y, d.z));
    this.velocity.set(0, 0, 0);
  }

  cancelFlight(): void {
    this.flight = null;
  }

  /** Begin a cinematic flight. */
  flyTo(plan: FlightPlan): void {
    plan.target.position(this.targetPos);
    const d = uposSub(this.pos, this.targetPos);
    const startDist = Math.max(1, Math.hypot(d.x, d.y, d.z));
    const arrive = Math.max(plan.arriveDistance, plan.target.radius * 1.02);
    // Duration grows with the number of powers of ten crossed.
    const decades = Math.abs(Math.log10(startDist / arrive));
    const duration = Math.min(9, 2.2 + 0.42 * decades);
    // A sideways arc keeps the path from clipping through whatever we are leaving.
    const side = tmpV.set(d.x, d.y, d.z).normalize().cross(tmpV2.set(0.31, 0.87, 0.38)).normalize().clone();
    this.flight = { ...plan, arriveDistance: arrive, t: 0, duration, start: uposClone(this.pos), startQuat: this.quat.clone(), startDist, side, bump: 0 };
    this.focus = null;
    this.throttle = 0;
    this.velocity.set(0, 0, 0);
  }

  /** Give the outbound leg a sideways bump of `metres` (used when the direct line would cross a planet). */
  setFlightBump(metres: number): void {
    if (this.flight) this.flight.bump = metres;
  }

  update(dt: number, env: Surroundings, heldKeys: ReadonlySet<string>): void {
    const before = uposCopy(this.scratch, this.pos);
    if (this.flight) this.updateFlight(dt);
    else if (this.focus) this.updateOrbit(dt, env);
    else this.updateFree(dt, env, heldKeys);

    if (!this.flight && env.collide(this.pos)) this.velocity.multiplyScalar(0.5);
    const moved = uposSub(this.pos, before);
    const inst = Math.hypot(moved.x, moved.y, moved.z) / Math.max(dt, 1e-4);
    this.speed += (inst - this.speed) * Math.min(1, dt * 8);
    // Warp visual: speed relative to the local scale (how many "nearest-distances" per second).
    const rel = this.speed / Math.max(env.nearest, 1);
    const wantWarp = this.flight ? Math.min(1, rel * 0.35) * Math.sin(Math.PI * Math.min(1, this.flightProgress)) ** 0.6 : Math.min(1, Math.max(0, rel - 6) / 40) * (this.speed > C ? 1 : 0.3);
    this.warp += (wantWarp - this.warp) * Math.min(1, dt * 4);

    // Shake: low-frequency wobble + high-frequency jitter, both scaled by `shake`.
    this.shakeTime += dt;
    if (this.shake > 0.001) {
      const t = this.shakeTime;
      const a = this.shake * 0.012;
      tmpV.set(Math.sin(t * 31.7) + 0.5 * Math.sin(t * 71.3), Math.sin(t * 27.1 + 1.3) + 0.5 * Math.sin(t * 83.9), Math.sin(t * 19.3 + 2.1)).multiplyScalar(a);
      this.shakeQuat.set(tmpV.x, tmpV.y, tmpV.z, 1).normalize();
    } else this.shakeQuat.identity();
  }

  private updateFree(dt: number, env: Surroundings, held: ReadonlySet<string>): void {
    this.applyLook(dt, env);
    // Keyboard: W/S or arrows = throttle, A/D strafe, R/F up/down, Q/E roll, Shift boost.
    let strafe = 0;
    let lift = 0;
    let fwd = this.throttle;
    if (held.has('keyw') || held.has('arrowup')) fwd = Math.max(fwd, 0.45);
    if (held.has('keys') || held.has('arrowdown')) fwd = Math.min(fwd, -0.45);
    if (held.has('keyd')) strafe += 0.35;
    if (held.has('keya')) strafe -= 0.35;
    if (held.has('keyr')) lift += 0.35;
    if (held.has('keyf')) lift -= 0.35;
    if (held.has('keyq')) this.rollVel += dt * 1.5;
    if (held.has('keye')) this.rollVel -= dt * 1.5;
    if (held.has('shiftleft') || held.has('shiftright')) fwd = Math.sign(fwd) * Math.min(1, Math.abs(fwd) * 2);

    // Speed law: v = f(throttle) · d, with d the distance to the nearest thing. f spans 0.05 … 300 per second.
    const gain = (t: number): number => (Math.abs(t) < 0.02 ? 0 : Math.sign(t) * 0.05 * Math.pow(6000, Math.abs(t)));
    const d = env.nearest;
    tmpV.set(gain(strafe) * d, gain(lift) * d, -gain(fwd) * d).applyQuaternion(this.quat);
    // Pinch zoom: move along the view direction by a fraction of the nearest distance.
    if (this.pendingZoom !== 1) {
      const step = (1 - 1 / this.pendingZoom) * d * 0.85;
      tmpV2.set(0, 0, -1).applyQuaternion(this.quat).multiplyScalar(step);
      uposAddInPlace(this.pos, tmpV2.x, tmpV2.y, tmpV2.z);
      this.pendingZoom = 1;
    }
    // Smooth acceleration; never cover more than half the distance to the nearest surface in one frame.
    this.velocity.lerp(tmpV, Math.min(1, dt * 3.5));
    const maxStep = d * 0.5;
    tmpV.copy(this.velocity).multiplyScalar(dt);
    if (tmpV.length() > maxStep) tmpV.setLength(maxStep);
    uposAddInPlace(this.pos, tmpV.x, tmpV.y, tmpV.z);
  }

  private applyLook(dt: number, env: Surroundings): void {
    // Damped look: most of the drag is applied immediately, a little glides.
    const k = Math.min(1, dt * 18);
    const yaw = -this.lookVel.x * k;
    const pitch = -this.lookVel.y * k;
    this.lookVel.multiplyScalar(1 - k);
    const roll = this.rollVel * k;
    this.rollVel *= 1 - k;
    if (env.up && env.levelling > 0.01) {
      // Near a surface: yaw around the local vertical so the horizon stays put.
      tmpQ.setFromAxisAngle(env.up, yaw);
      this.quat.premultiply(tmpQ);
    } else {
      tmpQ.setFromAxisAngle(Y, yaw);
      this.quat.multiply(tmpQ);
    }
    tmpQ.setFromAxisAngle(X, pitch);
    this.quat.multiply(tmpQ);
    tmpQ.setFromAxisAngle(Z, roll);
    this.quat.multiply(tmpQ);
    if (env.up && env.levelling > 0.01) {
      // Gently roll the camera so its right vector lies in the horizon plane.
      const right = tmpV.set(1, 0, 0).applyQuaternion(this.quat);
      const fwd = tmpV2.set(0, 0, -1).applyQuaternion(this.quat);
      const tilt = right.dot(env.up);
      // Skip when looking straight up/down, where "level" is undefined.
      if (Math.abs(fwd.dot(env.up)) < 0.97) {
        tmpQ.setFromAxisAngle(fwd, -Math.asin(Math.max(-1, Math.min(1, tilt))) * Math.min(1, dt * 4 * env.levelling));
        this.quat.premultiply(tmpQ);
      }
    }
    this.quat.normalize();
  }

  private updateOrbit(dt: number, env: Surroundings): void {
    const target = this.focus!;
    target.position(this.targetPos);
    const k = Math.min(1, dt * 18);
    const yaw = -this.lookVel.x * k;
    const pitch = -this.lookVel.y * k;
    this.lookVel.multiplyScalar(1 - k);
    const roll = this.rollVel * k;
    this.rollVel *= 1 - k;
    // Orbit: rotate the camera frame about its own up/right axes, then sit at −forward · distance.
    tmpQ.setFromAxisAngle(Y, yaw * 1.6);
    this.quat.multiply(tmpQ);
    tmpQ.setFromAxisAngle(X, pitch * 1.6);
    this.quat.multiply(tmpQ);
    tmpQ.setFromAxisAngle(Z, roll);
    this.quat.multiply(tmpQ);
    this.quat.normalize();

    // Zoom acts on altitude so it stays controllable all the way down.
    const alt = Math.max(this.focusDistance - target.radius, target.radius * 2e-7 + 0.5);
    let newAlt = alt / this.pendingZoom;
    this.pendingZoom = 1;
    if (Math.abs(this.throttle) > 0.02) newAlt *= Math.exp(-Math.sign(this.throttle) * Math.pow(Math.abs(this.throttle), 1.5) * 2.2 * dt);
    this.focusDistance = target.radius + Math.max(newAlt, 0.5);
    void env;

    const back = tmpV.set(0, 0, 1).applyQuaternion(this.quat).multiplyScalar(this.focusDistance);
    uposCopy(this.pos, this.targetPos);
    uposAddInPlace(this.pos, back.x, back.y, back.z);
  }

  private updateFlight(dt: number): void {
    const f = this.flight!;
    f.t = Math.min(f.duration, f.t + dt);
    const u = f.t / f.duration;
    const s = smoother(u);
    f.target.position(this.targetPos);

    // Direction from the target back toward where we started (kept fixed so the approach is a straight line).
    const d0 = uposSub(f.start, this.targetPos);
    const len0 = Math.max(1, Math.hypot(d0.x, d0.y, d0.z));
    // Remaining distance shrinks geometrically from startDist to arriveDistance.
    const remaining = f.startDist * Math.pow(f.arriveDistance / f.startDist, s);
    const scale = remaining / len0;
    uposCopy(this.pos, this.targetPos);
    uposAddInPlace(this.pos, d0.x * scale, d0.y * scale, d0.z * scale);
    if (f.bump > 0) {
      const b = f.bump * Math.sin(Math.PI * Math.min(1, u * 2.5)) * (1 - s);
      uposAddInPlace(this.pos, f.side.x * b, f.side.y * b, f.side.z * b);
    }

    // Turn to face the target early in the flight, then keep tracking it.
    const toTarget = uposSub(this.targetPos, this.pos);
    tmpV.set(toTarget.x, toTarget.y, toTarget.z).normalize();
    const up = tmpV2.set(0, 1, 0).applyQuaternion(f.startQuat);
    if (Math.abs(up.dot(tmpV)) > 0.98) up.set(1, 0, 0).applyQuaternion(f.startQuat);
    tmpM.lookAt(ORIGIN, tmpV, up);
    tmpQ2.setFromRotationMatrix(tmpM);
    this.quat.copy(f.startQuat).slerp(tmpQ2, smoother(Math.min(1, u * 3.2)));

    if (f.t >= f.duration) {
      const plan = f;
      this.flight = null;
      this.velocity.set(0, 0, 0);
      if (plan.focusOnArrival) this.setFocus(plan.target);
      plan.onArrive?.();
    }
  }
}
