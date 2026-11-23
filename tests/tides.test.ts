import { describe, expect, it } from 'vitest';
import { NBody, type SimEvent } from '../src/sim/NBody';
import { FLUID_ROCHE, rocheLimit } from '../src/sim/physics';
import { RIGID_ROCHE, selfTime, staysInside, tidalLimit } from '../src/sim/Tides';

// GM (m³/s²) and mean radii (m) of the Earth, the Moon and Mars, as the app's catalogue has them (public/data/solar/system.json:
// the mean radius the cube root of the three radii's product)
const mean = (a: number, c: number) => Math.cbrt(a * a * c) * 1e3;
const EARTH = { gm: 398600.43550702266e9, r: mean(6378.1366, 6356.7519) }, MOON = { gm: 4902.80011845755e9, r: 1737.4e3 }, MARS = { gm: 42828.37362069909e9, r: mean(3396.19, 3376.2) };

describe('the Roche limit and the time a world takes to come apart', () => {
  it('the fluid limit, 2.46 R (M / m)^⅓, is the same as 2.46 R_M (ρ_M / ρ_m)^⅓; the rigid one is 2^⅓', () => {
    expect(FLUID_ROCHE).toBe(2.46);
    expect(RIGID_ROCHE).toBeCloseTo(1.26, 2);
    const rho = (g: number, r: number) => g / ((4 / 3) * Math.PI * r ** 3);
    const byDensity = rocheLimit(EARTH.r, rho(EARTH.gm, EARTH.r), rho(MOON.gm, MOON.r)).value;
    expect(tidalLimit(FLUID_ROCHE, MOON.r, MOON.gm, EARTH.gm) / byDensity).toBeCloseTo(1, 12);
    // the Moon about the Earth: 18,500 km between centres (2.9 Earth radii); Mars: 17,500 km
    expect(tidalLimit(FLUID_ROCHE, MOON.r, MOON.gm, EARTH.gm) / 1e3).toBeCloseTo(18515.4, 1);
    expect(tidalLimit(FLUID_ROCHE, MARS.r, MARS.gm, EARTH.gm) / 1e3).toBeCloseTo(17539.1, 1);
    // nothing tears apart what is as heavy or heavier, or a world that is not frail
    expect(tidalLimit(FLUID_ROCHE, EARTH.r, EARTH.gm, MOON.gm)).toBe(0);
    expect(tidalLimit(0, MOON.r, MOON.gm, EARTH.gm)).toBe(0);
  });

  it('how long it must stay inside: as long as a pebble takes to circle it at its surface (the Moon 1.8 hours, Mars 1.7)', () => {
    expect(selfTime(MOON.r, MOON.gm) / 3600).toBeCloseTo(1.805, 3);
    expect(selfTime(MARS.r, MARS.gm) / 3600).toBeCloseTo(1.664, 3);
  });

  it('a world on a circle inside the limit stays; one falling through it hits first; one flying past leaves first; a slow pass stays long enough', () => {
    const limit = tidalLimit(FLUID_ROCHE, MOON.r, MOON.gm, EARTH.gm), touch = EARTH.r + MOON.r, mu = EARTH.gm + MOON.gm, t = selfTime(MOON.r, MOON.gm);
    const circle = (d: number) => [[d, 0, 0], [0, Math.sqrt(mu / d), 0]] as const;
    expect(staysInside(...circle(15000e3), mu, limit, touch, t)).toBe(true);
    // (outside it: not inside at all)
    expect(staysInside(...circle(20000e3), mu, limit, touch, t)).toBe(false);
    // falling straight in from far off: 18,500 km out at the speed of that fall, it hits 22 minutes later
    const d = 18000e3;
    expect(staysInside([d, 0, 0], [-Math.sqrt((2 * mu) / d), 0, 0], mu, limit, touch, t)).toBe(false);
    // past it at 10 km/s at its nearest, 12,000 km out: in and out in a few minutes
    expect(staysInside([12000e3, 0, 0], [0, 10e3, 0], mu, limit, touch, t)).toBe(false);
    // on an oval whose far end is just outside the limit: inside most of its turn, longer than an hour and three quarters
    const q = 14000e3, Q = 19000e3, a = (q + Q) / 2;
    expect(staysInside([q, 0, 0], [0, Math.sqrt(mu * (2 / q - 1 / a)), 0], mu, limit, touch, t)).toBe(true);
  });
});

