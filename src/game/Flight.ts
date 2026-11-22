import { Matrix4, Quaternion, Vector3 } from 'three';
import type { App } from '../app/App';
import { AU, DAY, LY } from '../core/units';
import { UPos } from '../core/upos';
import type { AtmosphereData } from '../render/Atmospheres';
import { C, G, gravity, type GravitySource, MSUN, makeSource } from '../sim/Gravity';
import { conicOf, timeToRadius, type Conic } from '../sim/Kepler';
import { Predictor } from '../sim/Predict';
import { boostProper, flipAndBurn, lorentz } from '../sim/Relativity';
import { type Atmosphere, type Drive, FlightCore, type FlightEvent, G0, SHIP_SPEC } from '../sim/ShipPhysics';
import { Body, type SpaceObject } from '../universe/Body';
import { ExoPlanet, starProps } from '../universe/Planets';
import { CatalogStar } from '../universe/Stars';
import { autopilotRate, brake, inTheWay, placeSlot, type Situation, steer, type Steering } from './Autopilot';
import { Station } from './Station';

export type SasMode = 'off' | 'stability' | 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radial-out' | 'radial-in' | 'target' | 'anti-target';
const SAS_ORDER: SasMode[] = ['off', 'stability', 'prograde', 'retrograde', 'normal', 'antinormal', 'radial-out', 'radial-in', 'target', 'anti-target'];

/**
 * Fastest time warp (of the ship's clock: the universe's runs faster still when the ship's runs
 * slow); above RAILS_RATE a slow, coasting ship goes "on rails" (analytic Kepler).
 */
export const MAX_RATE = 100_000;
/** the ship's time warp, step by step (Faster and Slower, [ and ]): ×1 to ×100,000 of its own clock */
export const WARP_STEPS = [1, 10, 100, 1000, 10_000, MAX_RATE];
export const RAILS_RATE = 1000;
/** the autopilot flies only where gravity is at most this share of the drive's acceleration (the rest steers) */
export const HOLD = 0.5;
/** the reactionless drive's settings (g at full throttle): 1, 2, 5 from a thousandth of a g to a million */
export const DRIVE_STEPS = [-3, -2, -1, 0, 1, 2, 3, 4, 5].flatMap((e) => [1, 2, 5].map((m) => m * 10 ** e)).concat(1e6);
const L_SUN = 3.828e26;

/** The autopilot's flight: flip-and-burn to a target, arriving at rest beside it, or in orbit if it pulls. */
interface Autopilot {
  target: SpaceObject;
  /** distance from the target's centre to arrive at (m) */
  radius: number;
  /** the target's velocity (m/s, world), from its motion between frames when it has none of its own */
  vel: Vector3;
  prev: UPos;
  prevJd: number;
  steering: Steering;
  /** the world it is flying round ('' for none) */
  detour: string;
}

/** What the HUD and cockpit show (refreshed every frame). */
export interface FlightReadout {
  frame: string;
  altitude: number;
  vertSpeed: number;
  orbitSpeed: number;
  surfSpeed: number;
  conic: Conic | null;
  /** from the numerical prediction (s from now; NaN = none) */
  tImpact: number;
  tAp: number;
  tPe: number;
  ap: number;
  pe: number;
  escape: boolean;
  encounter: string;
  gForce: number;
  tidal: number;
  throttle: number;
  fuel: number;
  dv: number;
  sas: SasMode;
  rails: boolean;
  rate: number;
  limited: boolean;
  dilation: number;
  shipTime: number;
  universeTime: number;
  heat: number;
  hullTemp: number;
  drive: Drive;
  /** the reactionless drive's setting (g at full throttle) */
  driveG: number;
  /** the reactionless drive holds back at its limit */
  atLimit: boolean;
  /** proper speed γv (m/s) and Lorentz factor against the frame body */
  properSpeed: number;
  gamma: number;
  /** the selected target: name, distance to its surface (m), time to it aboard and in the universe (s; NaN: none) */
  target: string;
  targetDist: number;
  etaShip: number;
  etaUniverse: number;
  /** where a flip-and-burn ends: this far out from the target's surface (m; NaN: none) */
  arrival: number;
  /** how the times to the target are reckoned: by flip-and-burn at the drive's setting, or coasting at this speed */
  etaBy: 'flip-and-burn' | 'coasting' | '';
  /** the autopilot, if flying: where to and what it is doing; what it is doing alone ('' when not flying) */
  autopilot: string;
  apState: string;
  /** Stop, if under way: what it does ('turning', 'braking', 'holding') and beside what, '' otherwise; its time to go aboard (s) */
  stop: string;
  stopTau: number;
  /** looking ahead: half the sky crowds into this angle (rad); light ahead is this many times bluer */
  halfSky: number;
  doppler: number;
  landed: string;
  /** why the autopilot will not fly from here ('' when it will) */
  refusal: string;
  warning: string;
  warnLevel: 0 | 1 | 2;
  /**
   * The time warp as it is, measured from the clocks over the last moments: the ship's seconds and
   * the universe's per real second; the rate asked for (the app's clock), and why the ship's differs
   * from it ('' when it does not).
   */
  pace: number;
  paceUniverse: number;
  asked: number;
  why: string;
}

/**
 * Real-physics flight for the ship (default whenever you are in it): the live gravity of every
 * body, star and black hole, engines and RCS with real mass, reaction wheels and SAS, drag and
 * re-entry heat, landings and crashes, tides and time dilation near black holes, physics time warp
 * with an "on rails" mode, and the predicted path ahead.
 */
export class Flight {
  on = false;
  readonly core = new FlightCore(gravity);
  readonly predictor = new Predictor();
  sas: SasMode = 'stability';
  rails = false;
  limited = false;
  /** universe seconds this frame */
  simDt = 0;
  readonly readout: FlightReadout = {
    frame: '', altitude: 0, vertSpeed: 0, orbitSpeed: 0, surfSpeed: 0, conic: null, tImpact: NaN, tAp: NaN, tPe: NaN, ap: NaN, pe: NaN,
    escape: false, encounter: '', gForce: 0, tidal: 0, throttle: 0, fuel: 1, dv: 0, sas: 'stability', rails: false, rate: 1, limited: false,
    dilation: 1, shipTime: 0, universeTime: 0, heat: 0, hullTemp: 290, drive: 'torch', driveG: 1, atLimit: false, properSpeed: 0, gamma: 1,
    target: '', targetDist: NaN, etaShip: NaN, etaUniverse: NaN, arrival: NaN, etaBy: '', autopilot: '', apState: '', stop: '', stopTau: NaN, halfSky: Math.PI / 2, doppler: 1,
    landed: '', refusal: '', warning: '', warnLevel: 0, pace: 1, paceUniverse: 1, asked: 1, why: '',
  };
  /** the autopilot's flight in progress (null: the pilot flies) */
  autopilot: Autopilot | null = null;
  /**
   * Stop (a touch screen's Stop button): braking to rest beside the nearest world (the frame body),
   * then holding there against its pull; null when not under way. Any control takes over from it.
   */
  stopping: { steering: Steering; at: string } | null = null;
  /** end of the flight in progress (crash, horizon...): seconds left, then respawn */
  ending: { ev: FlightEvent; t: number; total: number; title: string; text: string } | null = null;
  /** seconds since the end sequence started (for the effects) */
  endingT = 0;
  onEvent: ((ev: FlightEvent) => void) | null = null;
  /** shake amplitude (rad) for the view this frame */
  shake = 0;
  universeTime = 0;
  private atmoData: AtmosphereData = {};
  private cache = new Map<object, GravitySource>();
  private exoPrev = new Map<GravitySource, UPos>();
  private predictTimer = 0;
  private lastThrottle = 0;
  private predictedFrom: GravitySource | null = null;
  private mouseRot = new Vector3();
  /** a finger's turn command (ship axes, -1..1), smoothed over the touch events' uneven timing */
  private touchRot = new Vector3();
  private warnedReverse = false;
  private lastJd = 0;
  private tmp = new Vector3();
  /** the warp as measured: real seconds, ship's seconds and universe's seconds summed since the last reading */
  private paceSum = { real: 0, ship: 0, universe: 0, asked: 1 };
  private paceShipTime = 0;
  /** this frame: real seconds, the rate asked for, and why the ship's differs */
  private frameReal = 0;
  private asked = 1;
  private why = '';

  constructor(private app: App) {
    gravity.provider = () => this.collectSources();
  }

  setAtmospheres(d: AtmosphereData): void {
    this.atmoData = d;
  }

  get ship() {
    return this.core.ship;
  }

  // ------------------------------------------------------------------ sources
  private src(obj: object, make: () => GravitySource): GravitySource {
    let s = this.cache.get(obj);
    if (!s) { s = make(); this.cache.set(obj, s); }
    return s;
  }

