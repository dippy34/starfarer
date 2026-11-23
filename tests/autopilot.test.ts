import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { UPos } from '../src/core/upos';
import { autopilotRate, brake, climb, climbSpeed, type ClimbSituation, inTheWay, placeSlot, type Situation, steer, type Steering } from '../src/game/Autopilot';
import { C, GravityField, makeSource, type GravitySource } from '../src/sim/Gravity';
import { flipAndBurn } from '../src/sim/Relativity';
import { FlightCore, G0, SHIP_SPEC } from '../src/sim/ShipPhysics';

const YEAR = 365.25 * 86400;

/** a target that moves in a straight line, or as `move` moves it */
interface Target { upos: UPos; vel: Vector3; move?: (dt: number) => void }
const NOSE = new Vector3(0, 0, -1);

/**
 * Flies the autopilot as Flight does, frame by frame: `realDt` seconds of real time a frame, the
 * pilot's time warp `rate` (held back by autopilotRate), the nose turned by the reaction wheels at
 * the SAS's 0.5 rad/s, the target moved along its path after each step. Returns what happened.
 */
function flyTo(core: FlightCore, target: GravitySource | Target, radius: number, gm: number, rate: number, realDt: number, maxFrames: number, worlds: GravitySource[] = []) {
  const ship = core.ship;
  const sit: Situation = { rel: new Vector3(), w: new Vector3(), slotAccel: new Vector3(), gravity: new Vector3(), nose: new Vector3(), drive: ship.driveAccel, rcs: SHIP_SPEC.rcsThrust / ship.mass, dt: 0, radius, orbit: 0 };
  const st: Steering = { aim: NOSE.clone().applyQuaternion(ship.quat), throttle: 0, rcs: new Vector3(), turning: false, tauGo: Infinity, tGo: Infinity, phase: 'turning', arrived: false };
  let frames = 0, closest = Infinity, universe = 0, skim = Infinity;
  for (; frames < maxFrames; frames++) {
    core.chooseFrame();
    const round = new Vector3(), w = inTheWay(ship.upos, ship.vel, target, worlds, round);
    sit.radius = w ? 0 : radius;
    if (w) placeSlot(sit, ship.upos.sub(w.upos, new Vector3()).sub(round), ship.properVelocity(), w.vel, 0, 0, null);
    else placeSlot(sit, ship.upos.sub(target.upos, new Vector3()), ship.properVelocity(), target.vel, gm, 0, null);
    core.field.gravityAt(ship.upos, sit.gravity).sub(core.field.gravityAt((w ?? target).upos, new Vector3()));
    sit.nose.copy(NOSE).applyQuaternion(ship.quat);
    steer(sit, st);
    if (st.arrived && !w) break;
    ship.throttle = st.throttle;
    ship.rcs.copy(st.rcs).applyQuaternion(ship.quat.clone().invert()).divideScalar(sit.rcs).clampScalar(-1, 1);
    // the wheels turn the nose towards the aim (in real time)
    const nose = sit.nose, ang = nose.angleTo(st.aim);
    if (ang > 1e-9) {
      const axis = nose.clone().cross(st.aim);
      if (axis.lengthSq() < 1e-18) axis.set(0, 1, 0);
      ship.quat.premultiply(new Quaternion().setFromAxisAngle(axis.normalize(), Math.min(ang, 0.5 * realDt)));
    }
    const dt = core.universeTimeFor(realDt * autopilotRate(rate, st, realDt, ship.driveAccel));
    sit.dt = dt;
    core.step(dt);
    if ('move' in target && target.move) target.move(dt);
    else target.upos.addVec(target.vel, dt);
    core.place();
    universe += dt;
    closest = Math.min(closest, ship.upos.sub(target.upos, new Vector3()).length());
    for (const w of worlds) skim = Math.min(skim, ship.upos.sub(w.upos, new Vector3()).length() / w.radius);
    if (core.event) break;
  }
  return { st, frames, closest, universe, skim, event: core.event };
}

