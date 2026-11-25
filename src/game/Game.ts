import { Matrix4, Quaternion, Vector3 } from 'three';
import { blackbodyRGB, luminance, magToIrradiance } from '../astro/photometry';
import { formatUtc } from '../core/time';
import { AU, formatDistance, formatSpeed, PC } from '../core/units';
import type { App } from '../app/App';
import { Body } from '../universe/Body';
import { ShipAudio } from './Audio';
import { Cockpit } from './Cockpit';
import { Missions } from './Missions';
import { LIGHT, ShipModel } from './ShipModel';
import { ShipArt } from './ShipArt';
import { Traffic, TrafficShip } from './Traffic';
import { HudMarkers } from './HudMarkers';
import { Station } from './Station';
import { ExoPlanet, type PlanetType } from '../universe/Planets';
import { Flight, fmtDist, fmtG, fmtGamma, fmtLight, fmtSpeed as fmtSpd, fmtTime, sasLabel } from './Flight';
import { FlightHud } from './FlightHud';
import { FlightViz } from './FlightViz';
import { C } from '../sim/Gravity';
import { G0 } from '../sim/ShipPhysics';

/** generated planet types with a surface to land on */
const SOLID_TYPES = new Set<PlanetType>(['lava', 'hot', 'desert', 'terran', 'ocean', 'ice']);

export type ViewMode = 'off' | 'cockpit' | 'chase';

function eta(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  if (s < 3.15e7 * 2) return `${(s / 86400).toFixed(0)} days`;
  return `${(s / 3.15576e7).toPrecision(3)} years`;
}

/**
 * Game mode: fly a ship. A cockpit (or a chase view of the ship on desktop) rides on the camera rig;
 * the rig switches to inertial flight; the ship's autopilot flies flip-and-burn on its reactionless
 * drive, never faster than light; fictional traffic orbits the world you are near; missions and a
 * discovery log track progress.
 */
export class Game {
  mode: ViewMode = 'off';
  readonly cockpit = new Cockpit();
  readonly ship = new ShipModel();
  readonly hud = new HudMarkers();
  readonly traffic = new Traffic();
  readonly audio = new ShipAudio();
  readonly missions: Missions;
  /** real-physics flight (on whenever you are in the ship) */
  readonly flight: Flight;
  readonly viz = new FlightViz();
  readonly flightHud: FlightHud;
  /** the ship's looks: light, drive, framing, the names' mask (ShipArt.ts) */
  readonly art: ShipArt;
  private hudTimer = 0;
  /** docking in progress: offset of the camera from the hold point when it started (station axes) */
  private docking: { station: Station; t: number; from: Vector3; q0: Quaternion } | null = null;
  /** station we are docked at */
  docked: Station | null = null;
  /** world we have touched down on */
  landed: Body | ExoPlanet | null = null;
  get isDocking(): boolean {
    return this.docking !== null;
  }
  /** seconds before the docking computer may engage again (after undocking) */
  private dockCooldown = 0;
  /** keys held when the docking computer engaged: they do not cancel it until released */
  private dockHeld = new Set<string>();

  constructor(private app: App) {
    // children of the camera dolly: they move with the explorer; in VR the head moves inside
    app.renderer.rig.add(this.cockpit.group, this.ship.group, this.hud.group);
    this.ship.group.position.set(0, -3.4, -22);
    this.ship.group.visible = false;
    app.renderer.scene.add(this.traffic.group);
    this.flight = new Flight(app);
    app.renderer.scene.add(this.viz.group);
    app.renderer.camera.add(this.viz.screen);
    this.flightHud = new FlightHud(app.hud.root, app.hud, {
      // (on a touch screen − and + choose the reactionless drive as they set it: the setting is its own)
      stepDrive: (up) => { this.flight.ship.drive = 'reactionless'; this.flight.stepDrive(up); },
      toggleDrive: () => this.flight.toggleDrive(),
      setThrottle: (x) => this.flight.setThrottle(x),
      stop: () => { this.flight.stop(); },
      toggleView: () => this.setMode(this.mode === 'chase' ? 'cockpit' : 'chase'),
      setSas: (mode) => this.flight.setSas(mode),
      setRcs: (x, y, z) => this.flight.touchRcs.set(x, y, z),
    });
    this.missions = new Missions(app);
    this.art = new ShipArt(app, this);
    this.missions.onComplete = (m) => {
      app.hud.toast(`Mission complete: ${m.title}!`);
      if (app.vr.active) app.vr.flash(`Mission complete: ${m.title}!`);
      this.audio.chime();
    };
  }