  /** Every gravitating thing near enough to matter, read live. */
  private collectSources(): GravitySource[] {
    const app = this.app;
    const out: GravitySource[] = [];
    const sys = app.system;
    for (const b of sys.bodies) {
      if (!b.valid || !(b.gm > 0)) continue;
      const s = this.src(b, () => makeSource({ obj: b, name: b.name, gm: b.gm, upos: b.upos, vel: b.vel, moving: true, group: 'sol', orient: b.orientation }));
      s.gm = b.gm;
      s.radius = b.radius;
      s.name = b.name;
      out.push(s);
    }
    // hierarchy after all sources exist
    for (const s of out) {
      const b = s.obj as Body;
      s.parent = b.parent && b.parent.gm > 0 ? this.cache.get(b.parent) ?? null : null;
      s.soi = s.parent ? b.soiRadius() : Infinity;
    }
    // black holes (Paczyński–Wiita) and their companions, when within a few light years
    const cam = this.ship.upos;
    for (const h of app.blackHoles) {
      const d = h.upos.sub(cam, this.tmp).length();
      const gm = G * h.massSun * MSUN;
      if (gm / (d * d) < 1e-14) continue;
      const s = this.src(h, () => makeSource({ obj: h, name: h.name, gm, rs: h.radius, upos: h.upos, group: h.key }));
      s.gm = gm;
      out.push(s);
      if (h.companion && h.data.companion) {
        const c = h.companion, cm = G * h.data.companion.massSun * MSUN;
        const cs = this.src(c, () => makeSource({ obj: c, name: c.name, gm: cm, upos: c.upos, radius: c.radius, group: h.key }));
        cs.parent = null;
        out.push(cs);
      }
    }
    // nearby catalogue stars (masses from their luminosity class) and generated/known planets
    for (const st of app.near.stars) {
      const d = st.upos.sub(cam, this.tmp).length();
      if (d > 5e14) continue;
      out.push(this.starSource(st));
    }
    for (const ps of app.activeSystems) {
      const host = this.starSource(ps.host);
      if (!out.includes(host)) out.push(host);
      for (const p of ps.planets) {
        const gm = G * p.spec.massKg;
        const s = this.src(p, () => makeSource({ obj: p, name: p.name, gm, upos: p.upos, radius: p.radius, moving: true, group: ps.host.key }));
        s.parent = host;
        s.soi = p.hill;
        out.push(s);
      }
    }
    return out;
  }

  private starSource(st: CatalogStar): GravitySource {
    return this.src(st, () => makeSource({ obj: st, name: st.name, gm: G * starProps(st).mass * MSUN, upos: st.upos, radius: st.radius, group: st.key }));
  }

  /** Exoplanet velocities by finite differences (their orbits are drawn, not integrated). */
  private exoVelocities(dt: number): void {
    for (const s of gravity.sources) {
      if (!(s.obj instanceof ExoPlanet)) continue;
      const prev = this.exoPrev.get(s);
      if (prev && dt > 0) s.upos.sub(prev, s.vel).divideScalar(dt);
      this.exoPrev.set(s, s.upos.clone());
    }
  }

  // ------------------------------------------------------------------ frame body environment
  private frameEnv(): void {
    const core = this.core, D = core.frame;
    core.atmosphere = null;
    core.groundR = 0;
    core.spin.set(0, 0, 0);
    core.radiantFlux = 0;
    // starlight (heats the hull near a star)
    const sun = this.app.system.sun;
    const dSun = sun.upos.sub(this.ship.upos, this.tmp).length();
    core.radiantFlux = L_SUN / (4 * Math.PI * Math.max(dSun, sun.radius) ** 2);
    if (!D) return;
    // the frame body's spin (the ground and the air turn with it)
    if (D.obj instanceof Body) spinOf(D.obj, core.spin);
    if (D.rs > 0) return;
    const obj = D.obj;
    const app = this.app;
    let R = D.radius;
    const below = app.terrain.owner === obj ? app.terrain.below(this.ship.upos) : null;
    if (below) R = below.ground;
    if (obj instanceof Body) {
      const a = this.atmoData[obj.name];
      if (a) {
        const H = a.scaleHeightKm * 1e3;
        const rho0 = (a.surfacePressureBar * 1e5 * (a.meanMolecularWeight / 1000)) / (8.314462 * a.temperatureK);
        core.atmosphere = { rho0, H, R0: D.radius, top: H * 15 } satisfies Atmosphere;
        // gas giants: no surface; the hull gives way at ~100 bar
        if (obj.isGasGiant) R = D.radius - H * Math.log(100 / a.surfacePressureBar);
      }
    }
    core.groundR = R;
  }

  // ------------------------------------------------------------------ enter / leave
  /** Board: physics takes over from where the explorer is. */
  enable(): void {
    if (this.on) return;
    this.on = true;
    const app = this.app, rig = app.rig, ship = this.ship;
    // (boarding stops the explorer's travel: in the ship nothing outruns light)
    rig.cancelGoto();
    gravity.refresh();
    ship.upos.copy(rig.upos);
    ship.quat.copy(rig.quat);
    ship.angVel.set(0, 0, 0);
    ship.throttle = 0;
    ship.rcs.set(0, 0, 0);
    ship.hullTemp = 290;
    this.ending = null;
    this.autopilot = null;
    this.stopping = null;
    this.universeTime = 0;
    ship.shipTime = 0;
    this.paceShipTime = 0;
    this.paceSum = { real: 0, ship: 0, universe: 0, asked: 1 };
    this.readout.pace = this.readout.paceUniverse = 1;
    this.lastJd = app.clock.jdTdb;
    this.core.landed = null;
    this.core.chooseFrame();
    this.frameEnv();
    this.dropIntoOrbit(false);
    this.predictor.done = true;
    this.predictedFrom = null;
  }

  disable(): void {
    this.on = false;
    this.ending = null;
    this.autopilot = null;
    this.stopping = null;
    this.app.rig.stop();
  }

  /**
   * Boarding, or set down somewhere by the explorer (a search pick, a tour stop, a script): matched
   * to the local frame. Low over a solid world you are set down; otherwise on a circular orbit of
   * the dominant body.
   */
  dropIntoOrbit(announce: boolean): void {
    const core = this.core, ship = this.ship;
    gravity.refresh();
    const D = core.chooseFrame();
    this.frameEnv();
    if (!D) { ship.vel.set(0, 0, 0); core.syncRel(); return; }
    // next to a station, ship or spacecraft: matched to its velocity (ready to dock)
    const t = this.anchorTrack, anc = this.app.rig.anchor;
    const orb = anc as unknown as { vel?: Vector3; body?: Body };
    if (anc && anc.upos.sub(ship.upos, this.tmp).length() < 50e3 && ((t && t.ok && t.obj === anc) || (orb.vel && orb.body))) {
      // stations and traffic ships know their orbital velocity (about their world); others are tracked
      if (orb.vel && orb.body instanceof Body) ship.vel.copy(orb.body.vel).add(orb.vel);
      else ship.vel.copy(t!.vel);
      core.landed = null;
      core.syncRel();
      if (announce) this.app.hud.toast(`Matched velocity with ${anc.name}`);
      return;
    }
    const rel = ship.upos.sub(D.upos, new Vector3());
    const r = rel.length();
    const ground = core.groundR;
    const top = core.atmosphere ? core.atmosphere.R0 + core.atmosphere.top : 0;
    if (ground > 0 && r - ground < 60 && !(D.obj instanceof Body && D.obj.isGasGiant) && !(D.obj instanceof Body && D.obj.kind === 'star')) {
      // on (or just above) the ground: landed, turning with the world
      core.landed = null;
      ship.vel.copy(D.vel).add(new Vector3().crossVectors(core.spin, rel));
      ship.upos.copy(D.upos).addVec(rel, Math.max(ground, r - 0.0) / r);
      const dir = rel.clone().normalize();
      const bf = D.orient ? dir.clone().transformDirection(D.orient.clone().invert()) : dir;
      core.landed = { dir: bf, src: D };
      core.syncRel();
      if (announce) this.app.hud.toast(`Landed on ${D.name}`);
      return;
    }
    // circular orbit, prograde with the body's spin (or the ecliptic), through the current position
    const minR = Math.max(ground * 1.02, top + 20e3, D.rs * 6);
    if (r < minR && D.rs === 0 && ground > 0) {
      // too low for an orbit: hanging still over the ground, and starting to fall
      ship.vel.copy(D.vel).add(new Vector3().crossVectors(core.spin, rel));
      core.landed = null;
      core.syncRel();
      if (announce) this.app.hud.toast(`Over ${D.name} with no orbital speed: you are falling! W throttles up`, 3.5);
      return;
    }
    const rr = Math.max(r, minR);
    let n = core.spin.lengthSq() > 0 ? core.spin.clone().normalize() : new Vector3(0, -0.3978, 0.9175);
    if (Math.abs(n.dot(rel) / r) > 0.98) n = new Vector3(1, 0, 0);
    // tides of a stellar black hole: never drop below the survivable radius
    let safe = rr;
    if (D.rs > 0) safe = Math.max(rr, 1.3 * Math.cbrt((2 * D.gm * SHIP_SPEC.length) / SHIP_SPEC.tidalLimit));
    core.setCircularOrbit(D, safe, rel, n);
    if (announce) this.app.hud.toast(`Matched orbit about ${D.name}`);
  }

