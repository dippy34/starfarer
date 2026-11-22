import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/app/CameraRig';
import { LivePhysics } from '../src/app/LivePhysics';
import { FRAME_MARGIN, viewFrame, WATCH_SECONDS, WATCH_SLOWEST } from '../src/app/Powers';
import { Glide, planChange, REPLAY_OFFERED, sample, Watch } from '../src/app/Watch';
import { newMoon } from '../src/app/WhatIf';
import { UPos } from '../src/core/upos';
import type { Body } from '../src/universe/Body';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it: its catalogue and the JPL ephemeris, read from public/ as the browser fetches them.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const DAY = 86_400, YEAR = 365.25 * DAY, AU = 149_597_870_700, MINUTE = 60;
const JD = 2461300.5; // 2026-09-17 (TDB)
/** the most a touch screen is let watch at (App.ts) */
const TOUCH_MOST = 10 * YEAR;
const saved = { index: 3, sign: 1, rate: 600, paused: true };

describe('the watch, as bookkeeping', () => {
  it('runs for fifteen seconds at its pace, then gives the rate of time back and offers Replay for a while', () => {
    const w = new Watch();
    w.start(3.4 * DAY, saved);
    expect(w.watching).toBe(true);
    let over = 0;
    for (let f = 1; f <= 60 * 20 && !over; f++) if (w.tick(1 / 60, 3.4 * DAY / 60, 1) === 'over') over = f;
    expect(over / 60).toBeCloseTo(WATCH_SECONDS, 1);
    expect(w.shown / DAY).toBeCloseTo(3.4 * WATCH_SECONDS, 0);
    expect(w.stop()).toEqual(saved);
    expect(w.state).toBe('ended');
    // (nothing more to give back)
    expect(w.stop()).toBeNull();
    for (let t = 0; t < REPLAY_OFFERED - 1; t += 1) w.tick(1, 0, 1);
    expect(w.state).toBe('ended');
    w.tick(2, 0, 1);
    expect(w.state).toBe('idle');
  });

  it('goes slower by steps of 0.6 when the stepping cannot keep up, never below a minute a second', () => {
    const w = new Watch();
    w.start(100 * YEAR, saved);
    let slower = 0;
    for (let f = 0; f < 11; f++) if (w.tick(1 / 60, 0, 0.5) === 'slower') slower++;
    expect(slower).toBe(0);
    expect(w.tick(1 / 60, 0, 0.5)).toBe('slower');
    expect(w.rate / YEAR).toBeCloseTo(60, 9);
    // keeping up again: the count starts over
    w.tick(1 / 60, 0, 0.9);
    for (let f = 0; f < 11; f++) expect(w.tick(1 / 60, 0, 0.5)).toBeNull();
    w.start(1.5 * WATCH_SLOWEST, saved);
    for (let f = 0; f < 50; f++) w.tick(1 / 600, 0, 0);
    expect(w.rate).toBe(WATCH_SLOWEST);
  });

  it('ends with nothing given back when the explorer takes the rate in hand, and is forgotten by another change', () => {
    const w = new Watch();
    w.start(DAY, saved);
    w.yieldRate();
    expect(w.state).toBe('ended');
    expect(w.stop()).toBeNull();
    w.start(DAY, saved);
    expect(w.clear()).toEqual(saved);
    expect(w.state).toBe('idle');
    expect(w.clear()).toBeNull();
  });
});

describe('the camera eased to the frame', () => {
  it('ends the distance asked for from the centre, along the line it was on, with the centre in the middle of what the interface leaves clear', () => {
    const rig = new CameraRig();
    rig.viewport.width = 390;
    rig.viewport.height = 844;
    const centre = { upos: new UPos().set(1e11, 2e10, -3e10) };
    // the camera 50,000 km off, looking at the centre
    const from = new Vector3(3e7, 4e7, 0);
    rig.upos.copy(centre.upos).addVec(from);
    rig.lookAt(from.clone().negate().normalize());
    // the chips at the top, the card at the foot
    const free = { left: 8, top: 130, right: 382, bottom: 520 };
    const v = viewFrame(free, 390, 844, rig.fovY);
    const glide = new Glide(rig, centre, 2e9, v.dir);
    let frames = 0;
    while (glide.step(1 / 60) && frames < 1000) frames++;
    expect(frames / 60).toBeCloseTo(glide.seconds, 1);
    const rel = rig.upos.sub(centre.upos, new Vector3());
    expect(rel.length() / 2e9).toBeCloseTo(1, 9);
    expect(rel.normalize().dot(from.normalize())).toBeCloseTo(1, 9);
    // the sight line through the middle of the clear part meets the centre
    const ray = rig.ray((free.left + free.right) / 2, (free.top + free.bottom) / 2);
    expect(ray.dot(rel.clone().negate().normalize())).toBeCloseTo(1, 9);
    // and the sight line through the middle of the view does not (the clear part is above it)
    expect(rig.ray(195, 422).dot(rel.clone().negate().normalize())).toBeLessThan(0.999);
  });

  it('goes with a centre that moves', () => {
    const rig = new CameraRig();
    const centre = { upos: new UPos().set(0, 0, 0) };
    rig.upos.set(1e6, 0, 0);
    const glide = new Glide(rig, centre, 1e7, [0, 0, -1]);
    glide.step(0.5);
    centre.upos.set(5e8, 0, 0);
    while (glide.step(1 / 60));
    expect(rig.upos.sub(centre.upos, new Vector3()).distanceTo(new Vector3(1e7, 0, 0))).toBeLessThan(1e-3);
  });
});

