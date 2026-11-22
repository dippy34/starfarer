import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LivePhysics } from '../src/app/LivePhysics';
import { SimClock } from '../src/core/time';
import { SolarSystem } from '../src/universe/SolarSystem';

// Playtest D4: with the Sun made as light as Jupiter, the news said "Jupiter is flying free" five times over
// (and "The Sun ..." three times), and "So is 2 smaller bodies".
const PUBLIC = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(PUBLIC, String(url).replace(/^\//, ''))))) as typeof fetch;
const JD = 2461300.5;

describe('the news of bodies set free', () => {
  it('tells each world once, names the planets before "others", and counts the small bodies in good English', async () => {
    const sys = await SolarSystem.load('/data');
    await sys.ephemeris.request(JD);
    sys.update(JD);
    const physics = new LivePhysics(sys, { left: () => undefined, dropped: () => undefined });
    const clock = new SimClock(JD);
    const jupiter = sys.bodies.find((b) => b.name === 'Jupiter')!;
    physics.setMass(sys.sun, jupiter.gm, JD);
    const news: string[] = [...physics.takeNews()];
    for (let n = 0; n < 400; n++) {
      clock.jdTdb += 1;
      physics.follow(clock, 1);
      sys.update(clock.jdTdb);
      physics.place(clock.jdTdb);
      news.push(...physics.takeNews());
    }
    const freed = news.filter((t) => / flying free: /.test(t));
    expect(freed.length).toBeGreaterThan(1);
    const named = freed.flatMap((t) => t.slice(0, t.indexOf(' is flying') >= 0 ? t.indexOf(' is flying') : t.indexOf(' are flying')).replace(/ and \d+ others$/, '').split(/, | and /));
    // no world told twice
    expect(new Set(named).size).toBe(named.length);
    // the four giants named outright in the first
    for (const p of ['Jupiter', 'Saturn', 'Uranus', 'Neptune']) expect(freed[0]).toContain(p);
    // "So is one smaller body" / "So are 6 smaller bodies", never "So is 2 ..."
    for (const t of freed) expect(t).toMatch(/flying free: nothing holds (it|them) now\.( So is one smaller body\.| So are ([2-9]|\d\d+) smaller bodies\.)?$/);
  }, 120_000);
});
