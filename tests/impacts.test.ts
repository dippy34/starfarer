import { describe, expect, it } from 'vitest';
import { SHOW, SlowMotion } from '../src/app/Impacts';

/**
 * Two worlds falling together, as the look for hits ahead sees them (Powers.soonestContact): they
 * touch `contact` simulated seconds from the start, and come within the zone `zone` seconds from
 * it; `run` takes frames of `dt` at `rate` until they meet, and says how long that took on the screen.
 */
function fall(contact: number, zone: number, rate: number, dt = 1 / 60) {
  const slow = new SlowMotion<string>();
  let t = 0, screen = 0, slowedAt = -1, zoneAt = -1, frames = 0;
  while (t < contact && frames < 1e6) {
    const next = { a: 'Mars', b: 'Earth', contact: contact - t, zone: Math.max(0, zone - t) };
    const run = slow.run(dt, rate, next);
    if (run.slowed) { slowedAt = screen; zoneAt = t + run.seconds; }
    t += run.seconds;
    screen += dt;
    frames++;
  }
  return { slow, screen, slowedAt, zoneAt, t };
}

describe('time slowed to see two worlds meet', () => {
  it('a fall over in a blink is slowed as the two come within the zone: the rest of it takes three seconds on the screen', () => {
    // the last 2 hours of a fall at 3 days a second: a tenth of a frame
    const { slowedAt, zoneAt, screen, slow } = fall(10 * 86_400, 10 * 86_400 - 7200, 3 * 86_400);
    expect(slowedAt).toBeGreaterThan(0);
    // (the frame that reaches the zone stops on its edge)
    expect(zoneAt).toBe(10 * 86_400 - 7200);
    expect(slow.cap).toBeCloseTo(7200 / SHOW, 9);
    expect(screen - slowedAt).toBeGreaterThan(SHOW - 0.02);
    expect(screen - slowedAt).toBeLessThan(SHOW + 0.04);
    expect(slow.phase).toBe('coming');
  });

  it('a fall that takes long enough as it is is left as it is, then and as the two come nearer', () => {
    const rate = 600, { slowedAt, screen, slow } = fall(10 * 86_400, 10 * 86_400 - 7200, rate);
    expect(slowedAt).toBe(-1);
    expect(screen).toBeCloseTo((10 * 86_400) / rate, 0);
    expect(slow.phase).toBe('idle');
  });

  it('once they have met, time stays slow a moment, then comes back to the rate asked for, doubling', () => {
    const rate = 3 * 86_400, { slow } = fall(10 * 86_400, 10 * 86_400 - 7200, rate);
    slow.hit();
    expect(slow.phase).toBe('after');
    const cap = slow.cap;
    let screen = 0;
    while (slow.phase !== 'idle' && screen < 30) { slow.run(1 / 60, rate, null); screen += 1 / 60; }
    // (1.2 s held, then from 2,400 s a second to 3 days a second at twice every quarter second: 1.7 s more)
    expect(screen).toBeCloseTo(1.2 + 0.25 * Math.log2(rate / cap), 1);
    expect(slow.cap).toBe(Infinity);
    expect(slow.run(1 / 60, rate, null).seconds).toBe(rate / 60);
  });

  it('two that pass each other after all: time comes back at once, and they are not slowed for again', () => {
    const rate = 3 * 86_400, slow = new SlowMotion<string>();
    const near = { a: 'Mars', b: 'Earth', contact: 7200, zone: 0 };
    expect(slow.run(1 / 60, rate, near).slowed).toBe(true);
    expect(slow.run(1 / 60, rate, null).seconds).toBeLessThan(rate / 60);
    expect(slow.phase).toBe('after');
    let n = 0;
    while (slow.phase !== 'idle' && n++ < 1000) slow.run(1 / 60, rate, null);
    expect(slow.phase).toBe('idle');
    expect(slow.run(1 / 60, rate, near)).toEqual({ seconds: rate / 60, slowed: false });
    // the explorer's own act forgets them: a hit ahead is judged afresh
    slow.reset();
    expect(slow.run(1 / 60, rate, near).slowed).toBe(true);
  });

  it('never slows time that stands still or runs back, nor below real time', () => {
    const slow = new SlowMotion<string>(), near = { a: 'Mars', b: 'Earth', contact: 1, zone: 0 };
    expect(slow.run(1 / 60, 0, near)).toEqual({ seconds: 0, slowed: false });
    expect(slow.run(1 / 60, -86_400, near)).toEqual({ seconds: -86_400 / 60, slowed: false });
    expect(slow.run(1 / 60, 86_400, near).seconds).toBe(1 / 60);
  });
});