describe('the autopilot', () => {
  it('flies from high over the Earth to the Moon and arrives in orbit about it, without passing it', () => {
    const field = new GravityField();
    const earth = makeSource({ name: 'Earth', gm: 3.986004418e14, radius: 6.371e6, upos: UPos.from(1.5e11, 0, 0) });
    const moon = makeSource({ name: 'Moon', gm: 4.9048695e12, radius: 1.7374e6, upos: UPos.from(1.5e11 + 3.844e8, 0, 0), vel: new Vector3(0, 1022, 0) });
    earth.soi = Infinity;
    moon.parent = earth;
    moon.soi = 6.6e7;
    field.sources = [earth, moon];
    const core = new FlightCore(field);
    core.setCircularOrbit(earth, 12 * earth.radius, new Vector3(-1, 0.3, 0), new Vector3(0, 0, 1));
    core.ship.drive = 'reactionless';
    core.ship.driveAccel = 10 * G0;
    const radius = 3.5 * moon.radius;
    const r = flyTo(core, moon, radius, moon.gm, 1000, 0.2, 4000);
    expect(r.event).toBeNull();
    expect(r.st.arrived).toBe(true);
    // never inside the arrival sphere by more than a little (no fly-by), never near the ground
    expect(r.closest).toBeGreaterThan(0.9 * radius);
    // and in orbit: the speed relative to the Moon is the circular one, within a few per cent
    const v = core.ship.vel.clone().sub(moon.vel).length();
    expect(Math.abs(v / Math.sqrt(moon.gm / radius) - 1)).toBeLessThan(0.05);
    expect(r.universe).toBeLessThan(3 * 3600);
  });

  it('goes round a world in the way of the straight path (straight through it, it crashes)', () => {
    const field = new GravityField();
    const moon = makeSource({ name: 'Moon', gm: 4.9048695e12, radius: 1.7374e6, upos: UPos.from(1.5e11, 0, 0) });
    field.sources = [moon];
    const flight = (worlds: GravitySource[]) => {
      const core = new FlightCore(field);
      core.setCircularOrbit(moon, 6 * moon.radius, new Vector3(-1, 0, 0), new Vector3(0, 0, 1));
      core.groundR = moon.radius;
      core.ship.drive = 'reactionless';
      core.ship.driveAccel = 100 * G0;
      // a point on the far side, as far out (held there: the test does not ask the ship to come to
      // rest beside it, which a point that does not fall makes impossible, only to get there)
      const far = { upos: moon.upos.clone().addXYZ(6 * moon.radius, 0, 0), vel: new Vector3() };
      return { core, r: flyTo(core, far, 700, 0, 1000, 0.2, 6000, worlds) };
    };
    expect(flight([]).r.event?.kind).toBe('crash');
    const { r } = flight([moon]);
    expect(r.event).toBeNull();
    expect(r.closest).toBeLessThan(1000);
    // round the world, outside the sphere it keeps out of (1.3 radii)
    expect(r.skim).toBeGreaterThan(1.29);
  });

  it('flies from a high orbit to a station in a low one on the far side, at 100 g, without hitting the world', () => {
    // (the game's station flight: from 3.5 radii of the Moon to a station 400 km up behind it)
    const field = new GravityField();
    const moon = makeSource({ name: 'Moon', gm: 4.9048695e12, radius: 1.7374e6, upos: UPos.from(1.5e11, 0, 0) });
    field.sources = [moon];
    const core = new FlightCore(field);
    core.setCircularOrbit(moon, 3.5 * moon.radius, new Vector3(-1, 0.2, 0), new Vector3(0, 0, 1));
    core.groundR = moon.radius;
    core.ship.drive = 'reactionless';
    core.ship.driveAccel = 100 * G0;
    const rs = moon.radius + 400e3, n = Math.sqrt(moon.gm / rs ** 3);
    let th = 0.3;
    const station: Target = { upos: new UPos(), vel: new Vector3() };
    const place = () => {
      station.upos.copy(moon.upos).addXYZ(rs * Math.cos(th), rs * Math.sin(th), 0);
      station.vel.set(-Math.sin(th), Math.cos(th), 0).multiplyScalar(n * rs);
    };
    place();
    station.move = (dt) => { th += n * dt; place(); };
    const r = flyTo(core, station, 700, 0, 1000, 0.2, 20000, [moon]);
    expect(r.event).toBeNull();
    expect(r.st.arrived).toBe(true);
    expect(r.skim).toBeGreaterThan(1.2);
  });

  it('sees a world in the way only when the path passes it, and aims clear of it', () => {
    const moon = makeSource({ name: 'Moon', gm: 1, radius: 1, upos: new UPos() });
    const out = new Vector3(), still = new Vector3();
    const at = (x: number, y: number) => ({ upos: UPos.from(x, y, 0) });
    // the closest the chord from the ship to the detour point comes to the world's centre
    const clearance = (x: number, y: number) => {
      const s = new Vector3(x, y, 0), d = out.clone().sub(s);
      const k = Math.max(0, Math.min(1, -s.dot(d) / d.lengthSq()));
      return s.addScaledVector(d, k).length();
    };
    // behind it (far off, close by, from below the sphere it keeps out of), beside it, short of it
    expect(inTheWay(at(-5, 0).upos, still, at(5, 0.5), [moon], out)).toBe(moon);
    expect(out.length()).toBeCloseTo(5, 9);
    expect(out.y).toBeGreaterThan(0);
    expect(clearance(-5, 0)).toBeGreaterThan(1.3 - 1e-9);
    expect(inTheWay(at(-1.6, 0).upos, still, at(1.3, 0.01), [moon], out)).toBe(moon);
    expect(out.length()).toBeCloseTo(2.2, 9);
    expect(clearance(-1.6, 0)).toBeGreaterThan(1.3);
    expect(inTheWay(at(-1.05, 0).upos, still, at(3, -0.2), [moon], out)).toBe(moon);
    expect(out.x).toBeCloseTo(-2.2, 9);
    expect(inTheWay(at(-5, 0).upos, still, at(5, 3), [moon], out)).toBeNull();
    // the way is clear but the ship is heading into the world: in the way all the same
    expect(inTheWay(at(-5, 0).upos, new Vector3(1, 0, 0), at(5, 3), [moon], out)).toBe(moon);
    expect(inTheWay(at(-5, 0).upos, new Vector3(10, 3, 0), at(5, 3), [moon], out)).toBeNull();
    // a dive whose lowest point lies beyond the target's distance counts too
    expect(inTheWay(at(-1.3, 0).upos, new Vector3(1, -0.3, 0), at(-1.1, 0.6), [moon], out)).toBe(moon);
    expect(inTheWay(at(-5, 0).upos, still, at(-2, 0), [moon], out)).toBeNull();
    // the target itself is never in its own way (a source stands for its object)
    expect(inTheWay(at(-5, 0).upos, still, moon, [{ ...moon, obj: moon }], out)).toBeNull();
  });

  it('crosses 4.37 light years at 1 g in about the textbook time, arriving at rest', () => {
    const core = new FlightCore(new GravityField());
    core.ship.drive = 'reactionless';
    core.ship.driveAccel = G0;
    const d = 4.37 * C * YEAR;
    const star = { upos: core.ship.upos.clone().addXYZ(d * 0.6, d * 0.8, 0), vel: new Vector3() };
    const r = flyTo(core, star, 2e10, 0, 1e5, 0.1, 30000);
    expect(r.st.arrived).toBe(true);
    const fast = flipAndBurn(d, G0), planned = flipAndBurn(d, 0.8 * G0);
    expect(core.ship.shipTime).toBeGreaterThan(fast.tau);
    expect(core.ship.shipTime).toBeLessThan(planned.tau * 1.02);
    expect(r.universe).toBeGreaterThan(fast.t);
    expect(r.universe).toBeLessThan(planned.t * 1.02);
    expect(core.ship.properVelocity().length()).toBeLessThan(1);
  });

  it('flies to a galaxy at a million g, near light speed for millions of years of the universe', () => {
    const core = new FlightCore(new GravityField());
    core.ship.drive = 'reactionless';
    core.ship.driveAccel = 1e6 * G0;
    const d = 2.5e6 * C * YEAR;
    const galaxy = { upos: core.ship.upos.clone().addXYZ(0, 0, -d), vel: new Vector3() };
    const r = flyTo(core, galaxy, 1e20, 0, 1e5, 0.1, 8000);
    expect(r.st.arrived).toBe(true);
    expect(r.universe / YEAR).toBeGreaterThan(2.4e6);
    expect(core.ship.shipTime / 3600).toBeLessThan(2);
  });

  it('holds the warp to 1x while turning, to a twentieth of the time to go, to a tenth of the rapidity', () => {
    const st = { turning: true, tauGo: 1e6 } as Steering;
    expect(autopilotRate(1000, st, 0.1, G0)).toBe(1);
    st.turning = false;
    expect(autopilotRate(1e5, st, 0.1, G0)).toBe(1e5);
    st.tauGo = 100;
    expect(autopilotRate(1e5, st, 0.1, G0)).toBeCloseTo(50, 9);
    // (the last stretch: frames of up to 2 s of its time, and never below 1x)
    st.tauGo = 0.1;
    expect(autopilotRate(1e5, st, 0.1, G0)).toBeCloseTo(20, 9);
    expect(autopilotRate(1e5, st, 5, G0)).toBe(1);
    // at a million g, a tenth of the rapidity a frame: 3 s aboard
    st.tauGo = 1e6;
    expect(autopilotRate(1e5, st, 0.1, 1e6 * G0)).toBeCloseTo((0.1 * C) / (1e6 * G0) / 0.1, 9);
  });
});