/** The system at a date, live physics over it. */
async function setup() {
  const sys = await SolarSystem.load('/data');
  await sys.ephemeris.request(JD);
  sys.update(JD);
  const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
  const named = (name: string) => sys.bodies.find((b) => b.name === name)!;
  return { sys, physics, named };
}

describe('what a change is watched for, in the real Solar System', () => {
  it('Jupiter twenty times heavier: its four great moons fall onto new orbits; Io sets the pace, Callisto the frame; the Earth is not concerned', async () => {
    const { sys, physics, named } = await setup();
    const jupiter = named('Jupiter');
    const before = sample(physics, sys, jupiter);
    physics.setMass(jupiter, 20 * jupiter.gm, JD);
    const after = sample(physics, sys, jupiter);
    const plan = planChange('mass', jupiter, before, after, jupiter, TOUCH_MOST)!;
    // Io now: the speed it had, about twenty times the mass: P = 2π √(a³/GM), 1/a = 2/r − v²/GM
    const io = named('Io'), callisto = named('Callisto');
    const r = io.pos.distanceTo(jupiter.pos), v2 = io.vel.distanceToSquared(jupiter.vel), mu = jupiter.gm + io.gm, a = 1 / (2 / r - v2 / mu);
    const P = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
    expect(P / 3600).toBeGreaterThan(2);
    expect(P / 3600).toBeLessThan(5);
    expect(plan.rate).toBeCloseTo(P / 8, 3);
    expect(plan.rate / MINUTE).toBeGreaterThan(15);
    expect(plan.centre).toBe(jupiter);
    // (each moon is at the far end of its new, shrunken orbit: it had the speed of a circle round a lighter Jupiter)
    expect(plan.radius / (FRAME_MARGIN * callisto.pos.distanceTo(jupiter.pos))).toBeCloseTo(1, 2);
  });

  it('Jupiter twenty times heavier matters to its four great moons and not to the Earth, the Moon or Mars; Ceres taken away matters to nothing worth watching', async () => {
    const { sys, physics, named } = await setup();
    const jupiter = named('Jupiter'), ceres = named('Ceres');
    const before = sample(physics, sys, jupiter);
    // (weighed as the watch weighs it: what Jupiter's new mass does to the pull on each)
    const heavier = new Map([...before].map(([b, s]) => [b, b === jupiter ? { ...s, gm: 20 * s.gm } : s]));
    const plan = planChange('mass', jupiter, before, heavier, jupiter, TOUCH_MOST);
    expect(plan).not.toBeNull();
    // which they are: those whose pull from everything else changed by a hundredth or more
    const { affected } = await import('../src/app/Powers');
    const weighed = (m: Map<Body, { gm: number; pos: [number, number, number] }>) => [...m].map(([b, s]) => ({ id: b.id, gm: s.gm, pos: s.pos }));
    const hit = new Set(affected(weighed(before), weighed(heavier)).map((id) => sys.byId.get(id)!.name));
    for (const name of ['Io', 'Europa', 'Ganymede', 'Callisto']) expect(hit.has(name), name).toBe(true);
    for (const name of ['Earth', 'Moon', 'Mars', 'Mercury']) expect(hit.has(name), name).toBe(false);
    // Ceres taken away: no planet's pull changes by a hundredth
    const all = sample(physics, sys, ceres), without = new Map([...all].filter(([b]) => b !== ceres));
    const gone = new Set(affected(weighed(all), weighed(without)).map((id) => sys.byId.get(id)!.kind));
    expect(gone.has('planet')).toBe(false);
    expect(planChange('remove', ceres, all, without, ceres, TOUCH_MOST)).toBeNull();
  });

  it('the Moon moved to twice its distance: framed round the Earth, its new orbit sets the pace and the frame', async () => {
    const { sys, physics, named } = await setup();
    const earth = named('Earth'), moon = named('Moon');
    const before = sample(physics, sys, moon);
    const to = earth.pos.clone().add(moon.pos.clone().sub(earth.pos).multiplyScalar(2));
    physics.move(moon, to.toArray(), moon.vel.toArray(), JD);
    const after = sample(physics, sys, moon);
    const centre = physics.swayAt(moon.pos.toArray(), moon);
    expect(centre).toBe(earth);
    const plan = planChange('move', moon, before, after, centre, TOUCH_MOST)!;
    const o = physics.orbit(moon)!;
    expect(o.bound).toBe(true);
    expect(plan.rate).toBeCloseTo(o.period / 8, 0);
    expect(plan.radius / (FRAME_MARGIN * o.apo)).toBeCloseTo(1, 3);
  });

  it('the Moon thrown from where it is: its pull and the pull on it are as they were, and it is watched all the same; at escape the pace is its old month\'s', async () => {
    const { sys, physics, named } = await setup();
    const earth = named('Earth'), moon = named('Moon');
    // three quarters of the speed of a circle, square to the Earth: an oval with its far end here
    const r = moon.pos.clone().sub(earth.pos), ahead = r.clone().cross(moon.vel.clone().sub(earth.vel)).cross(r).normalize();
    const mu = earth.gm + moon.gm, circle = Math.sqrt(mu / r.length());
    let before = sample(physics, sys, moon);
    physics.move(moon, moon.pos.toArray(), earth.vel.clone().addScaledVector(ahead, 0.75 * circle).toArray(), JD);
    let plan = planChange('move', moon, before, sample(physics, sys, moon), earth, TOUCH_MOST)!;
    const o = physics.orbit(moon)!;
    expect(o.bound && o.e > 0.4).toBe(true);
    expect(plan.rate).toBeCloseTo(o.period / 8, 0);
    expect(plan.radius / (FRAME_MARGIN * o.apo)).toBeCloseTo(1, 3);
    expect(plan.centre).toBe(earth);
    // at the speed of escape: open, so the pace is the month it had before it was thrown
    before = sample(physics, sys, moon);
    const month = before.get(moon)!.period;
    physics.move(moon, moon.pos.toArray(), earth.vel.clone().addScaledVector(ahead, Math.SQRT2 * circle).toArray(), JD);
    plan = planChange('move', moon, before, sample(physics, sys, moon), earth, TOUCH_MOST)!;
    expect(plan.rate).toBeCloseTo(month / 8, 0);
    expect(plan.radius).toBeGreaterThan(FRAME_MARGIN * r.length());
  });

  it('a moon made for the Earth: framed round the Earth, going round in its own period', async () => {
    const { sys, physics, named } = await setup();
    const earth = named('Earth');
    const before = sample(physics, sys, earth);
    const plan = newMoon(earth, [3e8, 0, 1e8], AU, 0, 900_000_001);
    const made = physics.make(plan.json, earth, plan.pos, plan.vel, JD, 'new');
    const after = sample(physics, sys, earth);
    expect(after.has(made)).toBe(true);
    const watch = planChange('add', earth, before, after, earth, TOUCH_MOST)!;
    expect(watch.rate).toBeCloseTo((plan.periodDays * DAY) / 8, -2);
    expect(watch.radius / (FRAME_MARGIN * plan.orbit)).toBeCloseTo(1, 2);
    expect(watch.centre).toBe(earth);
  });

  it('the Sun taken away: the Moon\'s month sets the pace, and the frame reaches past the inner planets as they leave, round where the Sun was', async () => {
    const { sys, physics } = await setup();
    const sun = sys.sun;
    const before = sample(physics, sys, sun);
    physics.remove(sun, JD);
    const after = sample(physics, sys, sun);
    const plan = planChange('remove', sun, before, after, sun, TOUCH_MOST)!;
    expect(plan.rate / DAY).toBeCloseTo(27.3 / 8, 0);
    expect(plan.radius / AU).toBeGreaterThan(2);
    expect(plan.radius / AU).toBeLessThan(4);
    expect(plan.centre).toBe(sun);
  });
});