  get active(): boolean {
    return this.mode !== 'off';
  }

  private fovBefore = 50;

  setMode(m: ViewMode): void {
    if (m === 'chase' && this.app.vr.active) m = 'off';
    const was = this.mode;
    // desktop cockpit: a wider view, so the dashboard and canopy frame the scene
    if (m === 'cockpit' && this.mode !== 'cockpit') { this.fovBefore = this.app.rig.fov; this.app.rig.fov = Math.max(this.app.rig.fov, 72); }
    if (m !== 'cockpit' && this.mode === 'cockpit') this.app.rig.fov = this.fovBefore;
    this.mode = m;
    this.cockpit.group.visible = m === 'cockpit';
    this.hud.group.visible = m === 'cockpit';
    this.ship.group.visible = m === 'chase';
    this.app.rig.inertia = m === 'off' ? 0 : 1.2;
    let toReal = false;
    if (m === 'off') {
      // (the ship's time warp is not the explorer's: leaving, time goes back to real time, the date kept)
      if (this.flight.on && !this.app.clock.paused && this.app.clock.rate !== 1) { this.app.flightClock(); toReal = true; }
      this.flight.disable();
    } else if (!this.flight.on) {
      // a flight starts in real time (switching cockpit <-> chase keeps the flight going)
      this.app.flightClock();
      this.flight.enable();
    }
    this.flightHud.setVisible(m !== 'off' && !this.app.vr.active);
    if (m === 'off') {
      this.docked = null;
      this.docking = null;
      this.landed = null;
      this.traffic.setBody(null);
      this.audio.update(0, false);
    } else {
      this.audio.start();
    }
    // (on a touch screen, in the words of its controls)
    // (on a touch screen, in the words of its controls; a switch of view says only which view)
    const touch = this.app.input.touch, viewOnly = m !== 'off' && was !== 'off';
    const say = m === 'off' ? (toReal ? 'Ship mode off: time back to real time' : 'Ship mode off')
      : touch && viewOnly ? (m === 'chase' ? 'Chase view' : 'Cockpit view')
      : touch ? 'In the ship: drag to turn it, the lever is the thrust, Stop brakes; choose a place and Go there flies it'
      : m === 'cockpit' ? 'In the ship: real physics. W/S throttle, arrows or drag to turn, Y SAS mode, I reactionless drive, J autopilot, V view'
      : 'Chase view (V: switch)';
    this.app.hud.toast(say, m === 'cockpit' && !(touch && viewOnly) ? 4 : 2.2);
    if (this.app.vr.active) this.app.vr.flash(m === 'off' ? 'Ship mode off' : 'Real physics: left grip throttle, right stick steer, left stick RCS, stick click SAS');
  }

  /** V: off -> cockpit -> chase -> off (VR: cockpit on/off). */
  cycle(): void {
    const order: ViewMode[] = this.app.vr.active ? ['off', 'cockpit'] : ['off', 'cockpit', 'chase'];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
  }

  /** J: the ship's autopilot to the selected object (boarding first). */
  autopilot(): void {
    const sel = this.app.selection;
    if (!sel) { this.app.hud.toast('Select a destination first (click it, or search with Enter)'); return; }
    if (!this.active) this.setMode('cockpit');
    this.flight.autopilotTo(sel);
  }