  /** Hold the ship still `h` metres over the ground below it (turning with the world): it starts to fall. */
  hoverOverGround(h: number): void {
    const core = this.core, ship = this.ship;
    core.chooseFrame();
    this.frameEnv();
    const D = core.frame;
    if (!D || core.groundR <= 0) return;
    const rel = ship.upos.sub(D.upos, new Vector3());
    rel.setLength(core.groundR + h);
    ship.upos.copy(D.upos).addVec(rel);
    ship.vel.copy(D.vel).add(new Vector3().crossVectors(core.spin, rel));
    core.landed = null;
    this.ending = null;
    core.syncRel();
    this.app.rig.upos.copy(ship.upos);
  }

  /** Velocity of what the camera rides with when it is not a gravitating body (stations, ships, spacecraft). */
  private trackAnchor(): void {
    const a = this.app.rig.anchor, jd = this.app.clock.jdTdb;
    if (!a || this.cache.has(a)) { this.anchorTrack = null; return; }
    const t = this.anchorTrack;
    if (t && t.obj === a) {
      const dt = (jd - t.jd) * DAY;
      if (dt > 0) { a.upos.sub(t.pos, t.vel).divideScalar(dt); t.ok = true; }
      t.pos.copy(a.upos);
      t.jd = jd;
    } else this.anchorTrack = { obj: a, pos: a.upos.clone(), jd, vel: new Vector3(), ok: false };
  }
  private anchorTrack: { obj: object; pos: UPos; jd: number; vel: Vector3; ok: boolean } | null = null;

  /**
   * Why the autopilot will not fly from here ('' when it will): in the air (it would cross it at
   * many km/s), or where the drive at its setting cannot hold the ship against gravity with enough
   * to spare to steer. (Worlds in its way it flies round: Autopilot.ts, inTheWay.)
   */
  autopilotRefusal(): string {
    if (!this.on) return '';
    const core = this.core, D = core.frame, atm = core.atmosphere;
    if (D && atm && this.ship.upos.sub(D.upos, this.tmp).length() < atm.R0 + atm.top) return `In the air of ${D.name}: climb above ${fmtDist(atm.top)} first.`;
    return this.driveTooWeak();
  }

  /** Why the drive at its setting cannot steer against gravity here ('' when it can). */
  private driveTooWeak(): string {
    const g = gravity.gravityAt(this.ship.upos, this.tmp).length();
    if (g <= HOLD * this.ship.driveAccel) return '';
    const need = DRIVE_STEPS.find((x) => x * G0 * HOLD >= g) ?? DRIVE_STEPS[DRIVE_STEPS.length - 1];
    return `The drive at ${fmtG(this.ship.driveAccel / G0)} is too weak against gravity here (${g.toFixed(g < 10 ? 2 : 0)} m/s²): set it to ${fmtG(need)} or more.`;
  }

  /**
   * J (or Go there, in the ship): the autopilot flies to `target` the way physics allows: the
   * reactionless drive at the pilot's setting, accelerating towards it, turning, braking, and
   * arriving at rest beside it (in orbit about it if it pulls). Not in the air, nor where gravity
   * is too strong for the drive's setting.
   */
  autopilotTo(target: SpaceObject): boolean {
    const app = this.app, ship = this.ship;
    if (!this.on || this.ending) return false;
    const no = this.autopilotRefusal();
    if (no) {
      app.hud.toast(no, 4);
      if (app.vr.active) app.vr.flash(no.split(':')[0]);
      return false;
    }
    if (target.upos.sub(ship.upos, this.tmp).length() < this.arrivalRadius(target) * 1.05) {
      app.hud.toast(`Already at ${target.name}`);
      return false;
    }
    ship.drive = 'reactionless';
    this.stopping = null;
    this.autopilot = {
      target, radius: this.arrivalRadius(target), vel: new Vector3(), prev: target.upos.clone(), prevJd: app.clock.jdTdb,
      steering: { aim: new Vector3(0, 0, -1).applyQuaternion(ship.quat), throttle: 0, rcs: new Vector3(), turning: false, tauGo: Infinity, tGo: Infinity, phase: 'turning', arrived: false }, detour: '',
    };
    this.trackTarget();
    const say = `Autopilot: flip-and-burn to ${target.name} at ${fmtG(ship.driveAccel / G0)} (reactionless drive)`;
    app.hud.toast(say, 3);
    if (app.vr.active) app.vr.flash(`Autopilot: ${target.name}`);
    return true;
  }

  cancelAutopilot(say: string): void {
    if (!this.autopilot && !this.stopping) return;
    if (!this.autopilot) say = say.replace('Autopilot off', 'Stop off');
    this.autopilot = null;
    this.stopping = null;
    this.ship.throttle = 0;
    this.ship.rcs.set(0, 0, 0);
    this.app.hud.toast(say, 2.5);
    if (this.app.vr.active) this.app.vr.flash(say);
  }

  /**
   * Stop: brake to rest beside the nearest world (or star) on the reactionless drive at its
   * setting, turning the ship as it must, then hold there against what pull is left (Autopilot.ts,
   * brake). Refused where the drive is too weak to steer against gravity, as the autopilot is.
   */
  stop(): boolean {
    const app = this.app, ship = this.ship, core = this.core;
    if (!this.on || this.ending) return false;
    if (core.landed) { app.hud.toast(`Landed on ${core.landed.src.name}: at rest already`); return false; }
    const no = this.driveTooWeak();
    if (no) { app.hud.toast(no, 4); return false; }
    this.autopilot = null;
    ship.drive = 'reactionless';
    const at = core.frame?.name ?? 'where you are';
    this.stopping = {
      at, steering: { aim: new Vector3(0, 0, -1).applyQuaternion(ship.quat), throttle: 0, rcs: new Vector3(), turning: false, tauGo: Infinity, tGo: Infinity, phase: 'turning', arrived: false },
    };
    app.hud.toast(`Stopping: braking to rest beside ${at} at ${fmtG(ship.driveAccel / G0)} (reactionless drive)`, 3);
    return true;
  }

  /** Stop, every frame: brake in the frame body's frame, then hold, or let go where nothing pulls. */
  private guideStop(): void {
    const st = this.stopping!, ship = this.ship, D = this.core.frame, sit = this.situation;
    sit.radius = 0;
    placeSlot(sit, _g1.set(0, 0, 0), ship.properVelocity(), D ? D.vel : _zero, 0, 0, null);
    gravity.gravityAt(ship.upos, sit.gravity);
    if (D) sit.gravity.sub(gravity.gravityAt(D.upos, _g2));
    sit.nose.set(0, 0, -1).applyQuaternion(ship.quat);
    sit.drive = ship.driveAccel;
    sit.rcs = SHIP_SPEC.rcsThrust / ship.mass;
    sit.dt = this.simDt;
    const s = brake(sit, st.steering);
    ship.throttle = s.throttle;
    ship.rcs.copy(s.rcs).applyQuaternion(_q.copy(ship.quat).invert()).divideScalar(sit.rcs).clampScalar(-1, 1);
    st.at = D?.name ?? 'where you are';
    if (!s.arrived || s.phase !== 'holding') return;
    // at rest: where something still pulls the drive holds the ship there; otherwise the stop is done
    if (sit.gravity.length() > 1e-3) {
      if (!this.held) { this.held = true; this.app.hud.toast(`At rest over ${st.at}: the drive holds the ship against its pull. Touch a control to let go`, 4); }
      return;
    }
    this.stopping = null;
    ship.throttle = 0;
    ship.rcs.set(0, 0, 0);
    this.sas = 'stability';
    this.app.hud.toast(`Stopped: at rest beside ${st.at}`, 3);
    this.app.game.audio.chime();
  }
  private held = false;

  /** The throttle from a touch screen's lever (0..1): the pilot takes the controls. */
  setThrottle(x: number): void {
    if (!this.on || this.ending) return;
    this.cancelAutopilot('Autopilot off: you have the controls');
    this.ship.throttle = Math.max(0, Math.min(1, x));
  }

  /** Where the autopilot stops: clear of the target's air, heat and tides. */
  private arrivalRadius(obj: SpaceObject): number {
    if (obj instanceof Station) return 700;
    const src = this.cache.get(obj);
    if (src && src.rs > 0) return Math.max(30 * src.rs, 1.6 * Math.cbrt((2 * src.gm * SHIP_SPEC.length) / SHIP_SPEC.tidalLimit));
    if ((obj instanceof Body && obj.kind === 'star') || obj instanceof CatalogStar) return Math.max(8 * obj.radius, 2e7);
    if (obj.radius < 1e4) return Math.max(5 * obj.radius, 1e3);
    return Math.max(3.5 * obj.radius, obj.radius + 300e3);
  }

