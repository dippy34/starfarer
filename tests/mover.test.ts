import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import { Mover } from '../src/app/Mover';
import { AIM_PER_CIRCLE, FLICK_PER_CIRCLE, orbitOf } from '../src/app/Powers';
import { SimClock } from '../src/core/time';
import type { Body } from '../src/universe/Body';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it, read from public/ as the browser fetches it.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const JD = 2461300.5; // 2026-09-17 (TDB)

/**
 * The mover with a camera of its own: an eye at `eye(sys)` looking at `aim(sys)`, a screen on
 * which a pixel is a thousandth of a radian, and each body a dot where it is seen from there.
 */
async function setup(eye: (s: SolarSystem) => Vector3, aim: (s: SolarSystem) => Vector3) {
  const sys = await SolarSystem.load('/data');
  await sys.ephemeris.request(JD);
  sys.update(JD);
  const named = (name: string) => sys.bodies.find((b) => b.name === name)!;
  const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
  const clock = new SimClock(JD);
  const at = eye(sys), to = aim(sys).sub(at).normalize();
  // the camera looks along its own -z, with x to the right and y up
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), to);
  const PIXEL = 1e-3;
  const rel = (b: Body) => b.pos.clone().sub(at);
  const project = (r: Vector3) => {
    const v = r.clone().applyQuaternion(quat.clone().invert());
    return v.z < 0 ? { x: 500 + v.x / -v.z / PIXEL, y: 500 - v.y / -v.z / PIXEL } : null;
  };
  const views = { get: (b: Body) => (b.valid ? { rel: rel(b), pixelRadius: Math.atan2(b.radius, rel(b).length()) / PIXEL } : undefined) };
  let told = 0, begun = 0, ended = 0, cancelled = 0;
  const placed: boolean[] = [];
  const mover = new Mover({
    rig: { ray: (x: number, y: number) => new Vector3((x - 500) * PIXEL, (500 - y) * PIXEL, -1).normalize().applyQuaternion(quat), upos: { toVector3: () => at.clone() } },
    physics, system: sys, clock, bodies: { views }, view: { quat, pixelRatio: 1 }, project, tellNews: () => { told++; },
    beginChange: () => { begun++; }, endChange: () => { ended++; }, cancelChange: () => { cancelled++; }, placed: (done: boolean) => { placed.push(done); },
  } as unknown as ConstructorParameters<typeof Mover>[0]);
  /** the pixel at which a place (m from the system's centre) is seen */
  const pixel = (p: Vector3) => project(p.clone().sub(at))!;
  return { sys, named, physics, clock, mover, pixel, told: () => told, gestures: () => [begun, ended], cancelled: () => cancelled, placed };
}

/** from far above the plane of the Moon's orbit, over the Earth */
const aboveTheMoon = (s: SolarSystem) => {
  const earth = s.byId.get(399)!, moon = s.byId.get(301)!;
  const normal = moon.pos.clone().sub(earth.pos).cross(moon.vel.clone().sub(earth.vel)).normalize();
  return earth.pos.clone().addScaledVector(normal, 3e9);
};

/** A finger's path: from (x0, y0) by (dx, dy) in `steps` moves `ms` apart, starting at time `t0` (ms); returns the time of the last. */
function drag(hold: { move(x: number, y: number, t: number): void }, x0: number, y0: number, dx: number, dy: number, steps: number, ms: number, t0: number): number {
  for (let k = 1; k <= steps; k++) hold.move(x0 + (dx * k) / steps, y0 + (dy * k) / steps, t0 + k * ms);
  return t0 + steps * ms;
}