/**
 * The climb out of the Earth's air as Flight flies it, from the ground (landed, nose along the
 * ground) or from `alt` metres up: the wheels turn the nose at 0.5 rad/s, time at `rate` held back
 * by autopilotRate, the air an exponential one (sea level 1.2 kg/m³, 8.5 km a scale height, 15 of
 * them to its top) turning with the world. Ends when the air is left, or at an event.
 */
function climbOut(driveG: number, alt: number, rate: number, frameDt = 0.05) {
  const field = new GravityField();
  const earth = makeSource({ name: 'Earth', gm: 3.986004418e14, radius: 6.371e6, upos: UPos.from(1.5e11, 0, 0) });
  field.sources = [earth];
  const core = new FlightCore(field);
  const H = 8500, top = 15 * H;
  core.atmosphere = { rho0: 1.2, H, R0: earth.radius, top };
  core.groundR = earth.radius;
  core.spin.set(0, 0, 7.292e-5);
  const ship = core.ship;
  ship.drive = 'reactionless';
  ship.driveAccel = driveG * G0;
  const rel = new Vector3(1, 0, 0);
  if (alt <= 0) {
    ship.upos.copy(earth.upos).addVec(rel, earth.radius);
    core.landed = { dir: rel.clone(), src: earth };
    ship.quat.setFromUnitVectors(NOSE, new Vector3(0, 1, 0));
  } else ship.upos.copy(earth.upos).addVec(rel, earth.radius + alt);
  ship.setProperVelocity(new Vector3().crossVectors(core.spin, rel.clone().multiplyScalar(earth.radius + Math.max(alt, 0))));
  core.chooseFrame();
  core.syncRel();
  const sit: ClimbSituation = { up: new Vector3(), air: new Vector3(), gravity: new Vector3(), nose: new Vector3(), height: 0, top, rho: 0, cdA: SHIP_SPEC.cdA, noseRadius: SHIP_SPEC.noseRadius, mass: 0, drive: ship.driveAccel, rcs: 0, dt: 0 };
  const st: Steering = { aim: NOSE.clone().applyQuaternion(ship.quat), throttle: 0, rcs: new Vector3(), turning: false, tauGo: Infinity, tGo: Infinity, phase: 'turning', arrived: false };
  let t = 0, peakTemp = 0, peakG = 0, peakSpeed = 0, over = 0, jump = 0, frames = 0, last = ship.upos.clone();
  for (; frames < 6000; frames++) {
    core.chooseFrame();
    const r = ship.upos.sub(earth.upos, new Vector3()), len = r.length();
    if (len >= core.atmosphere.R0 + top) break;
    sit.up.copy(r).divideScalar(len);
    sit.air.copy(ship.vel).sub(new Vector3().crossVectors(core.spin, r));
    core.field.gravityAt(ship.upos, sit.gravity);
    sit.nose.copy(NOSE).applyQuaternion(ship.quat);
    sit.height = len - core.atmosphere.R0;
    sit.rho = core.atmosphere.rho0 * Math.exp(-sit.height / H);
    sit.mass = ship.mass;
    sit.rcs = SHIP_SPEC.rcsThrust / ship.mass;
    climb(sit, st);
    ship.throttle = st.throttle;
    ship.rcs.copy(st.rcs).applyQuaternion(ship.quat.clone().invert()).divideScalar(sit.rcs).clampScalar(-1, 1);
    const ang = sit.nose.angleTo(st.aim);
    if (ang > 1e-9) {
      const axis = sit.nose.clone().cross(st.aim);
      if (axis.lengthSq() < 1e-18) axis.set(0, 1, 0);
      ship.quat.premultiply(new Quaternion().setFromAxisAngle(axis.normalize(), Math.min(ang, 0.5 * frameDt)));
    }
    const tau = frameDt * autopilotRate(rate, st, frameDt, ship.driveAccel);
    sit.dt = core.universeTimeFor(tau);
    core.step(sit.dt);
    core.place();
    t += tau;
    peakTemp = Math.max(peakTemp, ship.hullTemp);
    peakG = Math.max(peakG, ship.gForce);
    // (what the drive could have given it: its own acceleration for the time, from where it began)
    const speed = ship.vel.length();
    peakSpeed = Math.max(peakSpeed, speed);
    over = Math.max(over, ship.vel.clone().sub(new Vector3().crossVectors(core.spin, ship.upos.sub(earth.upos, new Vector3()))).length() - ship.driveAccel * t);
    jump = Math.max(jump, ship.upos.sub(last, new Vector3()).length() - (speed + 20) * sit.dt);
    last = ship.upos.clone();
    if (core.event) break;
  }
  const h = ship.upos.sub(earth.upos, new Vector3()).length() - earth.radius;
  return { event: core.event, h, top, t, frames, peakTemp, peakG, over, jump, landed: core.landed };
}

