import { Matrix4, Quaternion, Vector3 } from 'three';
import { UPos } from '../core/upos';
import { addPointAccel, C, type GravityField, type GravitySource, potential, tidalGradient } from './Gravity';
import { propagateKepler } from './Kepler';
import { boostProper, driveFlow, driveTime, lorentz, properVelocityOf, velocityOf } from './Relativity';

export const G0 = 9.80665;

/** The ship: a 40 t fusion-torch runabout (fictional engine, honest mechanics). */
export interface ShipSpec {
  dryMass: number;      // kg
  fuelMax: number;      // kg of propellant
  thrust: number;       // N, main engine
  isp: number;          // s
  rcsThrust: number;    // N per axis
  wheelAccel: number;   // rad/s^2 from the reaction wheels
  maxRate: number;      // rad/s the wheels can hold
  length: number;       // m (tidal stretch is taken across it)
  cdA: number;          // m^2, drag coefficient x reference area
  noseRadius: number;   // m (re-entry heating)
  /** touch down slower than this (m/s, relative to the ground) or it is a crash */
  crashSpeed: number;
  /** tidal acceleration across the ship (m/s^2) that tears it apart (100 g) */
  tidalLimit: number;
  /** hull temperature (K) at which it burns up */
  maxHullTemp: number;
  /**
   * Lorentz factor (against the frame body) beyond which the reactionless drive pushes no faster.
   * Invented, like the drive, but for a real reason: at γ = 10¹² every atom of interstellar gas
   * strikes the hull at 10²¹ eV, past the most energetic cosmic ray ever recorded (3·10²⁰ eV).
   */
  gammaMax: number;
}

export const SHIP_SPEC: ShipSpec = {
  dryMass: 18_000, fuelMax: 22_000, thrust: 520e3, isp: 3200, rcsThrust: 6_000, wheelAccel: 0.9, maxRate: 1.0,
  length: 22, cdA: 9, noseRadius: 1.6, crashSpeed: 12, tidalLimit: 100 * G0, maxHullTemp: 2900, gammaMax: 1e12,
};

/** Exponential atmosphere of the frame body. */
export interface Atmosphere {
  /** density at the reference radius (kg/m^3) */
  rho0: number;
  /** scale height (m) */
  H: number;
  /** reference radius (m) */
  R0: number;
  /** height of the top (m above R0), where drag is ignored */
  top: number;
}

/**
 * The ship's two engines. The torch: the realistic fusion torch above, real thrust and propellant.
 * The reactionless drive: the ship's top engine, an invention ("the peak of human innovation"):
 * the pilot sets its proper acceleration over many orders of magnitude, it needs no propellant
 * (no real engine can do without: momentum would not be conserved), and its field pushes every
 * particle aboard alike, so the crew feels none of it (invented too). Its motion is real special
 * relativity: constant proper acceleration, any speed below light, never light's.
 */
export type Drive = 'torch' | 'reactionless';

export type FlightEventKind = 'crash' | 'land' | 'horizon' | 'spaghetti' | 'burnup';
export interface FlightEvent { kind: FlightEventKind; speed: number; src: GravitySource | null }

/** The ship's state and controls. */
export class ShipState {
  readonly upos = new UPos();
  /**
   * velocity (m/s, world axes, barycentric). Read it freely; writing it sets the ship's motion
   * (the proper velocity follows). At high Lorentz factors it rounds to c: the motion itself is
   * the proper velocity.
   */
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  /** angular velocity (rad/s, world axes) */
  readonly angVel = new Vector3();
  fuel = SHIP_SPEC.fuelMax;
  /** main engine 0..1 */
  throttle = 0;
  /** RCS translation command, ship axes (x right, y up, z aft), each -1..1 */
  readonly rcs = new Vector3();
  drive: Drive = 'torch';
  /** the reactionless drive's proper acceleration at full throttle (m/s²), set by the pilot */
  driveAccel = G0;
  // ---- outputs
  /** what the crew feels (torch, RCS, drag, ground; not the reactionless drive), world axes */
  readonly properAccel = new Vector3();
  gForce = 0;
  /** tidal acceleration across the ship's length (m/s^2) */
  tidal = 0;
  /** air density (kg/m^3) and stagnation heat flux (W/m^2) */
  rho = 0;
  heatFlux = 0;
  hullTemp = 290;
  /** dτ/dt: ship clock rate against the universe (coordinate) clock */
  dilation = 1;
  /** the part of `dilation` that is gravity's (1 far from everything) */
  gravityRate = 1;
  /** proper time elapsed on board (s) */
  shipTime = 0;
  private readonly u = new Vector3();
  /** the velocity `u` was last turned into: when `vel` differs, it was written from outside */
  private readonly velOfU = new Vector3(NaN, NaN, NaN);