describe('moving a world with a finger', () => {
  it('takes hold only of the world whose Move is on, and only where its dot is; time waits while it is held', async () => {
    const { named, mover, clock, pixel, physics, gestures } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const moon = named('Moon'), dot = pixel(moon.pos);
    expect(mover.grab(dot.x, dot.y, true, 0)).toBeNull();
    mover.toggle(moon);
    expect(mover.body).toBe(moon);
    // a finger reaches 30 px, a pointer 14
    expect(mover.grab(dot.x + 40, dot.y, true, 0)).toBeNull();
    expect(mover.grab(dot.x + 20, dot.y, false, 0)).toBeNull();
    const hold = mover.grab(dot.x + 20, dot.y, true, 0)!;
    expect(hold).not.toBeNull();
    expect(mover.holding).toBe(true);
    expect(clock.paused).toBe(true);
    // held but not moved: nothing has changed, and nothing is simulated yet
    expect(physics.on).toBe(false);
    hold.end(dot.x + 20, dot.y, 200, false);
    expect(mover.holding).toBe(false);
    expect(clock.paused).toBe(false);
    // (the hold is one change for Undo and the watch, begun when it took hold and ended when it let go)
    expect(gestures()).toEqual([1, 1]);
    mover.toggle(moon);
    expect(mover.body).toBeNull();
  });

  it('puts the Moon where the finger goes, in the plane of its orbit: to twice its distance, with the velocity it had', async () => {
    const { named, mover, pixel, physics, told } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const earth = named('Earth'), moon = named('Moon');
    const r = moon.pos.clone().sub(earth.pos), v = moon.vel.clone();
    mover.toggle(moon);
    expect(mover.describe(moon).plane).toBe('It moves in the plane of its orbit.');
    const from = pixel(moon.pos), to = pixel(earth.pos.clone().addScaledVector(r, 2));
    // (taken hold of 12 px off its middle: it does not jump under the finger)
    const hold = mover.grab(from.x + 12, from.y, true, 0)!;
    hold.move(from.x + 12, from.y, 16);
    expect(moon.pos.clone().sub(earth.pos).distanceTo(r) / r.length()).toBeLessThan(1e-9);
    const t = drag(hold, from.x + 12, from.y, to.x - from.x, to.y - from.y, 10, 16, 16);
    // (let go fast: away from Throw and from putting a world in place, a hold that lifts still moving is no flick)
    hold.end(to.x + 12, to.y, t, false);
    expect(physics.on).toBe(true);
    expect(told()).toBeGreaterThan(0);
    const now = moon.pos.clone().sub(earth.pos);
    expect(now.length() / r.length()).toBeCloseTo(2, 6);
    expect(now.clone().normalize().dot(r.clone().normalize())).toBeCloseTo(1, 9);
    expect(moon.vel.distanceTo(v)).toBeLessThan(1e-6);
    // twice as far out with the speed of its old orbit: about escape speed there, and the card says what it is on now
    expect(mover.describe(moon).orbit).toMatch(/^Now (round Earth: a long oval, .* to .* · .*\.|on an open path past Earth: it passes at .*, then leaves\.)$/);
  });

  it('left on a circle, it goes round what holds sway where it was put, the way it was going; asked back, it has its own velocity again', async () => {
    const { named, mover, pixel, physics, gestures } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const earth = named('Earth'), moon = named('Moon');
    const r = moon.pos.clone().sub(earth.pos), v = moon.vel.clone();
    const turning = r.clone().cross(moon.vel.clone().sub(earth.vel)).normalize();
    mover.toggle(moon);
    const from = pixel(moon.pos), to = pixel(earth.pos.clone().addScaledVector(r, 2));
    const hold = mover.grab(from.x, from.y, true, 0)!;
    hold.move(to.x, to.y, 100);
    hold.end(to.x, to.y, 400, false);
    mover.leave('circle');
    // (the choice of what it does where it is left is a change of its own)
    expect(gestures()).toEqual([2, 2]);
    const o = physics.orbit(moon)!;
    expect(moon.parent).toBe(earth);
    expect(o.e).toBeLessThan(1e-6);
    expect(o.period / (2 * Math.PI * Math.sqrt((2 * r.length()) ** 3 / (earth.gm + moon.gm)))).toBeCloseTo(1, 6);
    expect(moon.pos.clone().sub(earth.pos).cross(moon.vel.clone().sub(earth.vel)).normalize().dot(turning)).toBeCloseTo(1, 9);
    // (its two ends come out the same: a circle, so far out)
    expect(mover.describe(moon).orbit).toMatch(/^Now round Earth: a circle [78]\d\d,\d\d\d km out · [78]\d(\.\d+)? d\.$/);
    mover.leave('keep');
    expect(moon.vel.distanceTo(v)).toBeLessThan(1e-6);
    expect(mover.describe(moon).how).toBe('keep');
  });

  it('dragged onto another world it is left clear of it; dragged beside Mars and left on a circle, it is a moon of Mars', async () => {
    // (from above the planets' plane, looking down on the Earth: the Moon is dragged across the view from here,
    // or in its orbit's plane, as the eye stands; either way a finger on a world's dot means that world)
    const { named, mover, pixel, physics } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const earth = named('Earth'), moon = named('Moon'), mars = named('Mars');
    mover.toggle(moon);
    let at = pixel(moon.pos);
    let hold = mover.grab(at.x, at.y, true, 0)!;
    const centre = pixel(earth.pos);
    hold.move(centre.x, centre.y, 100);
    hold.end(centre.x, centre.y, 400, false);
    expect(moon.pos.distanceTo(earth.pos) / (earth.radius + moon.radius)).toBeCloseTo(1.05, 6);
    // beside Mars: put there directly (Mars is not in this view), 20,000 km from its centre
    physics.move(moon, mars.pos.clone().add(new Vector3(2e7, 0, 0)).toArray(), moon.vel.toArray(), JD);
    mover.leave('circle');
    const o = physics.orbit(moon)!;
    expect(moon.parent).toBe(mars);
    expect(o.e).toBeLessThan(1e-6);
    expect(o.peri).toBeCloseTo(2e7, -1);
    at = pixel(moon.pos);
    hold = mover.grab(at.x, at.y, true, 0)!;
    expect(hold).not.toBeNull();
    hold.end(at.x, at.y, 100, false);
  });
});

