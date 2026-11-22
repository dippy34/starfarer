import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import { Mover } from '../src/app/Mover';
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
  let told = 0, begun = 0, ended = 0;
  const mover = new Mover({
    rig: { ray: (x: number, y: number) => new Vector3((x - 500) * PIXEL, (500 - y) * PIXEL, -1).normalize().applyQuaternion(quat), upos: { toVector3: () => at.clone() } },
    physics, clock, bodies: { views }, view: { quat, pixelRatio: 1 }, project, tellNews: () => { told++; },
    beginChange: () => { begun++; }, endChange: () => { ended++; },
  } as unknown as ConstructorParameters<typeof Mover>[0]);
  /** the pixel at which a place (m from the system's centre) is seen */
  const pixel = (p: Vector3) => project(p.clone().sub(at))!;
  return { sys, named, physics, clock, mover, pixel, told: () => told, gestures: () => [begun, ended] };
}

/** from far above the plane of the Moon's orbit, over the Earth */
const aboveTheMoon = (s: SolarSystem) => {
  const earth = s.byId.get(399)!, moon = s.byId.get(301)!;
  const normal = moon.pos.clone().sub(earth.pos).cross(moon.vel.clone().sub(earth.vel)).normalize();
  return earth.pos.clone().addScaledVector(normal, 3e9);
};

describe('moving a world with a finger', () => {
  it('takes hold only of the world whose Move is on, and only where its dot is; time waits while it is held', async () => {
    const { named, mover, clock, pixel, physics, gestures } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const moon = named('Moon'), dot = pixel(moon.pos);
    expect(mover.grab(dot.x, dot.y, true)).toBeNull();
    mover.toggle(moon);
    expect(mover.body).toBe(moon);
    // a finger reaches 30 px, a pointer 14
    expect(mover.grab(dot.x + 40, dot.y, true)).toBeNull();
    expect(mover.grab(dot.x + 20, dot.y, false)).toBeNull();
    const hold = mover.grab(dot.x + 20, dot.y, true)!;
    expect(hold).not.toBeNull();
    expect(mover.holding).toBe(true);
    expect(clock.paused).toBe(true);
    // held but not moved: nothing has changed, and nothing is simulated yet
    expect(physics.on).toBe(false);
    hold.end();
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
    const hold = mover.grab(from.x + 12, from.y, true)!;
    hold.move(from.x + 12, from.y);
    expect(moon.pos.clone().sub(earth.pos).distanceTo(r) / r.length()).toBeLessThan(1e-9);
    for (let k = 1; k <= 10; k++) hold.move(from.x + 12 + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
    hold.end();
    expect(physics.on).toBe(true);
    expect(told()).toBeGreaterThan(0);
    const now = moon.pos.clone().sub(earth.pos);
    expect(now.length() / r.length()).toBeCloseTo(2, 6);
    expect(now.clone().normalize().dot(r.clone().normalize())).toBeCloseTo(1, 9);
    expect(moon.vel.distanceTo(v)).toBeLessThan(1e-6);
    // twice as far out with the speed of its old orbit: about escape speed there, and the card says what it is on now
    expect(mover.describe(moon).orbit).toMatch(/^Now (round Earth: a long oval \(0\.\d\d\), .* km to .*\.|on an open path past Earth: it passes at .*, then leaves\.)$/);
  });

  it('left on a circle, it goes round what holds sway where it was put, the way it was going; asked back, it has its own velocity again', async () => {
    const { named, mover, pixel, physics, gestures } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const earth = named('Earth'), moon = named('Moon');
    const r = moon.pos.clone().sub(earth.pos), v = moon.vel.clone();
    const turning = r.clone().cross(moon.vel.clone().sub(earth.vel)).normalize();
    mover.toggle(moon);
    const from = pixel(moon.pos), to = pixel(earth.pos.clone().addScaledVector(r, 2));
    const hold = mover.grab(from.x, from.y, true)!;
    hold.move(to.x, to.y);
    hold.end();
    mover.leave(true);
    // (the choice of what it does where it is left is a change of its own)
    expect(gestures()).toEqual([2, 2]);
    const o = physics.orbit(moon)!;
    expect(moon.parent).toBe(earth);
    expect(o.e).toBeLessThan(1e-6);
    expect(o.period / (2 * Math.PI * Math.sqrt((2 * r.length()) ** 3 / (earth.gm + moon.gm)))).toBeCloseTo(1, 6);
    expect(moon.pos.clone().sub(earth.pos).cross(moon.vel.clone().sub(earth.vel)).normalize().dot(turning)).toBeCloseTo(1, 9);
    expect(mover.describe(moon).orbit).toMatch(/^Now round Earth: nearly a circle \(0\), [78]\d\d,\d\d\d km to [78]\d\d,\d\d\d km · [78]\d(\.\d+)? d\.$/);
    mover.leave(false);
    expect(moon.vel.distanceTo(v)).toBeLessThan(1e-6);
    expect(mover.describe(moon).circle).toBe(false);
  });

  it('dragged onto another world it is left clear of it; dragged beside Mars and left on a circle, it is a moon of Mars', async () => {
    // (from above the planets' plane, looking down on the Earth: the Moon is dragged across the view from here,
    // or in its orbit's plane, as the eye stands; either way a finger on a world's dot means that world)
    const { named, mover, pixel, physics } = await setup(aboveTheMoon, (s) => s.byId.get(399)!.pos.clone());
    const earth = named('Earth'), moon = named('Moon'), mars = named('Mars');
    mover.toggle(moon);
    let at = pixel(moon.pos);
    let hold = mover.grab(at.x, at.y, true)!;
    const centre = pixel(earth.pos);
    hold.move(centre.x, centre.y);
    hold.end();
    expect(moon.pos.distanceTo(earth.pos) / (earth.radius + moon.radius)).toBeCloseTo(1.05, 6);
    // beside Mars: put there directly (Mars is not in this view), 20,000 km from its centre
    physics.move(moon, mars.pos.clone().add(new Vector3(2e7, 0, 0)).toArray(), moon.vel.toArray(), JD);
    mover.leave(true);
    const o = physics.orbit(moon)!;
    expect(moon.parent).toBe(mars);
    expect(o.e).toBeLessThan(1e-6);
    expect(o.peri).toBeCloseTo(2e7, -1);
    at = pixel(moon.pos);
    hold = mover.grab(at.x, at.y, true)!;
    expect(hold).not.toBeNull();
    hold.end();
  });
});