  update(dt: number): void {
    this.missions.update(dt);
    this.art.update(dt);
    if (!this.active) return;
    const app = this.app, rig = app.rig;
    this.updateLight();
    // traffic around the world we ride along with
    // (riding along with a station or ship keeps the traffic of the world it orbits)
    const a = rig.anchor;
    const world = a instanceof Station || a instanceof TrafficShip ? a.body : a instanceof Body && a.kind !== 'star' ? a : null;
    this.traffic.setBody(world);
    this.traffic.update(rig.upos, app.clock.jdTdb, dt);
    const snapped = !!(this.docked || this.docking);
    this.updateDocking(dt);
    // the docking computer moved the camera after the stations were placed: place them again
    if (snapped || this.docking || this.docked) this.traffic.place(rig.upos);
    if (!this.flight.on) this.updateLanding(dt);
    this.updateFlightFx(dt);
    // engines and their sound
    const throttle = this.flight.on ? this.flight.ship.throttle * (this.flight.ship.fuel > 0 || this.flight.ship.drive === 'reactionless' ? 1 : 0)
      : Math.min(1, Math.abs(rig.thrust) * (app.input.keys.has('ShiftLeft') || app.input.keys.has('ShiftRight') ? 1 : 0.6));
    this.ship.setThrust(throttle);
    this.audio.update(throttle, true);
    // cockpit screens
    this.hudTimer -= dt;
    if (this.hudTimer <= 0 && this.mode === 'cockpit') {
      this.hudTimer = 0.2;
      this.fillReadout();
    }
    // (on a touch screen the instruments over the view say what the dashboard's screens would, readably:
    // the screens stay dark there; the headset and the desk keep them)
    this.cockpit.setScreens(app.vr.active || !app.input.touch);
    this.cockpit.update(dt);
    this.holdCockpit();
    if (this.mode === 'cockpit') this.updateHud();
  }

  /** Predicted path, g-force vignette, re-entry plasma, end-of-flight fades and the desktop instruments. */
  private updateFlightFx(dt: number): void {
    const app = this.app, f = this.flight;
    if (!f.on) { this.viz.update(null, null, app.rig.upos, app.view.quat, app.view.pixelAngle, false); this.viz.setEffects(0, 0, 0, 0, [0, 0, 0], 0); return; }
    const r = f.readout, ship = f.ship;
    const D = f.core.frame;
    const travelling = app.rig.autopilot || app.vr.traveling;
    // (apsides are given as heights over the surface; for a black hole, from its centre)
    const R = D && D.rs === 0 ? f.core.groundR || D.radius : 0;
    this.viz.update(f.predictor, f.predictor.frame?.upos ?? null, app.rig.upos, app.view.quat, app.view.pixelAngle, !travelling && !!D, R);
    // (no tag of the orbit's under the interface's cards and chips, nor half off the screen)
    if (!app.vr.active) this.viz.clearOf(app.hud.covers(), (p) => app.project(p), app.view.width, app.view.height);
    this.viz.fitScreen(app.renderer.camera, app.vr.active, app.view.cx, app.view.cy);
    // vignette from about 3 g (gentle: comfort in VR), red-out from tides
    const vig = Math.max(0, Math.min(1, (r.gForce - 3) / 7)) * (app.vr.active ? 0.6 : 1) + Math.min(0.6, r.tidal / (100 * G0));
    const plasma = Math.max(0, Math.min(1, Math.log10(Math.max(ship.heatFlux, 1) / 3e4) / 2));
    let fade = 0, fadeCol: [number, number, number] = [0, 0, 0];
    const e = f.ending;
    if (e) {
      const t = f.endingT;
      if (e.ev.kind === 'horizon') fade = Math.min(1, t / (e.total * 0.6));
      else { fadeCol = e.ev.kind === 'spaghetti' ? [0.6, 0.05, 0.02] : [1, 0.85, 0.7]; fade = Math.max(0.55, 1 - t * 0.5); }
      if (e.t < 0.6) fade *= e.t / 0.6;
    }
    this.viz.setEffects(vig, Math.min(1, r.tidal / (30 * G0)), plasma, fade, fadeCol, performance.now() / 1000);
    if (!app.vr.active) {
      this.flightHud.setVisible(true);
      this.flightHud.update(dt, r, this.mode === 'cockpit' || this.mode === 'chase', this.mode === 'chase' ? 'chase' : 'cockpit');
      this.flightHud.setEnd(e?.report ?? null, e ? Math.min(1, f.endingT * 2) * (e.t < 0.6 ? e.t / 0.6 : 1) : 0, e ? Math.ceil(e.t) : 0);
    } else this.flightHud.setVisible(false);
    if (app.vr.active && r.warnLevel === 2 && r.warning !== this.lastVrWarn) app.vr.flash(r.warning);
    this.lastVrWarn = r.warning;
  }
  private lastVrWarn = '';

