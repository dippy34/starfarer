import { describe, expect, it } from 'vitest';
import { piecesAt, spread, type Swarm } from '../src/sim/Swarm';

// the Earth and the Moon as the app's catalogue has them (GM m³/s², mean radii m)
const EARTH = { gm: 398600.43550702266e9, r: 6371000.385 }, MOON = { gm: 4902.80011845755e9, r: 1737.4e3 };

/** the Moon come apart on a circle `d` m from the Earth's centre (its tides) */
function moonAt(d: number, seed = 1, count = 200): Swarm {
  const v = Math.sqrt((EARTH.gm + MOON.gm) / d);
  return {
    id: 1, from: 301, name: 'Moon', gm: MOON.gm, radius: MOON.r, color: [0.5, 0.5, 0.5], albedo: 0.12, cause: 'tides',
    host: 399, mu: EARTH.gm, hostRadius: EARTH.r, reach: 1.5e9, t0: 1000, pos: [d, 0, 0], vel: [0, v, 0], count, seed,
  };
}
const turn = (d: number) => 2 * Math.PI * Math.sqrt(d ** 3 / EARTH.gm);

describe('the pieces of a world torn apart', () => {
  it('start inside the world, moving as its parts did: with it, and turning with it once a turn of its orbit', () => {
    const sw = moonAt(15000e3), sp = spread(sw);
    let far = 0, cx = 0, cvy = 0;
    for (let k = 0; k < sw.count; k++) {
      const dx = sp.r0[3 * k] - 15000e3, dy = sp.r0[3 * k + 1], dz = sp.r0[3 * k + 2];
      far = Math.max(far, Math.hypot(dx, dy, dz));
      cx += dx / sw.count;
      cvy += sp.v0[3 * k + 1] / sw.count;
      // (its spin is its orbit's: a part ahead or behind moves outwards or inwards by ω times how far)
      const w = sw.vel[1] / 15000e3;
      expect(sp.v0[3 * k] + w * dy).toBeCloseTo(0, 6);
    }
    expect(far).toBeLessThanOrEqual(MOON.r);
    expect(Math.abs(cx)).toBeLessThan(0.15 * MOON.r);
    expect(Math.abs(cvy / sw.vel[1] - 1)).toBeLessThan(0.02);
    // a piece: the Moon's volume shared among 200
    expect(sp.piece).toBeCloseTo(MOON.r / Math.cbrt(200), 6);
  });

  it('the same pieces from the same record, on every call; others from another seed', () => {
    const a = spread(moonAt(15000e3)), b = spread(moonAt(15000e3)), c = spread(moonAt(15000e3, 2));
    expect(Array.from(b.r0)).toEqual(Array.from(a.r0));
    expect(Array.from(b.v0)).toEqual(Array.from(a.v0));
    expect(Array.from(c.r0)).not.toEqual(Array.from(a.r0));
  });

  it('torn 15,000 km out, every piece goes round, on orbits as different as the Moon is large against its distance: a ring within about a turn', () => {
    const d = 15000e3, sw = moonAt(d), sp = spread(sw), P = turn(d);
    expect(Array.from(sp.ring).every((x) => x === 1)).toBe(true);
    expect(Array.from(sp.fall).every((x) => x === Infinity)).toBe(true);
    // the ring from about 9,000 to 26,000 km, its pole the Moon's orbit's
    expect(sp.inner).toBeGreaterThan(EARTH.r);
    expect(sp.inner).toBeLessThan(d);
    expect(sp.outer).toBeGreaterThan(d);
    expect(sp.pole[2]).toBeCloseTo(1, 6);
    // (a part 1,737 km out has its energy changed by 2μδ/d², half from where it is and half from its spin: its orbit's size by
    // 4δ/d, 46 %, and how fast it goes round by 1.5 times that: the fastest and the slowest part a turn in 0.7 of a turn)
    const wrap = (2 * Math.PI) / sp.shear / P;
    expect(wrap).toBeGreaterThan(0.5);
    expect(wrap).toBeLessThan(1);
    // the profile of the ring: the most 1, nothing outside it
    expect(Math.max(...sp.profile)).toBe(1);
    expect(Math.min(...sp.profile)).toBeGreaterThanOrEqual(0);
    // at the start, where they began
    const out = new Float64Array(3 * sw.count), shown = new Uint8Array(sw.count);
    piecesAt(sw, sp, sw.t0, out, shown);
    for (let k = 0; k < 3 * sw.count; k++) expect(out[k]).toBe(sp.r0[k]);
  });

  it('Io torn apart just inside Jupiter\'s limit (small beside Jupiter) stretches over several turns into a stream, then a ring', () => {
    // (Jupiter and Io as the catalogue has them; Io 120,000 km out, inside its limit of 124,000 km)
    const J = 126686531.9003704e9, io = { gm: 5959.915466180539e9, r: Math.cbrt(1829.4 * 1819.4 * 1815.7) * 1e3 }, d = 120000e3;
    const sw: Swarm = { ...moonAt(d), from: 501, name: 'Io', gm: io.gm, radius: io.r, host: 599, mu: J, hostRadius: Math.cbrt(71492 ** 2 * 66854) * 1e3, pos: [d, 0, 0], vel: [0, Math.sqrt((J + io.gm) / d), 0] };
    const sp = spread(sw), P = 2 * Math.PI * Math.sqrt(d ** 3 / J);
    const wrap = (2 * Math.PI) / sp.shear / P;
    expect(wrap).toBeGreaterThan(3);
    expect(wrap).toBeLessThan(10);
    const out = new Float64Array(3 * sw.count), shown = new Uint8Array(sw.count);
    const azimuths = (t: number) => {
      expect(piecesAt(sw, sp, sw.t0 + t, out, shown)).toBe(sw.count);
      const bins = new Array(12).fill(0);
      for (let k = 0; k < sw.count; k++) bins[Math.floor(((Math.atan2(out[3 * k + 1], out[3 * k]) + Math.PI) / (2 * Math.PI)) * 12) % 12]++;
      return bins.filter((x: number) => x > 0).length;
    };
    // at first a clump (a twelfth of the circle or two), a turn on a stream (a few twelfths), after two wraps a ring (all)
    expect(azimuths(0)).toBeLessThanOrEqual(2);
    const stream = azimuths(P);
    expect(stream).toBeGreaterThan(1);
    expect(stream).toBeLessThan(12);
    expect(azimuths(2 * wrap * P)).toBe(12);
  });

  it('torn just above the ground, some pieces fall back: each at the moment its path meets the ground, and then is not there', () => {
    const d = EARTH.r + 1.2 * MOON.r, sw = moonAt(d, 3), sp = spread(sw);
    const fallen = Array.from(sp.fall).filter((t) => t < Infinity);
    expect(fallen.length).toBeGreaterThan(10);
    const out = new Float64Array(3 * sw.count), shown = new Uint8Array(sw.count);
    for (let k = 0; k < sw.count; k++) {
      if (!(sp.fall[k] < Infinity)) continue;
      // just before, still above the ground; just after, not shown
      piecesAt(sw, sp, sw.t0 + sp.fall[k] * (1 - 1e-6), out, shown);
      expect(shown[k]).toBe(1);
      expect(Math.hypot(out[3 * k], out[3 * k + 1], out[3 * k + 2])).toBeGreaterThan(EARTH.r * (1 - 1e-6));
      piecesAt(sw, sp, sw.t0 + sp.fall[k] * (1 + 1e-6) + 1e-3, out, shown);
      expect(shown[k]).toBe(0);
    }
    // (what does not fall goes round, and makes the ring)
    expect(Array.from(sp.ring).filter((x) => x).length + fallen.length).toBeLessThanOrEqual(sw.count);
  });
});