/** the way on the screen (a unit vector) that is square to the line from `centre` to `b`, the way `b` goes round it, in the plane of its orbit */
function squareOnScreen(pixel: (p: Vector3) => { x: number; y: number }, b: Body, centre: Body) {
  const r = b.pos.clone().sub(centre.pos), ahead = r.clone().cross(b.vel.clone().sub(centre.vel)).cross(r).normalize();
  const dot = pixel(b.pos), tip = pixel(b.pos.clone().addScaledVector(ahead, 1e5));
  const l = Math.hypot(tip.x - dot.x, tip.y - dot.y);
  return { dot, ux: (tip.x - dot.x) / l, uy: (tip.y - dot.y) / l };
}

describe('throwing a world', () => {
  /** the Moon, Throw chosen, and the way on the screen that is square to the line from the Earth, the way it goes round */
  async function throwing() {
    const s = await setup(aboveTheMoon, (sys) => sys.byId.get(399)!.pos.clone());
    const earth = s.named('Earth'), moon = s.named('Moon');
    s.mover.toggle(moon);
    s.mover.leave('throw');
    return { ...s, earth, moon, ...squareOnScreen(s.pixel, moon, earth) };
  }

  it('the slingshot: pulled back to the mark of a circle, square to the Earth, the Moon is left going round in a circle; time waits while it is pulled', async () => {
    const { mover, moon, earth, dot, ux, uy, physics, clock, gestures } = await throwing();
    const r = moon.pos.clone().sub(earth.pos), turning = r.clone().cross(moon.vel.clone().sub(earth.vel)).normalize();
    const hold = mover.grab(dot.x, dot.y, true, 0)!;
    expect(clock.paused).toBe(true);
    // pulled back the other way, a little short of the mark and a degree or two askew: made the circle exactly
    const back = 0.985 * AIM_PER_CIRCLE, skew = 0.03;
    const t = drag(hold, dot.x, dot.y, -back * (ux - skew * uy), -back * (uy + skew * ux), 30, 20, 0);
    const aim = mover.aim()!;
    expect(aim.snapped).toBe('circle');
    expect(aim.length).toBe(AIM_PER_CIRCLE);
    expect(aim.ux * ux + aim.uy * uy).toBeCloseTo(1, 6);
    // (it is already on the orbit it will have, where it was: the orbit line and the card show it)
    expect(physics.orbit(moon)!.e).toBeLessThan(1e-9);
    expect(moon.pos.clone().sub(earth.pos).distanceTo(r)).toBeLessThan(1e-3);
    hold.end(dot.x - back * (ux - skew * uy), dot.y - back * (uy + skew * ux), t + 400, false);
    expect(clock.paused).toBe(false);
    expect(mover.aim()).toBeNull();
    const o = physics.orbit(moon)!;
    expect(o.bound && o.e < 1e-9).toBe(true);
    expect(o.peri / r.length()).toBeCloseTo(1, 9);
    expect(moon.pos.clone().sub(earth.pos).cross(moon.vel.clone().sub(earth.vel)).normalize().dot(turning)).toBeCloseTo(1, 9);
    expect(mover.describe(moon).orbit).toMatch(/^Now round Earth: a circle [\d,]+ km out · /);
    expect(gestures()).toEqual([1, 1]);
  });

  it('pulled to the mark of escape it will not come back, whichever way it is aimed; pulled three times as far it goes three times as fast as a circle, no faster', async () => {
    const { mover, moon, earth, dot, ux, uy, physics } = await throwing();
    const circle = Math.sqrt((earth.gm + moon.gm) / moon.pos.distanceTo(earth.pos));
    // aimed across the way it goes (towards the Earth or away from it on the screen), a little past the mark
    const px = 1.02 * Math.SQRT2 * AIM_PER_CIRCLE * uy, py = -1.02 * Math.SQRT2 * AIM_PER_CIRCLE * ux;
    let hold = mover.grab(dot.x, dot.y, true, 0)!;
    let t = drag(hold, dot.x, dot.y, px, py, 20, 20, 0);
    expect(mover.aim()!.snapped).toBe('escape');
    hold.end(dot.x + px, dot.y + py, t + 300, false);
    expect(moon.vel.clone().sub(earth.vel).length() / circle).toBeCloseTo(Math.SQRT2, 12);
    // (open about the Earth: what the simulation then has it go round is its own business)
    expect(orbitOf(moon.pos.clone().sub(earth.pos).toArray(), moon.vel.clone().sub(earth.vel).toArray(), earth.gm + moon.gm).bound).toBe(false);
    expect(physics.on).toBe(true);
    // again, as far as the finger goes: three speeds of a circle at most
    const at = mover.handle()!;
    hold = mover.grab(at.x, at.y, true, 1000)!;
    t = drag(hold, at.x, at.y, -5 * AIM_PER_CIRCLE * ux, -5 * AIM_PER_CIRCLE * uy, 25, 20, 1000);
    expect(mover.aim()!.length).toBe(3 * AIM_PER_CIRCLE);
    hold.end(at.x - 5 * AIM_PER_CIRCLE * ux, at.y - 5 * AIM_PER_CIRCLE * uy, t + 300, false);
    expect(moon.vel.clone().sub(earth.vel).length() / circle).toBeCloseTo(3, 9);
  });

  it('let go where it was taken hold of, or taken away by the browser, nothing is thrown: the change comes to nothing', async () => {
    const { mover, moon, dot, ux, uy, physics, cancelled, gestures } = await throwing();
    const v = moon.vel.clone();
    let hold = mover.grab(dot.x, dot.y, true, 0)!;
    let t = drag(hold, dot.x, dot.y, -60 * ux, -60 * uy, 10, 30, 0);
    expect(mover.aim()!.length).toBeGreaterThan(0);
    t = drag(hold, dot.x - 60 * ux, dot.y - 60 * uy, 58 * ux, 58 * uy, 10, 30, t);
    expect(mover.aim()!.length).toBe(0);
    expect(moon.vel.distanceTo(v)).toBeLessThan(1e-6);
    hold.end(dot.x - 2 * ux, dot.y - 2 * uy, t + 300, false);
    expect(cancelled()).toBe(1);
    expect(physics.on).toBe(true); // (the app's cancelChange puts the simulation back as it was: here that is left to it)
    hold = mover.grab(dot.x, dot.y, true, 5000)!;
    t = drag(hold, dot.x, dot.y, -80 * ux, -80 * uy, 10, 30, 5000);
    hold.end(dot.x - 80 * ux, dot.y - 80 * uy, t + 10, true);
    expect(cancelled()).toBe(2);
    expect(gestures()).toEqual([2, 0]);
  });

  it('a flick throws it the way the finger went, as fast as the finger was going: 1,700 px a second is escape', async () => {
    const { mover, moon, earth, dot, ux, uy, physics, gestures } = await throwing();
    const r = moon.pos.distanceTo(earth.pos), circle = Math.sqrt((earth.gm + moon.gm) / r);
    // ahead, square to the Earth, 160 px in 100 ms (1,600 px a second: 1.33 speeds of a circle)
    let hold = mover.grab(dot.x, dot.y, true, 0)!;
    let t = drag(hold, dot.x, dot.y, 160 * ux, 160 * uy, 10, 10, 0);
    hold.end(dot.x + 160 * ux, dot.y + 160 * uy, t, false);
    expect(gestures()).toEqual([1, 1]);
    const rel = moon.vel.clone().sub(earth.vel);
    expect(rel.length() / circle).toBeCloseTo(1600 / FLICK_PER_CIRCLE, 6);
    expect(rel.clone().normalize().dot(moon.pos.clone().sub(earth.pos).normalize())).toBeCloseTo(0, 9);
    expect(physics.orbit(moon)!.bound).toBe(true);
    // the same flick at 1,700 px a second: snapped to escape
    const at = mover.handle()!;
    hold = mover.grab(at.x, at.y, true, 1000)!;
    t = drag(hold, at.x, at.y, 170 * ux, 170 * uy, 10, 10, 1000);
    hold.end(at.x + 170 * ux, at.y + 170 * uy, t, false);
    expect(moon.vel.clone().sub(earth.vel).length() / Math.sqrt((earth.gm + moon.gm) / moon.pos.distanceTo(earth.pos))).toBeCloseTo(Math.SQRT2, 12);
    expect(orbitOf(moon.pos.clone().sub(earth.pos).toArray(), moon.vel.clone().sub(earth.vel).toArray(), earth.gm + moon.gm).bound).toBe(false);
  });

  it('a pull that lasts is an aim, however fast the finger lifts: it goes the way the arrow pointed', async () => {
    const { mover, moon, earth, dot, ux, uy } = await throwing();
    const turning = moon.pos.clone().sub(earth.pos).cross(moon.vel.clone().sub(earth.vel)).normalize();
    const hold = mover.grab(dot.x, dot.y, true, 0)!;
    // pulled back slowly for 400 ms, then the last 50 px at 1,000 px a second, lifting as it goes
    let t = drag(hold, dot.x, dot.y, -60 * ux, -60 * uy, 20, 20, 0);
    t = drag(hold, dot.x - 60 * ux, dot.y - 60 * uy, -50 * ux, -50 * uy, 5, 10, t);
    hold.end(dot.x - 110 * ux, dot.y - 110 * uy, t, false);
    const rel = moon.vel.clone().sub(earth.vel);
    // ahead, at the speed of a circle (taken for a flick it would have gone backwards, at 0.83 of it)
    expect(rel.length() / Math.sqrt((earth.gm + moon.gm) / moon.pos.distanceTo(earth.pos))).toBeCloseTo(1, 12);
    expect(moon.pos.clone().sub(earth.pos).cross(rel).normalize().dot(turning)).toBeCloseTo(1, 9);
    expect(mover.describe(moon).orbit).toMatch(/^Now round Earth: a circle [\d,]+ km out · /);
  });
});