  /**
   * The autopilot, every frame (Autopilot.ts: the slot it flies to, the steering), and what it
   * does when it is there.
   */
  private guide(): void {
    const ap = this.autopilot!, ship = this.ship, tgt = ap.target, sit = this.situation;
    // the target can go (a world taken away, a station with it, a craft past its ephemeris)
    const holder = (tgt instanceof Station ? tgt.body : tgt) as { valid?: boolean };
    if (holder.valid === false) { this.cancelAutopilot(`${tgt.name} is gone: autopilot off`); return; }
    const src = tgt instanceof Station ? undefined : this.cache.get(tgt);
    // a world in the way: towards a point round it instead, moving with it, until the target is in sight
    const w = inTheWay(ship.upos, ship.vel, tgt, gravity.sources, _g3);
    ap.detour = w ? w.name : '';
    if (w) {
      sit.radius = 0;
      placeSlot(sit, ship.upos.sub(w.upos, _g1).sub(_g3), ship.properVelocity(), w.vel, 0, 0, null);
      gravity.gravityAt(ship.upos, sit.gravity).sub(gravity.gravityAt(w.upos, _g2));
    } else {
      sit.radius = ap.radius;
      placeSlot(sit, ship.upos.sub(tgt.upos, _g1), ship.properVelocity(), ap.vel, src?.gm ?? 0, src?.rs ?? 0, tgt instanceof Body ? spinOf(tgt, _g2) : null);
      gravity.gravityAt(ship.upos, sit.gravity).sub(gravity.gravityAt(tgt.upos, _g2));
    }
    sit.nose.set(0, 0, -1).applyQuaternion(ship.quat);
    sit.drive = ship.driveAccel;
    sit.rcs = SHIP_SPEC.rcsThrust / ship.mass;
    sit.dt = this.simDt;
    const st = steer(sit, ap.steering);
    ship.throttle = st.throttle;
    ship.rcs.copy(st.rcs).applyQuaternion(_q.copy(ship.quat).invert()).divideScalar(sit.rcs).clampScalar(-1, 1);
    if (st.arrived && !ap.detour) {
      this.autopilot = null;
      ship.throttle = 0;
      ship.rcs.set(0, 0, 0);
      this.sas = 'stability';
      const say = sit.orbit > 0 ? `Arrived: in orbit about ${tgt.name}` : `Arrived at ${tgt.name}`;
      this.app.hud.toast(say, 3);
      if (this.app.vr.active) this.app.vr.flash(say);
      this.app.game.audio.chime();
    }
  }
  private situation: Situation = {
    rel: new Vector3(), w: new Vector3(), slotAccel: new Vector3(), gravity: new Vector3(), nose: new Vector3(), drive: 0, rcs: 0, dt: 0, radius: 0, orbit: 0,
  };

  /** The target's velocity from its motion since the last frame (after the bodies moved). */
  private trackTarget(): void {
    const ap = this.autopilot;
    if (!ap) return;
    const jd = this.app.clock.jdTdb, dt = (jd - ap.prevJd) * DAY;
    // (stations and traffic ships know their velocity about their world)
    const orb = ap.target as unknown as { vel?: Vector3; body?: Body };
    if (ap.target instanceof Body) ap.vel.copy(ap.target.vel);
    else if (orb.vel && orb.body instanceof Body) ap.vel.copy(orb.body.vel).add(orb.vel);
    else if (dt > 0) ap.target.upos.sub(ap.prev, ap.vel).divideScalar(dt);
    ap.prev.copy(ap.target.upos);
    ap.prevJd = jd;
  }

  /** The reactionless drive's setting, a step up or down (= and -). */
  stepDrive(up: boolean): void {
    const ship = this.ship;
    const i = DRIVE_STEPS.findIndex((g) => g >= ship.driveAccel / G0 * (1 - 1e-9));
    const j = Math.max(0, Math.min(DRIVE_STEPS.length - 1, (i < 0 ? DRIVE_STEPS.length - 1 : i) + (up ? 1 : -1)));
    ship.driveAccel = DRIVE_STEPS[j] * G0;
    const say = `Reactionless drive: ${fmtG(DRIVE_STEPS[j])} at full throttle${ship.drive === 'torch' ? ' (the autopilot flies on it)' : ''}`;
    this.app.hud.toast(say, 2);
    if (this.app.vr.active) this.app.vr.flash(say);
  }

  /** VR grip throttle this frame (-1 = none) */
  gripThrottle = -1;

  /** true while something else flies the ship: the explorer's travel, the docking computer */
  get external(): boolean {
    const app = this.app;
    return app.rig.autopilot || app.vr.traveling || !!app.game?.docked || !!app.game?.isDocking;
  }

  // ------------------------------------------------------------------ per frame
  /** Controls, frame body and the universe time step (before the bodies move). Returns the clock step (s). */
  before(rawDt: number, dt: number): number {
    const app = this.app, clock = app.clock, ship = this.ship, core = this.core;
    const rig = () => app.rig;
    this.limited = false;
    this.frameReal = rawDt;
    this.asked = clock.paused ? 0 : clock.rate;
    this.why = '';
    gravity.refresh();
    this.gripThrottle = app.rig.ext.throttle;
    if (this.external) {
      // the docking computer carries the ship (and takes over from the autopilot): physics resumes after it
      this.autopilot = null;
      this.stopping = null;
      this.simDt = clock.paused ? 0 : Math.max(0, Math.min(rawDt, 1) * clock.rate);
      app.rig.updateExternal();
      return this.simDt;
    }
    // the explorer was moved (a tour stop, a search pick, a script): the ship goes with it
    if (rig().upos.sub(ship.upos, this.tmp).length() > 1e-3) {
      this.ending = null;
      ship.upos.copy(rig().upos);
      ship.quat.copy(rig().quat);
      ship.angVel.set(0, 0, 0);
      this.dropIntoOrbit(true);
    }
    core.chooseFrame();
    this.frameEnv();
    if (this.ending) {
      this.simDt = Math.min(rawDt, 1);
      return this.simDt;
    }
    this.controls(dt);
    app.rig.updateExternal();
    let rate = clock.paused ? 0 : clock.rate;
    if (rate < 0) {
      rate = 0;
      this.why = 'time cannot run backwards aboard: the ship holds still';
      if (!this.warnedReverse) { app.hud.toast('Time cannot run backwards while you fly: the ship holds still'); this.warnedReverse = true; }
    } else this.warnedReverse = false;
    if (rate > MAX_RATE) this.why = `the ship's time warp stops at ${fmtWarp(MAX_RATE)}`;
    rate = Math.min(rate, MAX_RATE);
    // (while the autopilot turns the ship, time keeps step with the wheels, which turn by the
    // clamped control step: on a slow machine a turn would otherwise take longer than it does)
    const steering = (this.autopilot ?? this.stopping)?.steering;
    const real = steering?.turning ? dt : Math.min(rawDt, 1);
    if (steering) {
      const r0 = rate, who = this.autopilot ? 'the autopilot' : 'Stop';
      rate = autopilotRate(rate, steering, real, ship.driveAccel);
      if (rate < r0) this.why = steering.turning ? `${who} holds it at ×1 while the ship turns` : `${who} holds it there, to steer in time`;
    }
    // the warp is the ship's clock's; the universe's runs faster as the ship's runs slow (speed, gravity)
    let want = core.universeTimeFor(real * rate);
    // on rails: slow (Newton's two bodies), coasting, no air, no black hole, periapsis well clear of the ground
    const D = core.frame;
    this.rails = false;
    if (want > 0 && rate >= RAILS_RATE && D && D.rs === 0 && !core.landed && ship.throttle === 0 && ship.rcs.lengthSq() === 0 && core.relVel.length() < 1e-3 * C) {
      const rel = ship.upos.sub(D.upos, new Vector3()), vel = ship.vel.clone().sub(D.vel);
      const c = conicOf(rel, vel, D.gm);
      const top = core.atmosphere ? core.atmosphere.R0 + core.atmosphere.top : core.groundR;
      const pertOk = this.perturbationRatio(rel) < 2e-3;
      if (c.rp > Math.max(top, core.groundR) * 1.001 && pertOk && (c.ra < D.soi * 0.98 || rel.length() + vel.length() * want < D.soi * 0.9)) this.rails = true;
    }
    if (want > 0 && !this.rails) {
      // physics warp: at most `budget` substeps a frame (the warp slows down near anything fast)
      const h = core.estimateStep();
      const budget = app.vr.active ? 200 : 900;
      if (want / h > budget) {
        want = budget * h;
        this.limited = rate > 1;
        if (this.limited) this.why = 'as fast as this device can work the flight out';
      }
      core.maxSubsteps = Math.ceil(budget * 1.5);
    }
    this.simDt = want;
    return want;
  }