  get mass(): number {
    return SHIP_SPEC.dryMass + this.fuel;
  }

  /** proper velocity γv (m/s, world axes, barycentric): the motion as integrated, exact at any γ (read only: set it with setProperVelocity) */
  properVelocity(): Vector3 {
    if (!this.vel.equals(this.velOfU)) {
      properVelocityOf(this.vel, this.u);
      this.velOfU.copy(this.vel);
    }
    return this.u;
  }

  setProperVelocity(w: Vector3): void {
    this.u.copy(w);
    velocityOf(w, this.vel);
    this.velOfU.copy(this.vel);
  }

  /** Lorentz factor against the universe's (barycentric) frame */
  get gamma(): number {
    return lorentz(this.properVelocity());
  }
}

const MAX_SOURCES = 32;
const W1 = 1 / (2 - Math.cbrt(2));
const W0 = -Math.cbrt(2) / (2 - Math.cbrt(2));
/** Yoshida (1990) fourth-order symplectic drift/kick coefficients */
const YC = [W1 / 2, (W0 + W1) / 2, (W0 + W1) / 2, W1 / 2];
const YD = [W1, W0, W1];
const SIGMA = 5.670374419e-8;

/**
 * Translation of the ship through the live gravity field, integrated in the frame of the dominant
 * body (positions relative to it stay small, so doubles are exact to millimetres) with adaptive
 * substeps of a 4th-order symplectic integrator. The other sources move linearly across a frame,
 * and pull on the frame body too (their difference is the tidal perturbation).
 *
 * Special relativity throughout. The state is the proper velocity w = γv (Relativity.ts). Gravity
 * is Newton's potential (Paczyński–Wiita near black holes) in special relativity: the energy
 * γc² + Φ and the angular momentum r × w are conserved (the special-relativistic Kepler problem,
 * Sommerfeld's), so the kick is gravity's pull on w, dw/dt = g, and the drift moves at w/γ: a
 * separable Hamiltonian, which the Yoshida steps integrate symplectically as before. The engines
 * are folded into the drift and solved exactly there (Relativity.driveFlow: constant proper
 * acceleration, exact at any Lorentz factor), and the proper time aboard is summed from the
 * drifts. Slow, all of it is the old Newtonian integrator to v²/c². The frame body's frame counts
 * as inertial for the ship (bodies move at 10⁻⁴ c at most); the ship's velocity in the universe is
 * composed with the body's by a Lorentz boost, so no sum of speeds reaches c.
 * What this leaves out: general relativity proper. Fast paths bend less than Einstein's (light,
 * not at all); with the pseudo-potential, which was tuned for Newtonian motion, the innermost
 * stable orbit of a black hole lies at 3.6 rs instead of 3 rs.
 */
