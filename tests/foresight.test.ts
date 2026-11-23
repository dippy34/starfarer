import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AHEAD_MOST, Foresight } from '../src/app/Foresight';
import { LivePhysics } from '../src/app/LivePhysics';
import { circularVelocity } from '../src/app/Powers';
import { SolarSystem } from '../src/universe/SolarSystem';

// The Solar System as the app has it: its catalogue and the JPL ephemeris, read from public/ as the browser fetches them.
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;

const DAY = 86_400;
const JD = 2461300.5; // 2026-09-17 (TDB)

/** The Moon taken to twice its distance and left on a circle there (Move, Goes in a circle), time waiting. */
async function moonOut() {
  const sys = await SolarSystem.load('/data');
  await sys.ephemeris.request(JD);
  sys.update(JD);
  const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
  const named = (name: string) => sys.bodies.find((b) => b.name === name)!;
  const earth = named('Earth'), moon = named('Moon');
  const r = moon.pos.clone().sub(earth.pos), w = moon.vel.clone().sub(earth.vel);
  const to = r.clone().multiplyScalar(2), mu = earth.gm + moon.gm;
  const v = circularVelocity(to.toArray(), mu, r.clone().cross(w).normalize().toArray());
  physics.move(moon, earth.pos.clone().add(to).toArray(), [earth.vel.x + v[0], earth.vel.y + v[1], earth.vel.z + v[2]], JD);
  const month = physics.orbit(moon)!.period;
  return { sys, physics, earth, moon, month, live: physics.live! };
}

/** The look ahead grown to its end, a frame's few milliseconds at a time. */
function grown(f: Foresight): number {
  let frames = 0;
  while (!f.done && frames < 100_000) { f.grow(4); frames++; }
  return frames;
}

describe('the future, drawn', () => {
  it('the Moon left on a circle at twice its distance: the look ahead keeps to its new month a while, then says it goes round the Sun, about four months on', async () => {
    const { earth, moon, month, live, sys } = await moonOut();
    // (twice the distance the Moon was at on that day, 405,000 km: 82 days, where twice its mean distance gives 72.7)
    expect(month / (2 * Math.PI * Math.sqrt(moon.pos.distanceTo(earth.pos) ** 3 / (earth.gm + moon.gm)))).toBeCloseTo(1, 9);
    expect(month / DAY).toBeGreaterThan(70);
    const f = new Foresight();
    f.start(live.sim.snapshot(), moon.id, earth.id, month);
    expect(f.count).toBe(1);
    expect(f.done).toBe(false);
    const frames = grown(f);
    expect(frames).toBeGreaterThan(1);
    expect(f.end?.kind).toBe('round');
    const end = f.end as { kind: 'round'; around: number; was: number; time: number };
    expect(sys.byId.get(end.around)).toBe(sys.sun);
    expect(end.was).toBe(earth.id);
    // (out there, 810,000 km from the Earth, the edge of the Earth's reach is near: the Sun has it within four months)
    expect(end.time / DAY).toBeGreaterThan(14);
    expect(end.time / DAY).toBeLessThan(120);
    // the path: from where the Moon is, round the Earth at about twice its old distance at first (a place every few degrees)
    expect(f.count).toBeGreaterThan(50);
    expect(f.count).toBeLessThanOrEqual(AHEAD_MOST);
    const r0 = Math.hypot(f.at[0], f.at[1], f.at[2]);
    expect(r0 / moon.pos.distanceTo(earth.pos)).toBeCloseTo(1, 9);
    for (let k = 1; k < 10; k++) expect(Math.hypot(f.at[3 * k], f.at[3 * k + 1], f.at[3 * k + 2]) / r0).toBeCloseTo(1, 1);
    // (and it never touched the scene: the Moon is where it was put, the live simulation where it was)
    expect(live.sim.time).toBe(f.from);
  });

  it('says what live physics then does: the Moon goes round the Sun when the look ahead said it would', async () => {
    const { earth, moon, month, live, physics, sys } = await moonOut();
    const f = new Foresight();
    f.start(live.sim.snapshot(), moon.id, earth.id, month);
    grown(f);
    const said = f.end!.time;
    // time run on as the app's frames run it, at an eighth of the month a second, sixty frames a second
    const clock = { jdTdb: JD, rate: month / 8, paused: false };
    let jd = JD;
    while (moon.parent === earth && jd < JD + 200) {
      jd += month / 8 / 60 / DAY;
      clock.jdTdb = jd;
      physics.follow(clock as never, 1 / 60);
      sys.update(clock.jdTdb);
      physics.place(clock.jdTdb);
    }
    expect(moon.parent).toBe(sys.sun);
    expect(Math.abs((jd - JD) * DAY - said) / DAY).toBeLessThan(1);
  });

  it('is the path the live simulation then takes, bit for bit, when nothing else changes', async () => {
    const { earth, moon, month, live } = await moonOut();
    const f = new Foresight();
    f.start(live.sim.snapshot(), moon.id, earth.id, month);
    // (a part of it: thirty frames' worth)
    for (let n = 0; n < 30 && !f.done; n++) f.grow(4);
    expect(f.count).toBeGreaterThan(5);
    // the live simulation, with what it carries on rails as a watch of the Moon would have it, taken to each place's time
    const sim = live.sim;
    sim.railsBelow = sim.lightRailsBelow = month / 4;
    let worst = 0;
    for (let k = 1; k < f.count; k++) {
      sim.advance(f.times[k] - sim.time);
      expect(sim.time).toBe(f.times[k]);
      sim.read();
      const i = sim.indexOf(moon.id), j = sim.indexOf(earth.id);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(sim.pos[3 * i + c] - sim.pos[3 * j + c] - f.at[3 * k + c]));
    }
    expect(worst).toBe(0);
  });

  it('a world thrown at another: the look ahead ends where it hits, and says so', async () => {
    const { physics, earth, moon, live } = await moonOut();
    // the Moon, back where it was, sent straight at the Earth at a kilometre a second
    const at = earth.pos.clone().add(moon.pos.clone().sub(earth.pos).multiplyScalar(0.5));
    const towards = earth.pos.clone().sub(at).normalize().multiplyScalar(1e3).add(earth.vel);
    physics.move(moon, at.toArray(), towards.toArray(), JD);
    const f = new Foresight();
    f.start(live.sim.snapshot(), moon.id, earth.id, 2 * Math.PI * Math.sqrt(at.distanceTo(earth.pos) ** 3 / (earth.gm + moon.gm)));
    grown(f);
    expect(f.end?.kind).toBe('hit');
    const end = f.end as { kind: 'hit'; other: number; time: number };
    expect(end.other).toBe(earth.id);
    expect(end.time / DAY).toBeGreaterThan(0.5);
    expect(end.time / DAY).toBeLessThan(3);
    // its last place is the world they became: the Earth, where the path is measured from
    const k = 3 * (f.count - 1);
    expect(Math.hypot(f.at[k], f.at[k + 1], f.at[k + 2])).toBeLessThan(earth.radius);
  });
});