  /** How strongly the other bodies perturb the ship relative to the frame body's pull. */
  private perturbationRatio(rel: Vector3): number {
    const D = this.core.frame!;
    const g = gravity.gravityAt(this.ship.upos, new Vector3());
    const own = rel.clone().multiplyScalar(-D.gm / rel.length() ** 3);
    // the frame body's own acceleration (its group pulling on it) cancels in its frame
    const gD = new Vector3();
    if (D.moving) {
      for (const s of gravity.sources) {
        if (s === D || !s.moving || s.group !== D.group) continue;
        const d = D.upos.sub(s.upos, this.tmp);
        gD.addScaledVector(d, -s.gm / d.length() ** 3);
      }
    }
    return g.sub(own).sub(gD).length() / own.length();
  }

  /** Integrate the ship over the frame (the bodies are still at the old time). */
  step(): void {
    const core = this.core;
    if (this.external || this.ending) return;
    const dt = this.simDt;
    if (dt <= 0) { core.step(0); return; }
    if (!(this.rails && core.stepRails(dt))) { this.rails = false; core.step(dt); }
  }

  /** After the bodies moved: place the ship, drive the camera, handle events and readouts. */
  after(dt: number): void {
    const app = this.app, rig = app.rig, ship = this.ship, core = this.core;
    this.universeTime += this.simDt;
    this.measurePace();
    this.exoVelocities((app.clock.jdTdb - this.lastJd) * DAY);
    this.trackAnchor();
    this.trackTarget();
    if (this.external) {
      // the docking computer puts the ship where it wants it
      ship.upos.copy(rig.upos);
      ship.quat.copy(rig.quat);
      this.wasCarried = true;
      this.lastJd = app.clock.jdTdb;
      return;
    }
    if (this.wasCarried) {
      this.wasCarried = false;
      ship.upos.copy(rig.upos);
      ship.quat.copy(rig.quat);
      this.dropIntoOrbit(true);
    }
    if (this.ending) {
      this.updateEnding(dt);
    } else {
      core.place();
      const ev = core.event;
      if (ev) this.handleEvent(ev);
    }
    this.lastJd = app.clock.jdTdb;
    rig.upos.copy(ship.upos);
    // view shake from heating, thrust and tides (lighter in VR)
    const heat = Math.min(1, ship.heatFlux / 2e6);
    const tidal = Math.min(1, ship.tidal / SHIP_SPEC.tidalLimit);
    let shake = heat * 0.004 + tidal * 0.006 + (ship.throttle > 0 ? ship.throttle * 0.0006 : 0) + (this.ending && this.ending.ev.kind !== 'horizon' ? 0.01 * Math.max(0, 1 - this.endingT) : 0);
    if (app.vr.active) shake *= 0.15;
    this.shake = shake;
    rig.quat.copy(ship.quat);
    if (shake > 0) {
      const t = performance.now() / 1000;
      rig.quat.multiply(_q.setFromAxisAngle(_v.set(Math.sin(t * 53), Math.sin(t * 71 + 1), Math.sin(t * 37 + 2)).normalize(), shake * Math.sin(t * 97)));
    }
    rig.speed = ship.vel.clone().sub(core.frame ? core.frame.vel : _zero).length();
    this.updatePrediction();
    this.fillReadout();
  }
  private wasCarried = false;

  /**
   * The warp as it is: the ship's clock's and the universe's seconds per real second, summed over
   * at least a second of real time (steady enough to read where the computing holds it back and
   * frames come unevenly; a fresh start when the rate asked for changes). Measured from the clocks
   * themselves, so whatever held the warp back (the autopilot, the computing per frame, live
   * physics) is in it.
   */
  private measurePace(): void {
    const s = this.paceSum, r = this.readout, ship = this.ship;
    // (while something else carries the ship its clock is not integrated: it runs with the universe's)
    const dShip = this.external ? this.simDt : ship.shipTime - this.paceShipTime;
    this.paceShipTime = ship.shipTime;
    if (this.asked !== s.asked) {
      s.asked = this.asked;
      s.real = s.ship = s.universe = 0;
      return;
    }
    s.real += this.frameReal;
    s.ship += Math.max(0, dShip);
    s.universe += Math.max(0, this.simDt);
    if (s.real < 1) return;
    r.pace = s.ship / s.real;
    r.paceUniverse = s.universe / s.real;
    s.real = s.ship = s.universe = 0;
  }

  /** The Time chip and sheet in the ship: the warp as it is, both clocks, and why it is not what was asked. */
  timeReport(): { chip: string; rows: [string, string][]; why: string } {
    const r = this.readout;
    const rows: [string, string][] = [
      ['Aboard', `${fmtWarp(r.pace)} · ${fmtPace(r.pace)}`],
      ['In the universe', fmtPace(r.paceUniverse)],
      ["Ship's clock", `${fmtClock(r.shipTime)} since boarding`],
      ["Universe's clock", `${fmtClock(r.universeTime)} since boarding`],
    ];
    // (what was asked in the explorer's words when it is not one of the ship's steps: "7 days a second")
    const a = Math.abs(r.asked), asked = r.asked < 0 ? 'Time backwards' : WARP_STEPS.includes(a) ? fmtWarp(a) : fmtPace(a);
    const why = r.why && r.asked !== 0 ? `${asked} asked: ${r.why}.` : '';
    return { chip: `${fmtWarp(r.pace)} aboard`, rows, why };
  }