export class FlightCore {
  readonly ship = new ShipState();
  spec: ShipSpec = SHIP_SPEC;
  /** the dominant body: the integration frame (null = free space) */
  frame: GravitySource | null = null;
  atmosphere: Atmosphere | null = null;
  /** ground radius below the ship of the frame body (m), 0 = no surface (black hole) */
  groundR = 0;
  /** frame body's angular velocity (world, rad/s) */
  readonly spin = new Vector3();
  /** body-fixed direction while landed */
  landed: { dir: Vector3; src: GravitySource } | null = null;
  /** state relative to the frame body (valid after step(), until place()): position, proper velocity, velocity */
  readonly rel = new Vector3();
  readonly relW = new Vector3();
  readonly relVel = new Vector3();
  event: FlightEvent | null = null;
  /** starlight falling on the ship (W/m^2): heats the hull near a star */
  radiantFlux = 0;
  /** substeps used by the last step */
  substeps = 0;
  /** the reactionless drive is at its limit (spec.gammaMax) and holds back */
  atLimit = false;
  /** step size factor: a substep is at most this fraction of the local dynamical time sqrt(r^3/GM) */
  eta = (2 * Math.PI) / 1000;
  maxSubsteps = 4000;
  private origin = new UPos();
  // local sources (relative to the frame body at the step's start)
  private n = 0;
  private sp = new Float64Array(MAX_SOURCES * 3);
  private sw = new Float64Array(MAX_SOURCES * 3);
  private sgm = new Float64Array(MAX_SOURCES);
  private srs = new Float64Array(MAX_SOURCES);
  private srad = new Float64Array(MAX_SOURCES);
  private sframe = new Uint8Array(MAX_SOURCES);
  private a = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  /** where the substep began (relative to the frame body) */
  private r0 = new Vector3();
  private dr = new Vector3();
  private drag = new Vector3();
  private push = new Vector3();
  private felt = new Vector3();

  constructor(readonly field: GravityField) {}

  /** Re-pick the dominant body (sphere of influence), keeping the absolute state. */
  chooseFrame(): GravitySource | null {
    if (this.landed) { this.frame = this.landed.src; return this.frame; }
    this.frame = this.field.dominantAt(this.ship.upos);
    return this.frame;
  }

  /** Snapshot the sources relative to the frame body (call at the start of a frame, before they move). */
  private begin(): void {
    const D = this.frame;
    this.syncRel();
    // the strongest sources only (pull at the ship), D first
    const list = this.field.sources;
    const cand: { s: GravitySource; a: number }[] = [];
    for (const s of list) {
      const d = s.upos.sub(this.origin, this.tmp).sub(this.rel).length();
      cand.push({ s, a: s === D ? Infinity : s.gm / Math.max(d * d, 1) });
    }
    cand.sort((x, y) => y.a - x.a);
    const aMax = cand.length > 1 ? cand[1].a : 0;
    let n = 0;
    for (const c of cand) {
      if (n >= MAX_SOURCES) break;
      if (c.s !== D && c.a < aMax * 1e-9 && c.a < 1e-9) continue;
      const s = c.s;
      const p = s.upos.sub(this.origin, this.tmp);
      this.sp[n * 3] = p.x; this.sp[n * 3 + 1] = p.y; this.sp[n * 3 + 2] = p.z;
      const fv = D ? D.vel : _zero;
      this.sw[n * 3] = s.vel.x - fv.x; this.sw[n * 3 + 1] = s.vel.y - fv.y; this.sw[n * 3 + 2] = s.vel.z - fv.z;
      if (s === D) { this.sw[n * 3] = this.sw[n * 3 + 1] = this.sw[n * 3 + 2] = 0; }
      this.sgm[n] = s.gm; this.srs[n] = s.rs; this.srad[n] = s.radius;
      // the frame body is pulled by its own group's moving sources: their pull on it is subtracted
      this.sframe[n] = D && s !== D && D.moving && s.moving && s.group === D.group ? 1 : 0;
      n++;
    }
    this.n = n;
  }

  /** Gravitational acceleration at relative position r, time t into the step. */
  private gravity(r: Vector3, t: number, out: Vector3): Vector3 {
    out.set(0, 0, 0);
    for (let i = 0; i < this.n; i++) {
      const px = this.sp[i * 3] + this.sw[i * 3] * t, py = this.sp[i * 3 + 1] + this.sw[i * 3 + 1] * t, pz = this.sp[i * 3 + 2] + this.sw[i * 3 + 2] * t;
      addPointAccel(r.x - px, r.y - py, r.z - pz, this.sgm[i], this.srs[i], this.srad[i], out);
      if (this.sframe[i]) {
        // minus the same source's pull on the frame body (at the origin)
        this.tmp2.set(0, 0, 0);
        addPointAccel(-px, -py, -pz, this.sgm[i], this.srs[i], this.srad[i], this.tmp2);
        out.sub(this.tmp2);
      }
    }
    return out;
  }