describe('putting a world just made in place', () => {
  it('goes where the finger takes it and is left on a circle; a flick throws it; Done ends its making', async () => {
    const { named, mover, pixel, physics, gestures, placed } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const earth = named('Earth'), moon = named('Moon');
    // (the Moon stands in for a moon just made: putting in place is the same for any world)
    mover.place(moon);
    expect(mover.describe(moon)).toMatchObject({ on: true, how: 'circle', placing: true });
    const r = moon.pos.clone().sub(earth.pos);
    const from = pixel(moon.pos), to = pixel(earth.pos.clone().addScaledVector(r, 1.5));
    let hold = mover.grab(from.x, from.y, true, 0)!;
    let t = drag(hold, from.x, from.y, to.x - from.x, to.y - from.y, 20, 30, 0);
    // (the finger rests before it lifts: left on a circle there)
    hold.move(to.x, to.y, t + 150);
    hold.end(to.x, to.y, t + 160, false);
    expect(physics.orbit(moon)!.e).toBeLessThan(1e-6);
    expect(moon.pos.distanceTo(earth.pos) / r.length()).toBeCloseTo(1.5, 6);
    // putting it in place is part of its making: no change of its own
    expect(gestures()).toEqual([0, 0]);
    // the next drag ends in a flick the way it goes, at 1,000 px a second: thrown from where the finger let go, at 0.83
    // speeds of a circle there, the way the finger went (it goes with the finger, so that is some way on along its orbit)
    const way = squareOnScreen(pixel, moon, earth);
    hold = mover.grab(way.dot.x, way.dot.y, true, 5000)!;
    t = drag(hold, way.dot.x, way.dot.y, 100 * way.ux, 100 * way.uy, 10, 10, 5000);
    hold.end(way.dot.x + 100 * way.ux, way.dot.y + 100 * way.uy, t, false);
    const rel = moon.vel.clone().sub(earth.vel), circle = Math.sqrt((earth.gm + moon.gm) / moon.pos.distanceTo(earth.pos));
    expect(rel.length() / circle).toBeCloseTo(1000 / FLICK_PER_CIRCLE, 9);
    const p0 = pixel(moon.pos), p1 = pixel(moon.pos.clone().addScaledVector(rel.clone().normalize(), 1e5));
    expect(((p1.x - p0.x) * way.ux + (p1.y - p0.y) * way.uy) / Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeCloseTo(1, 6);
    const o = physics.orbit(moon)!;
    expect(o.bound && o.e > 0.2).toBe(true);
    // a new mass does not put a thrown world back on a circle
    mover.recircle();
    expect(physics.orbit(moon)!.e).toBeCloseTo(o.e, 9);
    mover.stop(true);
    expect(placed).toEqual([true]);
    expect(mover.body).toBeNull();
  });
});

describe('a world thrown out', () => {
  it('past the speed of escape from the Sun it goes round nothing, and the card says it is on an open path past the Sun', async () => {
    const { named, mover, physics, sys } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const earth = named('Earth'), sun = sys.sun;
    const r = earth.pos.clone().sub(sun.pos), w = earth.vel.clone().sub(sun.vel);
    const square = r.clone().cross(w).cross(r).normalize().negate();
    // (1.6 times the speed of a circle, the way it goes: e = 1.56)
    const v = square.multiplyScalar(1.6 * Math.sqrt((sun.gm + earth.gm) / r.length()));
    physics.move(earth, earth.pos.toArray(), sun.vel.clone().add(v).toArray(), JD);
    expect(earth.parent).toBeNull();
    const o = physics.orbit(earth, sun)!;
    expect(o.bound).toBe(false);
    expect(o.e).toBeCloseTo(1.56, 2);
    mover.toggle(earth);
    expect(mover.describe(earth).orbit).toBe(`Now on an open path past the Sun: it passes at ${(o.peri / 149_597_870_700).toPrecision(3).replace(/0+$/, '').replace(/\.$/, '')} AU, then leaves.`);
    // the Sun itself goes round nothing, and is on no path
    mover.toggle(sun);
    expect(mover.describe(sun).orbit).toBe('Now it goes round nothing.');
  });
});