describe('the climb out of the air', () => {
  it('goes faster up thin air than thick, held by the heat and the drag, never past 4 km/s', () => {
    const v = (rho: number, spare = 30) => climbSpeed(rho, spare, SHIP_SPEC.cdA, SHIP_SPEC.noseRadius, 40000);
    expect(v(1.2)).toBeLessThan(800);
    expect(v(1.2)).toBeGreaterThan(100);
    expect(v(1e-3)).toBeGreaterThan(v(1.2));
    expect(v(1e-9)).toBe(4000);
    expect(v(0)).toBe(4000);
    // a drive with little to spare must push through the drag too: slower
    expect(v(1.2, 3)).toBeLessThan(v(1.2, 30));
  });

  it('lifts a landed ship out of the Earth\'s air at 5 g: cool, no more than the drive gives, no jump', () => {
    const r = climbOut(5, 0, 50);
    expect(r.event).toBeNull();
    expect(r.h).toBeGreaterThanOrEqual(r.top);
    expect(r.landed).toBeNull();
    expect(r.peakTemp).toBeLessThan(1800);
    expect(r.peakG).toBeLessThan(6);
    // (never faster against the air than its drive could have pushed it in that long)
    expect(r.over).toBeLessThan(1);
    expect(r.jump).toBeLessThan(1);
    // within a few minutes aboard
    expect(r.t).toBeLessThan(600);
  });

  it('climbs from 3 km up at 2 g too (a little to spare over gravity: slow, and still out)', () => {
    const r = climbOut(2, 3000, 50);
    expect(r.event).toBeNull();
    expect(r.h).toBeGreaterThanOrEqual(r.top);
    expect(r.peakTemp).toBeLessThan(1800);
    expect(r.over).toBeLessThan(1);
  });
});