  /** Air drag (m/s^2) at relative state (r, v); zero outside the air. */
  private dragAt(r: Vector3, v: Vector3, out: Vector3): Vector3 {
    out.set(0, 0, 0);
    const atm = this.atmosphere;
    if (!atm) return out;
    const h = r.length() - atm.R0;
    if (h >= atm.top) return out;
    const rho = atm.rho0 * Math.exp(-Math.max(h, -atm.H * 5) / atm.H);
    // air co-rotates with the body
    const wx = v.x - (this.spin.y * r.z - this.spin.z * r.y);
    const wy = v.y - (this.spin.z * r.x - this.spin.x * r.z);
    const wz = v.z - (this.spin.x * r.y - this.spin.y * r.x);
    const w = Math.hypot(wx, wy, wz);
    const k = (-0.5 * rho * w * this.spec.cdA) / this.ship.mass;
    return out.set(wx * k, wy * k, wz * k);
  }

  /** Air density, air-relative speed at the relative state */
  private air(r: Vector3, v: Vector3): { rho: number; w: number } {
    const atm = this.atmosphere;
    if (!atm) return { rho: 0, w: 0 };
    const h = r.length() - atm.R0;
    if (h >= atm.top) return { rho: 0, w: 0 };
    const rho = atm.rho0 * Math.exp(-Math.max(h, -atm.H * 5) / atm.H);
    const air = this.tmp2.crossVectors(this.spin, r);
    return { rho, w: air.sub(v).length() };
  }

  /**
   * The engines' proper acceleration (m/s^2, world axes, the ship's rest frame) into `push`, and
   * the part of it the crew feels (torch and RCS; not the reactionless drive) into `felt`.
   */
  engine(push: Vector3, felt: Vector3): void {
    const ship = this.ship, spec = this.spec;
    const torch = ship.drive === 'torch' && ship.throttle > 0 && ship.fuel > 0 ? ship.throttle * spec.thrust : 0;
    felt.set(ship.rcs.x * spec.rcsThrust, ship.rcs.y * spec.rcsThrust, ship.rcs.z * spec.rcsThrust - torch).divideScalar(ship.mass).applyQuaternion(ship.quat);
    push.copy(felt);
    this.atLimit = false;
    if (ship.drive !== 'reactionless' || ship.throttle <= 0) return;
    const p = this.tmp2.set(0, 0, -ship.throttle * ship.driveAccel).applyQuaternion(ship.quat);
    // at its limit the drive pushes no faster (braking, or turning the motion away, still works)
    this.atLimit = lorentz(this.relW) >= spec.gammaMax && p.dot(this.relW) > 0;
    if (!this.atLimit) push.add(p);
  }