  // ------------------------------------------------------------------ controls
  /** Throttle, RCS, reaction wheels and SAS from the keyboard, mouse and VR controllers (real time). */
  private controls(dt: number): void {
    const app = this.app, k = app.input.keys, ship = this.ship, rig = app.rig;
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    const drag = app.input.consume();
    // fingers on the view (a touch screen): one drags the sky, so the ship turns the way it goes, as
    // fast as the finger up to what the wheels can do (two travelling together do the same); a
    // twist rolls it; a pinch zooms. Smoothed over a few hundredths of a second: touch events come
    // unevenly between frames
    const fx = drag.touch.dx + drag.pan.dx, fy = drag.touch.dy + drag.pan.dy;
    const fingers = fx !== 0 || fy !== 0 || drag.twist !== 0;
    {
      const per = rig.pixelAngle / Math.max(dt, 1e-3) / (SHIP_SPEC.maxRate * 0.6), a = 1 - Math.exp(-dt / 0.06);
      this.touchRot.x += (fy * per - this.touchRot.x) * a;
      this.touchRot.y += (fx * per - this.touchRot.y) * a;
      this.touchRot.z += ((drag.twist / Math.max(dt, 1e-3)) / (SHIP_SPEC.maxRate * 0.6) - this.touchRot.z) * a;
      if (this.touchRot.lengthSq() < 1e-6) this.touchRot.set(0, 0, 0);
      if (drag.pinch && app.game.mode === 'cockpit') rig.fov = Math.max(20, Math.min(100, rig.fov * Math.exp(drag.pinch)));
    }
    if (this.autopilot || this.stopping) {
      // the autopilot (or Stop) flies until the pilot touches a control (a zoom is not one)
      if (MANUAL.some((c) => k.has(c)) || drag.look.dx || drag.look.dy || fingers || rig.ext.throttle > 0.05 || rig.ext.rot.lengthSq() > 1e-4) {
        this.cancelAutopilot('Autopilot off: you have the controls');
      } else {
        if (this.autopilot) this.guide();
        else this.guideStop();
        if (this.autopilot || this.stopping) this.attitude(dt, new Vector3());
        return;
      }
    }
    if (!app.walk.walking) {
      // throttle (W/S, Z full, X cut); with Shift, W/S are RCS fore/aft
      if (!shift) {
        if (k.has('KeyW')) ship.throttle = Math.min(1, ship.throttle + dt * 0.7);
        if (k.has('KeyS')) ship.throttle = Math.max(0, ship.throttle - dt * 0.7);
      }
      if (k.has('KeyZ')) ship.throttle = 1;
      if (k.has('KeyX')) ship.throttle = 0;
      ship.rcs.set(
        (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
        (k.has('KeyR') ? 1 : 0) - (k.has('KeyF') ? 1 : 0),
        shift ? (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0) : 0,
      );
    }
    // VR: left grip is the throttle, left stick RCS (in the ship's axes)
    const ext = rig.ext;
    if (ext.throttle >= 0) ship.throttle = ext.throttle;
    if (ext.move.lengthSq() > 1e-6) {
      const m = ext.move.clone().applyQuaternion(ship.quat.clone().invert());
      ship.rcs.add(m).clampScalar(-1, 1);
    }
    // rotation command, ship axes (pitch about x, yaw about y, roll about z)
    const cmd = new Vector3(
      (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0),
      (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0),
      (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0),
    );
    // mouse: drag to turn (a rate command that decays when the mouse stops)
    this.mouseRot.x = this.mouseRot.x * Math.exp(-dt * 10) - drag.look.dy * 0.04;
    this.mouseRot.y = this.mouseRot.y * Math.exp(-dt * 10) - drag.look.dx * 0.04;
    cmd.add(this.mouseRot).add(this.touchRot).add(ext.rot);
    cmd.clampScalar(-1, 1);
    // zoom out/in the chase camera / field of view is the wheel's job; nothing else consumes input here
    if (drag.wheel && app.game.mode === 'cockpit') rig.fov = Math.max(20, Math.min(100, rig.fov * Math.pow(1.08, drag.wheel)));
    this.attitude(dt, cmd);
  }

  cycleSas(back = false): void {
    const i = SAS_ORDER.indexOf(this.sas);
    this.sas = SAS_ORDER[(i + (back ? SAS_ORDER.length - 1 : 1)) % SAS_ORDER.length];
    if ((this.sas === 'target' || this.sas === 'anti-target') && !this.app.selection) this.sas = back ? 'antinormal' : 'off';
    const label = SAS_LABEL[this.sas];
    this.app.hud.toast(`SAS: ${label}`);
    if (this.app.vr.active) this.app.vr.flash(`SAS: ${label}`);
  }

  /** I: the fusion torch (real thrust, real propellant) or the reactionless drive (the invention). */
  toggleDrive(): void {
    const ship = this.ship;
    ship.drive = ship.drive === 'torch' ? 'reactionless' : 'torch';
    if (ship.drive === 'torch') this.cancelAutopilot('Autopilot off: it flies on the reactionless drive');
    const say = ship.drive === 'reactionless'
      ? `Reactionless drive: ${fmtG(ship.driveAccel / G0)} at full throttle (= and - to set), no propellant, nothing felt (invented); motion: real relativity`
      : 'Fusion torch: real thrust and propellant';
    this.app.hud.toast(say, 3.5);
    if (this.app.vr.active) this.app.vr.flash(ship.drive === 'reactionless' ? 'Reactionless drive' : 'Fusion torch');
  }

  /** Reaction wheels: the command sets an angular acceleration; SAS steers when the pilot does not. */
  private attitude(dt: number, cmd: Vector3): void {
    const ship = this.ship, spec = SHIP_SPEC, core = this.core;
    if (core.landed) { ship.angVel.set(0, 0, 0); return; }
    const inv = ship.quat.clone().invert();
    const wBody = ship.angVel.clone().applyQuaternion(inv);
    const manual = cmd.lengthSq() > 1e-4;
    let want: Vector3 | null = null; // wanted body rates
    if (manual) {
      want = cmd.clone().multiplyScalar(spec.maxRate * 0.6);
    } else if (this.sas !== 'off' || this.autopilot || this.stopping) {
      want = new Vector3();
      const dir = this.sasDirection();
      if (dir) {
        // turn the nose (-z) onto `dir`: rate proportional to the error, gentle near it
        const dB = dir.clone().applyQuaternion(inv);
        const axis = new Vector3(0, 0, -1).cross(dB);
        const s = axis.length(), c = -dB.z;
        const ang = Math.atan2(s, c);
        if (s > 1e-9) axis.divideScalar(s);
        else if (c < 0) axis.set(0, 1, 0);
        want.copy(axis).multiplyScalar(Math.min(spec.maxRate * 0.5, ang * 1.6));
        want.z = 0;
      }
    }
    if (want) {
      // wheels accelerate towards the wanted rates
      const err = want.sub(wBody);
      const maxDw = spec.wheelAccel * dt;
      const L = err.length();
      if (L > maxDw) err.multiplyScalar(maxDw / L);
      wBody.add(err);
    }
    if (wBody.length() > spec.maxRate) wBody.setLength(spec.maxRate);
    ship.angVel.copy(wBody).applyQuaternion(ship.quat);
    const ang = ship.angVel.length() * dt;
    if (ang > 0) {
      ship.quat.premultiply(_q.setFromAxisAngle(_v.copy(ship.angVel).normalize(), ang));
      ship.quat.normalize();
    }
  }

  /** World direction the SAS holds (the autopilot's or Stop's aim while they fly), or null (stability: just kill rotation). */
  private sasDirection(): Vector3 | null {
    const D = this.core.frame, ship = this.ship;
    const flying = (this.autopilot ?? this.stopping)?.steering;
    if (flying) return flying.aim;
    const mode = this.sas;
    if (mode === 'stability' || mode === 'off') return null;
    if (mode === 'target' || mode === 'anti-target') {
      const sel = this.app.selection;
      if (!sel) return null;
      const d = sel.upos.sub(ship.upos, new Vector3()).normalize();
      return mode === 'target' ? d : d.negate();
    }
    if (!D) return null;
    const r = ship.upos.sub(D.upos, new Vector3());
    const v = ship.vel.clone().sub(D.vel);
    // near the ground prograde/retrograde follow the surface velocity (landing, take-off)
    if (this.readout.altitude < 30e3 && this.core.spin.lengthSq() > 0) v.sub(new Vector3().crossVectors(this.core.spin, r));
    if (v.lengthSq() < 1e-6) return null;
    const pro = v.clone().normalize();
    const nrm = new Vector3().crossVectors(r, v).normalize();
    const rad = new Vector3().crossVectors(nrm, pro).normalize(); // radial out, perpendicular to velocity
    switch (mode) {
      case 'prograde': return pro;
      case 'retrograde': return pro.negate();
      case 'normal': return nrm;
      case 'antinormal': return nrm.negate();
      case 'radial-out': return rad;
      case 'radial-in': return rad.negate();
    }
    return null;
  }

  // ------------------------------------------------------------------ events
  private handleEvent(ev: FlightEvent): void {
    const app = this.app;
    if (ev.kind !== 'land') this.autopilot = null;
    this.stopping = null;
    const name = ev.src?.name ?? 'the ground';
    const spd = fmtSpeed(ev.speed);
    if (ev.kind === 'land') {
      app.hud.toast(`Touchdown on ${name} at ${spd}`, 3);
      if (app.vr.active) app.vr.flash(`Touchdown on ${name}`);
      app.game.audio.chime();
      this.ship.throttle = 0;
      this.onEvent?.(ev);
      return;
    }
    const msgs: Record<string, [string, string]> = {
      crash: ['CRASHED', `You hit ${name} at ${spd}. Touch down slower than ${SHIP_SPEC.crashSpeed} m/s.`],
      burnup: ['BURNED UP', `The hull passed ${SHIP_SPEC.maxHullTemp} K. Enter the air more shallowly, or slow down first.`],
      spaghetti: ['TORN APART', `The tide of ${name} stretched the ship by more than 100 g across its ${SHIP_SPEC.length} m. A stellar black hole kills you long before its horizon.`],
      horizon: ['NO RETURN', `You crossed the event horizon of ${name}. Every path now leads inward; the universe you knew is behind you for ever.`],
    };
    const [title, text] = msgs[ev.kind];
    this.ending = { ev, t: ev.kind === 'horizon' ? 7 : 4.5, total: ev.kind === 'horizon' ? 7 : 4.5, title, text };
    this.endingT = 0;
    this.ship.throttle = 0;
    if (app.vr.active) app.vr.flash(title);
    app.game.audio.update(0, false);
    this.onEvent?.(ev);
  }

  private updateEnding(dt: number): void {
    const e = this.ending!;
    this.endingT += dt;
    e.t -= dt;
    const ship = this.ship;
    if (e.ev.kind === 'horizon' && e.ev.src) {
      // inside: drawn on towards the centre, the view tumbling slowly
      const rel = ship.upos.sub(e.ev.src.upos, new Vector3());
      ship.upos.copy(e.ev.src.upos).addVec(rel, Math.max(0.2, 1 - dt * 0.15));
      ship.quat.premultiply(_q.setFromAxisAngle(_v.set(0.3, 1, 0.2).normalize(), dt * 0.2));
    }
    if (e.t <= 0) this.respawn();
  }

  /** Back in one piece: a safe circular orbit about the body that ended the flight. */
  respawn(): void {
    const e = this.ending;
    this.ending = null;
    const core = this.core, ship = this.ship;
    const src = e?.ev.src ?? core.frame;
    ship.fuel = SHIP_SPEC.fuelMax;
    ship.hullTemp = 290;
    ship.heatFlux = 0;
    ship.throttle = 0;
    ship.angVel.set(0, 0, 0);
    core.landed = null;
    core.event = null;
    if (src) {
      core.frame = src;
      this.frameEnv();
      const top = core.atmosphere ? core.atmosphere.R0 + core.atmosphere.top : src.radius;
      let r = Math.max(src.radius * 1.15, top + 100e3, src.radius + 300e3);
      if (src.rs > 0) r = Math.max(30 * src.rs, 1.6 * Math.cbrt((2 * src.gm * SHIP_SPEC.length) / SHIP_SPEC.tidalLimit));
      if (src.obj instanceof Body && src.obj.kind === 'star') r = src.radius * 8;
      const rel = ship.upos.sub(src.upos, new Vector3());
      const n = core.spin.lengthSq() > 0 ? core.spin.clone().normalize() : new Vector3(0, -0.3978, 0.9175);
      core.setCircularOrbit(src, r, rel.lengthSq() > 0 ? rel : new Vector3(1, 0, 0), n);
      const vel = ship.vel.clone().sub(src.vel).normalize();
      ship.quat.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), vel, rel.clone().normalize()));
    }
    this.sas = 'stability';
    this.predictor.done = true;
    this.predictedFrom = null;
    const say = `Respawned in a safe orbit${src ? ` about ${src.name}` : ''}`;
    this.app.hud.toast(say, 3);
    if (this.app.vr.active) this.app.vr.flash(say);
  }

  // ------------------------------------------------------------------ prediction
  private updatePrediction(): void {
    const core = this.core, ship = this.ship, D = core.frame;
    if (!D || this.ending) { this.predictor.done = true; this.predictor.count = 0; this.pending = null; return; }
    const thrusting = ship.throttle > 0 || ship.rcs.lengthSq() > 0;
    this.predictTimer -= 1;
    const changed = D !== this.predictedFrom || (this.lastThrottle > 0 && ship.throttle === 0);
    this.lastThrottle = ship.throttle;
    const vr = this.app.vr.active;
    // a fresh prediction: when the situation changed, often while burning, now and then when coasting
    if (changed || (!this.pending && this.predictTimer <= 0) || (thrusting && this.predictTimer <= 0)) {
      const rel = ship.upos.sub(D.upos, new Vector3()), relVel = ship.vel.clone().sub(D.vel);
      this.pending = new Predictor();
      this.pending.start({
        frame: D, rel, relVel, sources: gravity.sources, groundR: core.groundR, atmosphere: core.atmosphere, spin: core.spin.clone(),
        cdA: SHIP_SPEC.cdA, mass: ship.mass, orbits: thrusting ? 1 : 3, maxTime: 2 * 365.25 * DAY, maxPoints: vr ? 900 : 2400,
      });
      this.predictedFrom = D;
      this.predictTimer = thrusting ? 4 : this.rails ? 3 : 45;
    }
    const p = this.pending;
    if (p) {
      // capped work per frame (Quest: ~0.2 ms)
      p.advance(vr ? 60 : 300);
      // shown once finished, or at once when the old path belongs to another body
      if (p.done || this.predictor.frame !== D) (this as { predictor: Predictor }).predictor = p;
      if (p.done) this.pending = null;
    }
  }
  private pending: Predictor | null = null;

  /** Live numbers for the HUD and the cockpit screens. */
  private fillReadout(): void {
    const r = this.readout, core = this.core, ship = this.ship, D = core.frame;
    r.frame = D?.name ?? 'deep space';
    r.gForce = ship.gForce;
    r.tidal = ship.tidal;
    r.throttle = ship.throttle;
    r.fuel = ship.fuel / SHIP_SPEC.fuelMax;
    r.drive = ship.drive;
    r.driveG = ship.driveAccel / G0;
    r.atLimit = core.atLimit;
    r.dv = ship.drive === 'reactionless' ? Infinity : SHIP_SPEC.isp * G0 * Math.log(ship.mass / SHIP_SPEC.dryMass);
    // speed against the frame body, and what it does to the view ahead: aberration crowds half the
    // sky into θ with tan θ = 1/(γβ); light ahead is bluer by the Doppler factor γ(1 + β) = e^η
    const w = core.relW.length();
    r.properSpeed = w;
    r.gamma = lorentz(core.relW);
    r.halfSky = Math.atan2(C, w);
    r.doppler = r.gamma + w / C;
    this.fillTarget();
    r.sas = this.sas;
    r.rails = this.rails;
    r.limited = this.limited;
    r.rate = this.app.clock.paused ? 0 : Math.min(Math.max(this.app.clock.rate, 0), MAX_RATE);
    r.asked = this.asked;
    r.why = this.why;
    r.dilation = ship.dilation;
    r.shipTime = ship.shipTime;
    r.universeTime = this.universeTime;
    r.heat = ship.heatFlux;
    r.hullTemp = ship.hullTemp;
    r.landed = core.landed ? core.landed.src.name : '';
    r.refusal = this.autopilotRefusal();
    r.conic = null;
    r.tImpact = r.tAp = r.tPe = r.ap = r.pe = NaN;
    r.escape = false;
    r.encounter = '';
    if (D) {
      const rel = ship.upos.sub(D.upos, new Vector3()), vel = ship.vel.clone().sub(D.vel);
      const rl = rel.length();
      r.altitude = rl - (core.groundR || D.radius);
      r.orbitSpeed = vel.length();
      r.vertSpeed = vel.dot(rel) / rl;
      r.surfSpeed = vel.clone().sub(new Vector3().crossVectors(core.spin, rel)).length();
      if (D.rs === 0) {
        r.conic = conicOf(rel, vel, D.gm);
        r.ap = r.conic.ra - (core.groundR || D.radius);
        r.pe = r.conic.rp - (core.groundR || D.radius);
        r.tAp = r.conic.tAp; r.tPe = r.conic.tPe;
        if (core.groundR > 0) r.tImpact = timeToRadius(rel, vel, D.gm, core.groundR);
      }
      // the numerical prediction knows better (black holes, several bodies, air)
      const p = this.predictor;
      if (p.frame === D && p.events.length) {
        const pe = p.events.find((e) => e.kind === 'pe'), ap = p.events.find((e) => e.kind === 'ap');
        const imp = p.events.find((e) => e.kind === 'impact' || e.kind === 'horizon');
        if (D.rs > 0) {
          if (pe) { r.pe = pe.r; r.tPe = pe.t; }
          if (ap) { r.ap = ap.r; r.tAp = ap.t; }
        }
        if (imp && (D.rs > 0 || core.atmosphere)) r.tImpact = imp.t;
        r.escape = p.events.some((e) => e.kind === 'escape');
        r.encounter = p.events.find((e) => e.kind === 'encounter')?.body?.name ?? '';
      }
      if (core.landed) r.tImpact = NaN;
    } else {
      r.altitude = Infinity;
      r.orbitSpeed = r.surfSpeed = ship.vel.length();
      r.vertSpeed = 0;
    }
    // warnings, most urgent first
    const lim = SHIP_SPEC.tidalLimit;
    r.warning = ''; r.warnLevel = 0;
    if (this.ending) { r.warning = this.ending.title; r.warnLevel = 2; }
    else if (ship.tidal > lim * 0.3) { r.warning = `TIDAL STRESS ${(ship.tidal / G0).toFixed(0)} g`; r.warnLevel = 2; }
    else if (D && D.rs > 0 && r.altitude < D.rs * 2) { r.warning = 'EVENT HORIZON CLOSE'; r.warnLevel = 2; }
    else if (ship.hullTemp > SHIP_SPEC.maxHullTemp * 0.75) { r.warning = `HULL ${Math.round(ship.hullTemp)} K`; r.warnLevel = 2; }
    else if (Number.isFinite(r.tImpact) && r.tImpact < 60 && !core.landed && r.surfSpeed > SHIP_SPEC.crashSpeed && (D?.rs ?? 0) === 0) { r.warning = `IMPACT IN ${Math.ceil(r.tImpact)} s — SLOW DOWN`; r.warnLevel = 2; }
    else if (ship.tidal > lim * 0.05) { r.warning = `TIDES ${(ship.tidal / G0).toFixed(1)} g`; r.warnLevel = 1; }
    else if (ship.hullTemp > 1200) { r.warning = 'RE-ENTRY HEATING'; r.warnLevel = 1; }
    else if (r.gForce > 6) { r.warning = `HIGH G ${r.gForce.toFixed(1)}`; r.warnLevel = 1; }
    else if (ship.drive === 'torch' && ship.fuel <= 0) { r.warning = 'PROPELLANT EXHAUSTED (I: reactionless drive)'; r.warnLevel = 1; }
    else if (core.atLimit) { r.warning = `DRIVE AT ITS LIMIT: γ ${fmtGamma(SHIP_SPEC.gammaMax)}`; r.warnLevel = 1; }
  }

  /** Distance and time to the selected target, in the ship's time and the universe's. */
  private fillTarget(): void {
    const r = this.readout, ship = this.ship, ap = this.autopilot;
    const sel = ap?.target ?? this.app.selection;
    r.apState = ap ? (ap.detour ? `round ${ap.detour}` : ap.steering.phase) : '';
    const stop = this.stopping;
    r.stop = stop ? `${stop.steering.phase} beside ${stop.at}` : '';
    r.stopTau = stop ? stop.steering.tauGo : NaN;
    if (!stop) this.held = false;
    r.autopilot = ap ? `${ap.target.name} · ${r.apState}` : '';
    r.target = sel?.name ?? '';
    r.targetDist = r.etaShip = r.etaUniverse = r.arrival = NaN;
    r.etaBy = '';
    if (!sel) return;
    const rel = sel.upos.sub(ship.upos, _g1);
    const d = rel.length();
    r.targetDist = Math.max(0, d - sel.radius);
    if (ap) {
      // the autopilot's own reckoning
      r.etaShip = ap.steering.tauGo;
      r.etaUniverse = ap.steering.tGo;
      r.arrival = Math.max(0, ap.radius - sel.radius);
      r.etaBy = 'flip-and-burn';
      return;
    }
    // the proper velocity towards it, in its own frame (a world's velocity; others counted at rest)
    const w = boostProper(ship.properVelocity(), _g2.copy(sel instanceof Body ? sel.vel : _zero).negate(), _g3);
    const toward = d > 0 ? w.dot(rel) / d : 0;
    if (ship.drive === 'reactionless' && ship.driveAccel > 0) {
      const fb = flipAndBurn(Math.max(0, d - this.arrivalRadius(sel)), ship.driveAccel, toward);
      r.etaShip = fb.tau;
      r.etaUniverse = fb.t;
      r.arrival = Math.max(0, this.arrivalRadius(sel) - sel.radius);
      r.etaBy = 'flip-and-burn';
    } else if (toward > 1) {
      // coasting straight at it: the universe sees d/v, the ship's clock γ times less
      r.etaUniverse = (r.targetDist * lorentz(w)) / toward;
      r.etaShip = r.targetDist / toward;
      r.etaBy = 'coasting';
    }
  }
}