/**
 * Stop, flown as Flight flies it: the situation is the ship's own place in the frame of `world`,
 * the wheels turn the nose at 0.5 rad/s of real time, the warp held back by autopilotRate; with
 * `stopAtRest`, done at rest (where nothing pulls Flight lets go there).
 */
function flyStop(core: FlightCore, world: GravitySource, rate: number, realDt: number, maxFrames: number, stopAtRest: boolean, onFrame?: (st: Steering) => void) {
  const ship = core.ship;
  const sit: Situation = { rel: new Vector3(), w: new Vector3(), slotAccel: new Vector3(), gravity: new Vector3(), nose: new Vector3(), drive: ship.driveAccel, rcs: SHIP_SPEC.rcsThrust / ship.mass, dt: 0, radius: 0, orbit: 0 };
  const st: Steering = { aim: NOSE.clone().applyQuaternion(ship.quat), throttle: 0, rcs: new Vector3(), turning: false, tauGo: Infinity, tGo: Infinity, phase: 'turning', arrived: false };
  let frames = 0, proper = 0;
  for (; frames < maxFrames; frames++) {
    core.chooseFrame();
    placeSlot(sit, new Vector3(), ship.properVelocity(), world.vel, 0, 0, null);
    core.field.gravityAt(ship.upos, sit.gravity).sub(core.field.gravityAt(world.upos, new Vector3()));
    sit.nose.copy(NOSE).applyQuaternion(ship.quat);
    brake(sit, st);
    onFrame?.(st);
    if (st.arrived && stopAtRest) break;
    ship.throttle = st.throttle;
    ship.rcs.copy(st.rcs).applyQuaternion(ship.quat.clone().invert()).divideScalar(sit.rcs).clampScalar(-1, 1);
    const nose = sit.nose, ang = nose.angleTo(st.aim);
    if (ang > 1e-9) {
      const axis = nose.clone().cross(st.aim);
      if (axis.lengthSq() < 1e-18) axis.set(0, 1, 0);
      ship.quat.premultiply(new Quaternion().setFromAxisAngle(axis.normalize(), Math.min(ang, 0.5 * realDt)));
    }
    const tau = realDt * autopilotRate(rate, st, realDt, ship.driveAccel);
    const dt = core.universeTimeFor(tau);
    sit.dt = dt;
    core.step(dt);
    world.upos.addVec(world.vel, dt);
    core.place();
    proper += tau;
    if (core.event) break;
  }
  return { st, frames, proper, event: core.event };
}