/** an Earth and a frail Moon (frail: the fluid coefficient) at `d` m on a circle, or as `vel` says */
function pair(d: number, frail = FLUID_ROCHE, vel?: number[]): NBody {
  const sim = new NBody();
  sim.add({ id: 399, gm: EARTH.gm, radius: EARTH.r, pos: [0, 0, 0], vel: [0, 0, 0] });
  sim.add({ id: 301, gm: MOON.gm, radius: MOON.r, frail, pos: [d, 0, 0], vel: vel ?? [0, Math.sqrt((EARTH.gm + MOON.gm) / d), 0] });
  return sim;
}
const torn = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { kind: 'torn' }> => e.kind === 'torn');

describe('the simulation tears a frail world apart inside the limit', () => {
  it('the Moon on a circle 15,000 km out is torn apart at its first step, and taken out: its place and motion as it came apart are in the event', () => {
    const sim = pair(15000e3);
    // (its turn there takes 16 hours: a step a sixteenth of that)
    sim.advance(2 * 3600);
    const ev = torn(sim.takeEvents());
    expect(ev.length).toBe(1);
    const e = ev[0];
    expect([e.id, e.by]).toEqual([301, 399]);
    expect(e.time).toBeLessThan(2 * 3600);
    expect(sim.indexOf(301)).toBe(-1);
    expect(e.gm).toBe(MOON.gm);
    expect(e.radius).toBe(MOON.r);
    expect(e.byGm).toBe(EARTH.gm);
    expect(e.byRadius).toBe(EARTH.r);
    // (the Earth is the heaviest there is: its pull holds sway everywhere)
    expect(e.reach).toBe(Infinity);
    const d = Math.hypot(e.pos[0] - e.byPos[0], e.pos[1] - e.byPos[1], e.pos[2] - e.byPos[2]);
    expect(Math.abs(d / 15000e3 - 1)).toBeLessThan(1e-3);
  });

  it('not a world that is not frail, nor one outside the limit', () => {
    const solid = pair(15000e3, 0);
    solid.advance(86400);
    expect(torn(solid.takeEvents())).toEqual([]);
    expect(solid.indexOf(301)).toBeGreaterThanOrEqual(0);
    const out = pair(25000e3);
    out.advance(10 * 86400);
    expect(torn(out.takeEvents())).toEqual([]);
  });

  it('a world falling straight in through the limit hits before it can come apart: one hit, no tearing', () => {
    const d = 200000e3;
    const sim = pair(d, FLUID_ROCHE, [0, 0, 0]);
    let all: SimEvent[] = [];
    for (let k = 0; k < 400 && sim.indexOf(301) >= 0; k++) { sim.advance(3600); all = all.concat(sim.takeEvents()); }
    expect(torn(all)).toEqual([]);
    expect(all.filter((e) => e.kind === 'collision').length).toBe(1);
  });

  it('the same bits whatever way the time is cut, and from a snapshot', () => {
    const a = pair(16000e3), b = pair(16000e3);
    a.advance(3 * 3600);
    for (let k = 0; k < 30; k++) b.advance(360);
    const ea = torn(a.takeEvents()), eb = torn(b.takeEvents());
    expect(ea.length).toBe(1);
    expect(eb).toEqual(ea);
    // (a world on an oval that dips inside the limit for longer than it takes, judged where it is first found inside)
    const c = pair(30000e3, FLUID_ROCHE, [0, 2600, 0]);
    c.advance(1000);
    const snap = c.snapshot(), d = NBody.restore(snap);
    c.advance(40 * 3600);
    d.advance(40 * 3600);
    const ec = torn(c.takeEvents());
    expect(ec.length).toBe(1);
    expect(torn(d.takeEvents())).toEqual(ec);
  });
});