/**
 * Angular velocity (rad/s, world) of a Solar System body: its IAU rotation rate about its pole, the
 * orbital rate for a tidally locked moon, or its catalogued period.
 */
export function spinOf(b: Body, out: Vector3): Vector3 {
  const e = b.orientation.elements;
  const pole = _p.set(e[8], e[9], e[10]).normalize();
  if (b.rotation) return out.copy(pole).multiplyScalar((b.rotation.pm[1] ?? 0) * (Math.PI / 180) / DAY);
  if (b.kind === 'moon' && b.parent) {
    const r = _r.copy(b.pos).sub(b.parent.pos), v = _w.copy(b.vel).sub(b.parent.vel);
    return out.crossVectors(r, v).divideScalar(r.lengthSq());
  }
  const h = b.meta.rotPeriodHours as number | undefined;
  return h ? out.copy(pole).multiplyScalar((2 * Math.PI) / (h * 3600)) : out.set(0, 0, 0);
}
const _p = new Vector3();
const _r = new Vector3();
const _w = new Vector3();

const SAS_LABEL: Record<SasMode, string> = {
  off: 'off', stability: 'hold attitude', prograde: 'prograde', retrograde: 'retrograde', normal: 'normal', antinormal: 'anti-normal',
  'radial-out': 'radial out', 'radial-in': 'radial in', target: 'target', 'anti-target': 'anti-target',
};
export function sasLabel(m: SasMode): string {
  return SAS_LABEL[m];
}