  /** The substep (s) the integrator would take at relative state (r, v). */
  stepSize(r = this.rel, v = this.relVel): number {
    let h = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dx = r.x - this.sp[i * 3], dy = r.y - this.sp[i * 3 + 1], dz = r.z - this.sp[i * 3 + 2];
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (this.srs[i] > 0) d = Math.max(d - this.srs[i], this.srs[i] * 0.05);
      else d = Math.max(d, this.srad[i] * 0.5);
      const t = Math.sqrt((d * d * d) / this.sgm[i]);
      if (t < h) h = t;
    }
    h *= this.eta;
    const { rho, w } = this.air(r, v);
    if (rho > 0 && w > 0) h = Math.min(h, (0.03 * this.ship.mass) / (0.5 * rho * w * this.spec.cdA));
    // near the ground: no tunnelling through it in one substep
    if (this.groundR > 0) {
      const alt = r.length() - this.groundR;
      const vs = v.length();
      if (vs > 0 && alt < vs * 2) h = Math.min(h, Math.max(0.002, (alt * 0.25) / vs));
    }
    return Math.max(h, 1e-6);
  }

  /** Estimate of the substep at the ship's current absolute state (before step()). */
  estimateStep(): number {
    this.begin();
    return this.stepSize();
  }

  /**
   * The universe (coordinate) seconds in which `tau` seconds pass aboard, with the engines as they
   * are set now: exact under the engines alone, gravity's clock rate taken as it was last.
   */
  universeTimeFor(tau: number): number {
    this.syncRel();
    this.engine(this.push, this.felt);
    const a = this.push.length();
    if (a > 0) this.push.divideScalar(a);
    return driveTime(this.relW, this.push, a, tau) / Math.max(this.ship.gravityRate, 1e-300);
  }

  /**
   * Advance `dt` seconds of universe (coordinate) time, with the sources as they are now
   * (call before they are moved to the new time), then `place()` once they have been.
   */
  step(dt: number): void {
    this.event = null;
    this.begin();
    const ship = this.ship, spec = this.spec;
    const r = this.rel, w = this.relW, v = this.relVel;
    const push = this.push, felt = this.felt;
    this.substeps = 0;
    this.engine(push, felt);
    const dragSum = this.drag.set(0, 0, 0);
    let dragT = 0, tau = 0;
    if (this.landed) {
      // resting on the ground: lift off only when the engines beat the local gravity
      const g = this.gravity(r, 0, this.a);
      const up = r.clone().normalize();
      const gUp = -g.dot(up);
      if (push.dot(up) > gUp * 1.01 && dt > 0) {
        this.landed = null;
        r.addScaledVector(up, 0.3);
      } else {
        ship.properAccel.copy(up).multiplyScalar(gUp);
        ship.gForce = Math.abs(gUp) / G0;
        this.finish(dt, dt / lorentz(w));
        return;
      }
    }
    const torchOn = ship.drive === 'torch' && ship.throttle > 0 && ship.fuel > 0;
    let t = 0;
    let guard = 0;
    while (t < dt && guard++ < this.maxSubsteps * 2) {
      // (the torch's push grows as its propellant burns: held for the substep, as the mass is)
      this.engine(push, felt);
      const a = push.length();
      if (a > 0) push.divideScalar(a);
      // (the reactionless drive raises γ at most e-fold in a substep: its limit is checked between them)
      let h = Math.min(dt - t, this.stepSize(r, v), ship.drive === 'reactionless' && a > 0 ? (C * lorentz(w)) / a : Infinity);
      if (this.substeps >= this.maxSubsteps) h = dt - t; // over budget: finish the frame in one go
      if (dt - t - h < h * 1e-3) h = dt - t;
      // Yoshida 4: drift, kick, drift, kick, drift, kick, drift
      this.r0.copy(r);
      let tt = t;
      for (let k = 0; k < 4; k++) {
        tau += driveFlow(w, push, a, YC[k] * h, this.dr);
        r.add(this.dr);
        tt += YC[k] * h;
        if (k < 3) {
          const d = this.dragAt(r, velocityOf(w, v), this.tmp);
          w.addScaledVector(this.gravity(r, tt, this.a).add(d), YD[k] * h);
          dragSum.addScaledVector(d, Math.abs(YD[k]) * h);
          dragT += Math.abs(YD[k]) * h;
        }
      }
      velocityOf(w, v);
      t += h;
      this.substeps++;
      if (torchOn) ship.fuel = Math.max(0, ship.fuel - (ship.throttle * spec.thrust * h) / (spec.isp * G0));
      if (this.contact(r, w, this.r0)) break;
    }
    ship.properAccel.copy(felt);
    if (dragT > 0) ship.properAccel.addScaledVector(dragSum, 1 / dragT);
    ship.gForce = ship.properAccel.length() / G0;
    this.finish(dt, tau);
  }

  /**
   * Analytic two-body ("on rails") step about the frame body: exact and cheap for time warp.
   * Perturbations and engines are off; Newtonian, so only for a slow ship. Returns false when the
   * frame does not allow it.
   */
  stepRails(dt: number): boolean {
    this.event = null;
    const D = this.frame;
    if (!D || D.rs > 0 || this.landed) return false;
    this.begin();
    propagateKepler(this.rel, this.relVel, D.gm, dt);
    properVelocityOf(this.relVel, this.relW);
    this.substeps = 1;
    this.ship.properAccel.set(0, 0, 0);
    this.ship.gForce = 0;
    this.contact(this.rel, this.relW);
    this.finish(dt, dt / lorentz(this.relW));
    return true;
  }

  /**
   * Ground and horizon checks after a substep that began at `r0` (none: the step's end alone); true
   * when the flight ended (an event). A fast ship can cross a world within one substep (they are
   * sized by the orbital time, not the speed): the substep's chord counts, and the ship stops where
   * it enters. (The chord of an orbit's substep sags by r·η²/8 below the arc, 31 m at the Earth.)
   */
  private contact(r: Vector3, w: Vector3, r0?: Vector3): boolean {
    const D = this.frame;
    if (!D) return false;
    const entered = !!r0 && enterSphere(r0, r, D.rs > 0 ? D.rs : this.groundR);
    const rl = r.length();
    const v = velocityOf(w, this.relVel);
    if (D.rs > 0 && (rl < D.rs || entered)) {
      this.event = { kind: 'horizon', speed: v.length(), src: D };
      return true;
    }
    if (this.groundR > 0 && (rl < this.groundR || entered)) {
      const surfV = this.tmp2.crossVectors(this.spin, r).negate().add(v);
      const speed = surfV.length();
      if (speed <= this.spec.crashSpeed) {
        const dir = r.clone().normalize();
        r.copy(dir).multiplyScalar(this.groundR);
        properVelocityOf(v.crossVectors(this.spin, r), w);
        // remember the spot in the body's own frame (it turns with the world)
        const bf = D.orient ? dir.clone().applyMatrix4(_inv.copy(D.orient).invert()) : dir.clone();
        this.landed = { dir: bf.normalize(), src: D };
        this.event = { kind: 'land', speed, src: D };
      } else {
        this.event = { kind: 'crash', speed, src: D };
      }
      return true;
    }
    return false;
  }

  /** Tidal stretch, heating, clocks (`tau`: the proper time the motion alone gave this step). */
  private finish(dt: number, tau: number): void {
    const ship = this.ship, spec = this.spec;
    const r = this.rel, v = velocityOf(this.relW, this.relVel);
    let tidal = 0, phi = 0, bh = 1;
    for (let i = 0; i < this.n; i++) {
      const px = this.sp[i * 3] + this.sw[i * 3] * dt, py = this.sp[i * 3 + 1] + this.sw[i * 3 + 1] * dt, pz = this.sp[i * 3 + 2] + this.sw[i * 3 + 2] * dt;
      const d = Math.max(1, Math.hypot(r.x - px, r.y - py, r.z - pz));
      tidal += tidalGradient(this.sgm[i], Math.max(d, this.srad[i])) * spec.length;
      if (this.srs[i] > 0) bh *= Math.sqrt(Math.max(0, 1 - this.srs[i] / Math.max(d, this.srs[i])));
      else phi += potential(this.sgm[i], 0, Math.max(d, this.srad[i]));
    }
    ship.tidal = tidal;
    // the clock aboard: slowed by gravity (the hole's Schwarzschild factor, the weak field's) and by speed
    ship.gravityRate = bh * Math.sqrt(Math.max(0, 1 + (2 * phi) / (C * C)));
    ship.dilation = ship.gravityRate / lorentz(this.relW);
    ship.shipTime += tau * ship.gravityRate;
    // re-entry: Sutton–Graves stagnation heating, hull at radiative equilibrium (lagging ~6 s)
    const { rho, w } = this.landed ? { rho: 0, w: 0 } : this.air(r, v);
    ship.rho = rho;
    ship.heatFlux = 1.7415e-4 * Math.sqrt(rho / spec.noseRadius) * w * w * w;
    // (sunlight on a sphere: absorbed over its cross-section, radiated from all of it)
    const tEq = Math.pow(ship.heatFlux / (0.85 * SIGMA) + this.radiantFlux / (4 * SIGMA) + 3 ** 4, 0.25);
    ship.hullTemp += (tEq - ship.hullTemp) * (1 - Math.exp(-Math.min(dt, 1) / 6));
    if (this.event) return;
    if (tidal > spec.tidalLimit) this.event = { kind: 'spaghetti', speed: v.length(), src: this.frame };
    else if (ship.hullTemp > spec.maxHullTemp) this.event = { kind: 'burnup', speed: v.length(), src: this.frame };
  }

  /** Put the ship back in absolute coordinates once the sources have moved to the new time. */
  place(): void {
    const D = this.frame, ship = this.ship;
    if (this.landed && D) {
      const dir = this.landed.dir.clone();
      if (D.orient) dir.applyMatrix4(_rot.extractRotation(D.orient));
      this.rel.copy(dir).multiplyScalar(this.groundR || this.rel.length());
      properVelocityOf(this.relVel.crossVectors(this.spin, this.rel), this.relW);
    }
    if (D) {
      ship.upos.copy(D.upos).addVec(this.rel);
      ship.setProperVelocity(boostProper(this.relW, D.vel, this.tmp));
    } else {
      ship.upos.copy(this.origin).addVec(this.rel);
      ship.setProperVelocity(this.relW);
    }
  }

  /** Set the ship on a circular orbit of radius `r` about `src` (relative position direction `dir`, orbit normal `normal`). */
  setCircularOrbit(src: GravitySource, r: number, dir: Vector3, normal: Vector3): void {
    const d = dir.clone().normalize();
    const t = new Vector3().crossVectors(normal, d).normalize();
    if (t.lengthSq() < 0.5) t.set(-d.y, d.x, 0).normalize();
    // circular in the (pseudo-Newtonian) potential: w²/γ = r a(r), i.e. w² = ra(x + √(x² + 1)), x = ra/2c²
    const a = src.rs > 0 ? src.gm / ((r - src.rs) * (r - src.rs)) : src.gm / (r * r);
    const x = (r * a) / (2 * C * C);
    const wc = Math.sqrt(r * a * (x + Math.hypot(x, 1)));
    this.landed = null;
    this.frame = src;
    this.rel.copy(d).multiplyScalar(r);
    this.relW.copy(t).multiplyScalar(wc);
    this.place();
  }

  /**
   * The state relative to the frame body (rel, relW, relVel) from the ship's absolute one; called
   * by every step, and after the absolute state was set directly.
   */
  syncRel(): void {
    const D = this.frame, ship = this.ship;
    if (D) {
      ship.upos.sub(D.upos, this.rel);
      boostProper(ship.properVelocity(), this.tmp.copy(D.vel).negate(), this.relW);
      this.origin.copy(D.upos);
    } else {
      this.origin.copy(ship.upos);
      this.rel.set(0, 0, 0);
      this.relW.copy(ship.properVelocity());
    }
    velocityOf(this.relW, this.relVel);
  }
}

const _zero = new Vector3();

/**
 * If the chord from `r0` to `r` (outside a sphere of radius `R` about the origin at both ends)
 * passes through it, `r` moves to where the chord enters it, and the answer is true.
 */
function enterSphere(r0: Vector3, r: Vector3, R: number): boolean {
  if (!(R > 0) || r.lengthSq() < R * R || r0.lengthSq() < R * R) return false;
  const d = _chord.copy(r).sub(r0), dd = d.lengthSq();
  if (dd === 0) return false;
  // |r0 + s d| = R: the smaller root, if it lies within the chord
  const b = r0.dot(d) / dd, c = (r0.lengthSq() - R * R) / dd, disc = b * b - c;
  if (disc <= 0) return false;
  const s = -b - Math.sqrt(disc);
  if (!(s > 0 && s < 1)) return false;
  r.copy(r0).addScaledVector(d, s);
  return true;
}
const _chord = new Vector3();
const _inv = new Matrix4();
const _rot = new Matrix4();