describe('Stop', () => {
  it('brakes a ship at γ = 10 to rest, in about the proper time it said, never faster than light', () => {
    const field = new GravityField();
    const star = makeSource({ name: 'Star', gm: 1.3e20, radius: 7e8, upos: UPos.from(0, 0, 0) });
    field.sources = [star];
    const core = new FlightCore(field);
    core.ship.upos.copy(UPos.from(3e15, 1e15, 0));
    core.ship.drive = 'reactionless';
    core.ship.driveAccel = 100 * G0;
    // γ = 10 along +x, nose pointing the way it goes (it has to turn round to brake)
    core.ship.setProperVelocity(new Vector3(Math.sqrt(99) * C, 0, 0));
    core.ship.quat.setFromUnitVectors(NOSE, new Vector3(1, 0, 0));
    core.syncRel();
    let said = NaN, fastest = 0;
    const r = flyStop(core, star, 1e5, 0.05, 200000, true, (st) => {
      if (Number.isNaN(said) && st.phase === 'braking') said = st.tauGo;
      fastest = Math.max(fastest, core.ship.vel.length());
    });
    expect(r.event).toBeNull();
    expect(r.st.arrived).toBe(true);
    expect(core.ship.properVelocity().length()).toBeLessThan(0.5);
    expect(fastest).toBeLessThan(C);
    // (c/a) asinh(γβ) at 100 g: 10.6 days aboard; the turn round and the gentle end add a little
    expect(said / ((C / (100 * G0)) * Math.asinh(Math.sqrt(99)))).toBeCloseTo(1, 2);
    expect(r.proper / said).toBeGreaterThan(0.99);
    expect(r.proper / said).toBeLessThan(1.1);
  });

  it('from a low orbit, comes to rest over the world and holds there against its pull', () => {
    const field = new GravityField();
    const earth = makeSource({ name: 'Earth', gm: 3.986004418e14, radius: 6.371e6, upos: UPos.from(1.5e11, 0, 0) });
    field.sources = [earth];
    const core = new FlightCore(field);
    core.groundR = earth.radius;
    core.setCircularOrbit(earth, earth.radius + 400e3, new Vector3(1, 0, 0), new Vector3(0, 0, 1));
    core.ship.drive = 'reactionless';
    core.ship.driveAccel = 5 * G0;
    const r = flyStop(core, earth, 1, 0.05, 6000, false);
    expect(r.event).toBeNull();
    const rel = core.ship.upos.sub(earth.upos, new Vector3());
    const v = core.ship.vel.clone().sub(earth.vel).length();
    expect(r.st.phase).toBe('holding');
    expect(v).toBeLessThan(0.5);
    // it fell a little while it braked (7.7 km/s at 4 g net), then held: still far above the ground
    expect(rel.length() - earth.radius).toBeGreaterThan(300e3);
    // holding: the drive pushes up against the Earth's 8.7 m/s² (a little more than a third of 5 g)
    expect(r.st.throttle).toBeGreaterThan(0.15);
    expect(r.st.throttle).toBeLessThan(0.2);
  });
});