export function fmtSpeed(v: number): string {
  const a = Math.abs(v);
  if (a < 1000) return `${v.toFixed(a < 100 ? 1 : 0)} m/s`;
  if (a < 0.01 * C) return `${(v / 1000).toFixed(a < 1e5 ? 2 : 0)} km/s`;
  // (never "1.000 c": the nines past the third are fmtLight's, from the proper speed)
  return `${v < 0 ? '-' : ''}${a < 0.9995 * C ? (a / C).toFixed(3) : '0.999…'} c`;
}

/**
 * A speed given by its proper speed w = γv (which keeps every digit), as a fraction of light's
 * with as many nines as it takes: "0.999 999 999 999 999 999 5 c". Below 1 % of c, in m/s or km/s.
 */
export function fmtLight(w: number): string {
  const x = Math.abs(w) / C, g = Math.hypot(1, x);
  if (x < 0.01) return fmtSpeed(w / g);
  // 1 - β = 1/(γ(γ + γβ)), by logarithms (no overflow at any γ)
  const L = Math.log10(g) + Math.log10(g + x);
  if (L < 1) return `${(x / g).toFixed(4)} c`;
  const n = Math.floor(L);
  const rest = String(Math.round((1 - 10 ** (n - L)) * 100)).padStart(2, '0').replace(/0+$/, '');
  const digits = '9'.repeat(n) + rest;
  return `0.${digits.replace(/(\d{3})(?=\d)/g, '$1 ')} c`;
}

/** A Lorentz factor: "1 + 3.3×10⁻¹⁰" while it is near 1, then plain, then in powers of ten. */
export function fmtGamma(g: number): string {
  if (g < 1.001) return `1 + ${sci(g - 1)}`;
  if (g < 1e5) return g.toPrecision(5);
  return sci(g);
}

/** an acceleration in g: "1 g", "0.002 g", "50,000 g" */
export function fmtG(g: number): string {
  return `${g < 1 ? Number(g.toPrecision(3)) : Math.round(g).toLocaleString('en-US')} g`;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 3.3×10⁻¹⁰ */
function sci(x: number): string {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / 10 ** e;
  const exp = String(e).replace('-', '⁻').replace(/\d/g, (d) => SUP[Number(d)]);
  return `${m.toFixed(m < 9.95 ? 1 : 0)}×10${exp}`;
}

export function fmtDist(m: number): string {
  const a = Math.abs(m);
  if (!Number.isFinite(m)) return '∞';
  if (a < 1e4) return `${m.toFixed(0)} m`;
  if (a < 1e9) return `${(m / 1e3).toLocaleString(undefined, { maximumFractionDigits: a < 1e6 ? 1 : 0 })} km`;
  if (a < 0.05 * AU) return `${(m / 1e9).toFixed(2)} Gm`;
  if (a < 0.05 * LY) return `${(m / AU).toFixed(3)} AU`;
  // (the ship goes to other stars and galaxies: light years, four figures)
  const ly = m / LY;
  if (a < 1e6 * LY) return `${ly.toLocaleString('en-US', { maximumSignificantDigits: 4 })} ly`;
  return `${(ly / 1e6).toLocaleString('en-US', { maximumSignificantDigits: 4 })} million ly`;
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const neg = s < 0; s = Math.abs(s);
  let out: string;
  if (s < 60) out = `${s.toFixed(s < 10 ? 1 : 0)} s`;
  else if (s < 3600) out = `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
  else if (s < 86400) out = `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  else if (s < 86400 * 400) out = `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
  else out = fmtYears(s);
  return neg ? `-${out}` : out;
}

/** a long time in years: "3.58 yr", "2.54 million yr" */
function fmtYears(s: number): string {
  const y = s / 3.15576e7;
  if (y < 1e4) return `${y.toFixed(2)} yr`;
  if (y < 1e6) return `${Math.round(y).toLocaleString('en-US')} yr`;
  if (y < 1e9) return `${(y / 1e6).toFixed(2)} million yr`;
  return `${(y / 1e9).toFixed(2)} billion yr`;
}

/**
 * The ship's time warp: "×1", "×100,000"; a rate between the steps (held back by the autopilot or
 * the computing) to two figures, "×3,700".
 */
export function fmtWarp(x: number): string {
  const step = WARP_STEPS.find((w) => Math.abs(x - w) <= 0.005 * w);
  const v = step ?? Number(x.toPrecision(2));
  return `×${v.toLocaleString('en-US')}`;
}

/** Seconds of a clock per real second, in words: "real time", "17 minutes a second", "2,470 years a second". */
export function fmtPace(x: number): string {
  const n = (v: number) => v.toLocaleString('en-US', { maximumSignificantDigits: 3 });
  const Y = 3.15576e7;
  if (x <= 0) return 'stopped';
  if (Math.abs(x - 1) < 0.005) return 'real time';
  if (x >= 1e6 * Y) return `${n(x / Y / 1e6)} million years a second`;
  if (x >= Y) return `${n(x / Y)} years a second`;
  if (x >= 86400) return `${n(x / 86400)} days a second`;
  if (x >= 3600) return `${n(x / 3600)} hours a second`;
  if (x >= 60) return `${n(x / 60)} minutes a second`;
  return `${n(x)} seconds a second`;
}

export function fmtClock(s: number): string {
  if (s >= 3.15576e7) return fmtYears(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d > 0 ? `${d}d ` : ''}${p(h)}:${p(m)}:${p(sec)}`;
}

const _q = new Quaternion();
const _v = new Vector3();
const _zero = new Vector3();
const _g1 = new Vector3(), _g2 = new Vector3(), _g3 = new Vector3();
/** keys that take the controls back from the autopilot */
const MANUAL = ['KeyW', 'KeyS', 'KeyZ', 'KeyX', 'KeyA', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
