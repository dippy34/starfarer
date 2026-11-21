import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ephemeris, type EphemerisIndex } from '../src/astro/ephemeris';
import { J2000_JD } from '../src/core/units';

const DATA = join(fileURLToPath(new URL('..', import.meta.url)), 'public/data/ephem');
const index = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8')) as EphemerisIndex;
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ephemeris streaming', () => {
  it('retries a failed chunk after a growing pause, not on every frame', async () => {
    let online = false;
    let fetches = 0;
    globalThis.fetch = (async (url: string | URL) => {
      fetches++;
      if (!online) throw new TypeError('network down');
      return new Response(readFileSync(join(DATA, String(url).split('/').pop()!)));
    }) as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const eph = new Ephemeris(index, '/data/ephem', {});
    let clock = 0;
    eph.now = () => clock;

    // a second of frames while the network is down: one download attempt, one console error
    for (let frame = 0; frame < 60; frame++) { eph.request(J2000_JD); await settle(); clock += 1000 / 60; }
    expect(fetches).toBe(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(eph.isLoaded(J2000_JD)).toBe(false);

    // the pauses double: 2 s, 4 s, 8 s … capped at a minute
    const attempts: number[] = [];
    for (let t = 1; t <= 300; t++) {
      clock = t * 1000;
      const before = fetches;
      eph.request(J2000_JD);
      await settle();
      if (fetches > before) attempts.push(t);
    }
    expect(attempts).toEqual([2, 6, 14, 30, 62, 122, 182, 242]);
    expect(errors).toHaveBeenCalledTimes(1);

    // back online: the next attempt loads the chunk, and positions come from it
    online = true;
    clock += 61_000;
    await eph.request(J2000_JD);
    expect(eph.isLoaded(J2000_JD)).toBe(true);
    const earthMoonBarycentre = new Vector3();
    expect(eph.evaluate(0, 3, J2000_JD, earthMoonBarycentre)).toBe(true);
    expect(earthMoonBarycentre.length() / 1.495978707e8).toBeCloseTo(0.98, 1); // AU from the barycentre in early January
    const loaded = fetches;
    for (let frame = 0; frame < 10; frame++) eph.request(J2000_JD);
    expect(fetches).toBe(loaded);
  });

  it('shares one download between concurrent requests for the same chunk', async () => {
    let fetches = 0;
    globalThis.fetch = (async (url: string | URL) => {
      fetches++;
      return new Response(readFileSync(join(DATA, String(url).split('/').pop()!)));
    }) as typeof fetch;
    const eph = new Ephemeris(index, '/data/ephem', {});
    await Promise.all([eph.request(J2000_JD), eph.request(J2000_JD + 1), eph.request(J2000_JD + 2)]);
    expect(fetches).toBe(1);
  });

  it('loads every decade, and each takes up where the one before left off', async () => {
    // (seven of the files hold an odd number of 32-bit floats, so their length is not a multiple of 8: a view of
    // doubles over the whole file threw, and those decades never loaded)
    globalThis.fetch = (async (url: string | URL) => new Response(readFileSync(join(DATA, String(url).split('/').pop()!)))) as typeof fetch;
    const eph = new Ephemeris(index, '/data/ephem', {});
    const sun = new Vector3(), emb = new Vector3(), before = new Vector3(), after = new Vector3();
    const AU_KM = 1.495978707e8;
    let odd = 0;
    for (const [k, c] of index.chunks.entries()) {
      if (readFileSync(join(DATA, c.file)).byteLength % 8) odd++;
      const mid = (c.jd0 + c.jd1) / 2;
      await eph.request(mid);
      expect(eph.isLoaded(mid), c.file).toBe(true);
      // the Earth and Moon's centre is an astronomical unit from the Sun
      expect(eph.evaluate(0, 10, mid, sun) && eph.evaluate(0, 3, mid, emb), c.file).toBe(true);
      expect(emb.distanceTo(sun) / AU_KM, c.file).toBeGreaterThan(0.98);
      expect(emb.distanceTo(sun) / AU_KM, c.file).toBeLessThan(1.02);
      if (k === 0) continue;
      // a tenth of a second either side of where two files meet: the 3 km it moves in that time, and no more
      await eph.request(c.jd0 - 1e-6);
      eph.evaluate(0, 3, c.jd0 - 1e-6, before);
      eph.evaluate(0, 3, c.jd0 + 1e-6, after);
      expect(after.distanceTo(before), c.file).toBeLessThan(10);
    }
    expect(odd).toBeGreaterThan(0);
  });

  it('knows its own range and declines dates outside it', () => {
    const eph = new Ephemeris(index, '/data/ephem', {});
    expect(eph.inRange(J2000_JD)).toBe(true);
    expect(eph.inRange(index.jdStart - 1)).toBe(false);
    expect(eph.inRange(index.jdEnd)).toBe(false);
    expect(eph.request(index.jdEnd + 10)).toBeNull();
    expect(eph.evaluate(0, 3, index.jdEnd + 10, new Vector3())).toBe(false);
  });
});