  /**
   * The cockpit's frame and dashboard are part of the screen, not of the world: when the optical
   * centre moves off the middle of the view (App.updateCentre) they stay where they are. A shear of
   * the cockpit about the eye does it exactly: x -> x - a z, y -> y - b z moves every point's
   * tangent-plane position by (a, b), as the shifted frustum moves the world's.
   */
  private holdCockpit(): void {
    const g = this.cockpit.group, v = this.app.view;
    const k = (2 * Math.tan((v.fovY * Math.PI) / 360)) / v.height;
    const a = v.xr ? 0 : -v.cx * k, b = v.xr ? 0 : v.cy * k;
    g.matrixAutoUpdate = false;
    g.matrix.set(1, 0, -a, 0, 0, 1, -b, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    g.matrixWorldNeedsUpdate = true;
  }

  /** Canopy markers: target bracket, flight-path marker. */
  private updateHud(): void {
    const app = this.app, rig = app.rig;
    const inv = rig.quat.clone().invert();
    const sel = app.selection;
    let tdir: Vector3 | null = null, text = '', pin: number | null | undefined;
    if (sel && !this.docked) {
      const rel = sel.upos.sub(rig.upos, new Vector3());
      const d = rel.length();
      // (its bracket and distance, 96 x 72 CSS px about it, not under the interface nor off the screen:
      // otherwise pinned at the edge of the part of the view the interface leaves clear, pointing the way)
      const p = app.vr.active ? null : app.project(rel);
      const covers = app.hud.covers();
      const box = p && { l: p.x - 48, r: p.x + 48, t: p.y - 36, b: p.y + 44 };
      const clear = app.vr.active || (!!box && box.l >= 0 && box.t >= 0 && box.r <= app.view.width && box.b <= app.view.height
        && !covers.some((c) => box.l < c.r + 4 && box.r > c.l - 4 && box.t < c.b + 4 && box.b > c.t - 4));
      if (clear) {
        tdir = rel.normalize().applyQuaternion(inv);
        if (!app.vr.active) pin = null;
      } else {
        const e = this.edgePin(rel.applyQuaternion(inv), p);
        tdir = e.dir;
        pin = e.arrow;
      }
      text = `${sel.name}|${formatDistance(Math.max(0, d - sel.radius))}`;
    }
    const v = rig.vel;
    const vdir = v.lengthSq() > 1e-6 && rig.speed > 0.5 ? v.clone().normalize().applyQuaternion(inv) : null;
    this.hud.update(tdir, text, vdir, pin);
  }

  /**
   * Where the target's brackets go when they cannot be drawn on it (behind the ship, off the side,
   * or under a card or a control): on the edge of the clear part of the view (Hud.clearPart; the
   * whole view without one), as far from its middle as the brackets fit, on the side of the target:
   * its own side of the screen, or the side it lies to when it is behind. `camRel`: the vector to it
   * in the camera's axes, `p` where it is on the screen (null behind the camera). Returns the
   * direction in the camera's axes that the point on the screen has, and the arrow's step.
   */
  private edgePin(camRel: Vector3, p: { x: number; y: number } | null): { dir: Vector3; arrow: number } {
    const app = this.app, v = app.view, W = v.width, H = v.height;
    const part = app.hud.clearPart()?.box ?? { l: 0, t: 0, r: W, b: H };
    // (room for the brackets' 96 x 80 about the point, and the margin that markers keep)
    const il = part.l + 52, ir = part.r - 52, it = part.t + 40, ib = part.b - 48;
    const mx = il < ir ? (il + ir) / 2 : (part.l + part.r) / 2, my = it < ib ? (it + ib) / 2 : (part.t + part.b) / 2;
    const hw = Math.max(0, (ir - il) / 2), hh = Math.max(0, (ib - it) / 2);
    let dx = p ? p.x - mx : camRel.x, dy = p ? p.y - my : -camRel.y;
    if (Math.hypot(dx, dy) < 1e-6) { dx = 0; dy = 1; }
    const s = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
    const px = mx + dx * s, py = my + dy * s;
    const k = (2 * Math.tan((v.fovY * Math.PI) / 360)) / H;
    const dir = new Vector3((px - W / 2 - v.cx) * k, (H / 2 + v.cy - py) * k, -1).normalize();
    return { dir, arrow: ((Math.round((Math.atan2(dy, dx) * 12) / Math.PI) % 24) + 24) % 24 };
  }

  /** Where a docked ship sits: 14 m in front of the port, on the hub axis. */
  private holdPoint(st: Station): Vector3 {
    return st.port().sub(this.app.rig.upos, new Vector3()).addScaledVector(st.axis, 14);
  }

  private holdQuat(st: Station): Quaternion {
    // facing the port along the axis; "up" fixed in the station frame
    const fwd = st.axis.clone().negate();
    const up = Math.abs(fwd.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), fwd, up));
  }

  private updateDocking(dt: number): void {
    const app = this.app, rig = app.rig;
    // (VR: the grip throttle; in physics flight the engine is held at zero while the computer flies)
    for (const k of this.dockHeld) if (!app.input.keys.has(k)) this.dockHeld.delete(k);
    const moving = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyR', 'KeyF'].some((k) => app.input.keys.has(k) && !this.dockHeld.has(k)) || Math.abs(rig.thrust) > 0.05 || (this.flight.on && this.flight.gripThrottle > 0.05);
    if (this.flight.on && (this.docked || this.docking)) this.flight.ship.throttle = 0;
    this.dockCooldown = Math.max(0, this.dockCooldown - dt);
    if (this.docked) {
      const st = this.docked;
      if (moving || !this.traffic.stations.includes(st)) {
        this.docked = null;
        this.dockCooldown = 20;
        rig.upos.addVec(st.axis, 25);
        app.hud.toast(`Undocked from ${st.name}`);
        return;
      }
      rig.upos.addVec(this.holdPoint(st));
      rig.stop();
      return;
    }
    if (this.docking && moving && this.docking.t > 0.15) {
      // the pilot takes the controls back
      this.docking = null;
      this.dockCooldown = 10;
      app.hud.toast('Docking cancelled');
    }
    if (this.docking) {
      const d = this.docking;
      d.t = Math.min(1, d.t + dt / 3.5);
      const s = d.t * d.t * (3 - 2 * d.t);
      const target = this.holdPoint(d.station);
      rig.upos.addVec(target.addScaledVector(d.from, 1 - s));
      rig.quat.copy(d.q0).slerp(this.holdQuat(d.station), s);
      rig.stop();
      if (d.t >= 1) {
        this.docked = d.station;
        this.docking = null;
        app.hud.toast(`Docked at ${d.station.name}. Thrust to undock.`);
        if (app.vr.active) app.vr.flash(`Docked at ${d.station.name}`);
        this.audio.chime();
      }
      return;
    }
    if (rig.autopilot || app.vr.traveling || this.dockCooldown > 0) return;
    for (const st of this.traffic.stations) {
      const rel = rig.upos.sub(st.port(), new Vector3());
      const dist = rel.length();
      // physics flight: within 40 km, velocity matched to the station (< 150 m/s) and thrusting
      // towards it (or the autopilot flying to it), the docking computer takes over; otherwise in
      // front of the port, on the axis, slow
      const f = this.flight;
      const flightDock = f.on && dist < 40e3 && (f.ship.throttle > 0 || f.autopilot?.target === st)
        && f.ship.vel.clone().sub(st.body.vel).sub(st.vel).length() < 150;
      if (!flightDock && (dist > 400 || dist < 1)) continue;
      if (flightDock || (rel.dot(st.axis) / dist > 0.75 && rig.speed < 400)) {
        const hold = this.holdPoint(st);
        this.docking = { station: st, t: 0, from: hold.negate(), q0: rig.quat.clone() };
        this.dockHeld = new Set([...app.input.keys]);
        this.flight.ship.throttle = 0;
        app.hud.toast(`Docking computer engaged: ${st.name}`);
        break;
      }
    }
  }

  /** Touch down when coming in slowly over a solid surface. */
  private updateLanding(dt: number): void {
    const app = this.app, rig = app.rig;
    void dt;
    const a = rig.anchor;
    if (this.landed) {
      if (a !== this.landed || rig.altitude > 40) { this.landed = null; app.hud.toast('Lift-off'); }
      return;
    }
    const solid = (a instanceof Body && a.kind !== 'star' && !a.isGasGiant) || (a instanceof ExoPlanet && SOLID_TYPES.has(a.spec.type));
    if (!solid || this.docked) return;
    // (flight speed already scales with altitude, so coming down to 10 m is a gentle touchdown)
    if (rig.altitude < 10 && !rig.autopilot) {
      this.landed = a;
      rig.stop();
      // level the ship: local vertical up
      const up = rig.upos.sub(a.upos, new Vector3()).normalize();
      const fwd = rig.forward(new Vector3());
      const flat = fwd.sub(up.clone().multiplyScalar(fwd.dot(up))).normalize();
      if (flat.lengthSq() > 0.5) rig.quat.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), flat, up));
      app.hud.toast(`Touchdown on ${a.name}!`);
      if (app.vr.active) app.vr.flash(`Touchdown on ${a.name}!`);
      this.audio.chime();
    }
  }

  private fillReadout(): void {
    const app = this.app, rig = app.rig, r = this.cockpit.readout;
    r.speed = formatSpeed(rig.speed);
    r.throttle = rig.thrust;
    r.drive = app.input.keys.has('ShiftLeft') || app.input.keys.has('ShiftRight') ? 'BOOST' : '';
    r.altitude = formatDistance(rig.altitude);
    r.reference = this.docked ? `DOCKED · ${this.docked.name}` : this.landed ? `LANDED · ${this.landed.name}` : rig.anchor?.name ?? 'deep space';
    const sel = app.selection;
    if (sel) {
      const d = sel.upos.sub(rig.upos, new Vector3()).length();
      r.target = sel.name;
      r.targetKind = sel.info()[0]?.[1] ?? sel.kind;
      r.distance = formatDistance(Math.max(0, d - sel.radius));
      r.eta = rig.speed > 1 ? `at this speed: ${eta(d / rig.speed)}` : 'J: autopilot';
      r.autopilot = 'ready';
    } else {
      r.target = 'none';
      r.targetKind = 'click something to target it';
      r.distance = '';
      r.eta = '';
      r.autopilot = 'no target';
    }
    r.time = `${formatUtc(app.clock.jdTdb).slice(0, 16)} · ${app.clock.paused ? 'paused' : app.rateText()}`;
    r.missions = `${this.missions.doneCount} / ${this.missions.total} complete`;
    r.hint = app.vr.active ? 'L grip: throttle · R stick: steer · L stick: RCS · A: autopilot' : 'W/S throttle · Y SAS · I drive · J autopilot · V view';
    const f = this.flight;
    if (f.on) {
      const fr = f.readout;
      r.speed = fmtLight(fr.properSpeed);
      r.throttle = fr.throttle;
      r.drive = fr.drive === 'reactionless' ? `REACTIONLESS ${fmtG(fr.driveG)}` : 'TORCH';
      r.altitude = fmtDist(fr.altitude);
      r.reference = this.docked ? r.reference : fr.landed ? `LANDED · ${fr.landed}` : `orbiting ${fr.frame}`;
      if (fr.target) {
        r.eta = Number.isFinite(fr.etaShip) ? `${fr.etaBy}: ${fmtTime(fr.etaShip)} aboard, ${fmtTime(fr.etaUniverse)} in the universe` : 'J: autopilot';
        r.autopilot = fr.autopilot ? 'flying' : 'ready';
      }
      // fast, the orbit matters less than the speed and the clocks
      const fast = fr.properSpeed > 0.01 * C;
      r.flight = {
        lines: fast ? [
          `${r.speed}`,
          `γ ${fmtGamma(fr.gamma)}`,
          Number.isFinite(fr.etaShip) ? `to go ${fmtTime(fr.etaShip)} · univ ${fmtTime(fr.etaUniverse)}` : `${fr.frame}`,
        ] : [
          `Ap ${Number.isFinite(fr.ap) ? fmtDist(fr.ap) : '—'}  ${Number.isFinite(fr.tAp) ? fmtTime(fr.tAp) : ''}`,
          `Pe ${Number.isFinite(fr.pe) ? fmtDist(fr.pe) : '—'}  ${Number.isFinite(fr.tPe) ? fmtTime(fr.tPe) : ''}`,
          Number.isFinite(fr.tImpact) && !fr.landed ? `IMPACT in ${fmtTime(fr.tImpact)}` : `surface ${fmtSpd(fr.surfSpeed)}  vert ${fmtSpd(fr.vertSpeed)}`,
        ],
        g: `${fr.gForce.toFixed(1)} g`,
        sas: fr.autopilot ? 'autopilot' : sasLabel(fr.sas),
        fuel: fr.drive === 'reactionless' ? 1 : fr.fuel,
        clocks: `ship ${fmtTime(fr.shipTime)} · univ ${fmtTime(fr.universeTime)}${fr.dilation < 0.9999 ? ` · ×${fr.dilation.toPrecision(3)}` : ''}`,
        warning: fr.warning,
        lock: fr.refusal ? 'DRIVE TOO WEAK' : '',
      };
    } else r.flight = null;
  }

  /** Light the cockpit and ship by the nearest star (or faintly, in deep space). */
  private updateLight(): void {
    const app = this.app, rig = app.rig;
    const sun = app.system.sun;
    const toSun = sun.upos.sub(rig.upos, new Vector3());
    let dir = toSun.clone().normalize(), E = Math.PI * (AU / Math.max(toSun.length(), 1)) ** 2, teff = sun.teff;
    for (const s of app.near.stars) {
      const rel = s.upos.sub(rig.upos, new Vector3());
      const Es = magToIrradiance(s.absMag + 5 * Math.log10(Math.max(rel.length(), 1) / PC) - 5);
      if (Es > E) { E = Es; dir = rel.normalize(); teff = s.teff; }
    }
    LIGHT.uSunDir.value.copy(dir);
    LIGHT.uSun.value = Math.max(0, Math.min(1.3, 1 + 0.25 * Math.log10(E / Math.PI)));
    const c = blackbodyRGB(teff), l = luminance(c);
    LIGHT.uSunColor.value.set(c[0] / l, c[1] / l, c[2] / l);
  }

  /** Objects whose shaders the app compiles up front. */
  warmupObjects() {
    return [this.cockpit.group, this.ship.group];
  }
}
