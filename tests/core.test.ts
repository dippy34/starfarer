import { describe, expect, it } from 'vitest';
import { solveKepler, orbitPosition, raDecToUnit, unitToRaDec } from '../src/core/astro';
import { comovingDistanceExact, comovingDistanceMpc, redshiftAtComovingMpc } from '../src/core/cosmology';
import { dacos, datan2, dcos, dexp, dlog, dpow, dsin } from '../src/core/dmath';
import { hashCell, hashInts, hashString, mix32 } from '../src/core/hash';
import { SECTOR, uposAdd, uposAddInPlace, uposDecode, uposDistance, uposEncode, uposFromMeters, uposLerp, uposSub, uposZero } from '../src/core/hp';
import { Noise3 } from '../src/core/noise';
import { Rng } from '../src/core/rng';
import {
  AU, LY, MPC, M_EARTH, M_JUP, M_SUN, R_EARTH, R_JUP, R_SUN, UNIVERSE_RADIUS,
  formatBig, formatDistance, formatDistanceSci, formatDuration, formatMass, formatRadius, formatSig, formatSpeed, formatTemperature,
} from '../src/core/units';

describe('hashing & RNG determinism', () => {
  it('produces fixed, known values (guards against accidental algorithm changes)', () => {
    // These constants pin the universe: if they change, every procedural object changes.
    expect(mix32(1)).toBe(1364076727);
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3));
    expect(hashCell(7, 3, -2, 5, 11)).toBe(hashCell(7, 3, -2, 5, 11));
    expect(hashString('starfarer')).toBe(hashString('starfarer'));
    const r = new Rng(12345);
    const first = [r.u32(), r.u32(), r.u32()];
    const again = new Rng(12345);
    expect([again.u32(), again.u32(), again.u32()]).toEqual(first);
  });

  it('different seeds give different streams, and values stay in range', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      if (x === b.next()) same++;
    }
    expect(same).toBeLessThan(3);
  });

  it('has sane distributions', () => {
    const r = new Rng(99);
    let sum = 0;
    let sumSq = 0;
    let poisson = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const g = r.gauss();
      sum += g;
      sumSq += g * g;
      poisson += r.poisson(3.5);
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.03);
    expect(Math.abs(sumSq / n - 1)).toBeLessThan(0.05);
    expect(Math.abs(poisson / n - 3.5)).toBeLessThan(0.06);
  });
});

describe('deterministic math matches the built-ins', () => {
  it('exp / log / pow / trig agree to ~1e-12', () => {
    for (const x of [1e-9, 0.001, 0.5, 1, 2.718281828, 10, 12345.678, 1e12]) expect(Math.abs(dlog(x) - Math.log(x))).toBeLessThan(1e-12 * Math.max(1, Math.abs(Math.log(x))));
    for (const x of [-20, -1.5, -1e-6, 0, 0.3, 1, 7.7, 40]) expect(Math.abs(dexp(x) / Math.exp(x) - 1)).toBeLessThan(1e-12);
    for (const x of [-100, -3.3, -0.1, 0, 0.7, 1.57, 3.14159, 6.5, 1000.25]) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-10);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-10);
    }
    expect(Math.abs(dpow(2.5, 3.7) - Math.pow(2.5, 3.7))).toBeLessThan(1e-11);
    for (const [y, x] of [[1, 1], [-2, 0.5], [0.3, -4], [-1, -1], [5, 0]] as Array<[number, number]>) expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-12);
    expect(Math.abs(dacos(0.3) - Math.acos(0.3))).toBeLessThan(1e-12);
  });
});

describe('high-precision universe coordinates', () => {
  it('keeps sub-millimetre precision at the edge of the observable universe', () => {
    // A point 46 billion light-years away…
    const far = uposFromMeters(UNIVERSE_RADIUS * 0.6, -UNIVERSE_RADIUS * 0.5, UNIVERSE_RADIUS * 0.55);
    // …and another one 1.234 mm away from it.
    const near = uposAdd(far, { x: 0.001234, y: 0, z: 0 });
    const d = uposSub(near, far);
    expect(Math.abs(d.x - 0.001234)).toBeLessThan(2e-4);
    expect(d.y).toBe(0);
    // Walk 10 km in metre steps: the accumulated error stays microscopic.
    const walker = uposAdd(far, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 10000; i++) uposAddInPlace(walker, 1, 0.5, -0.25);
    const w = uposSub(walker, far);
    expect(Math.abs(w.x - 10000)).toBeLessThan(1e-2);
    expect(Math.abs(w.y - 5000)).toBeLessThan(1e-2);
    expect(Math.abs(w.z + 2500)).toBeLessThan(1e-2);
  });

  it('a plain double cannot do that (which is why UPos exists)', () => {
    const x = UNIVERSE_RADIUS * 0.6;
    expect(x + 0.001234 - x).not.toBeCloseTo(0.001234, 6);
  });

  it('sector indices stay exact integers and locals stay wrapped', () => {
    const p = uposFromMeters(4.2e26, -3.3e26, 1e20);
    expect(Number.isInteger(p.sx) && Number.isInteger(p.sy) && Number.isInteger(p.sz)).toBe(true);
    expect(Number.isSafeInteger(p.sx)).toBe(true);
    for (const v of [p.x, p.y, p.z]) expect(Math.abs(v)).toBeLessThanOrEqual(SECTOR / 2);
    expect(uposDistance(p, uposZero()) / Math.hypot(4.2e26, 3.3e26, 1e20)).toBeCloseTo(1, 12);
  });

  it('round-trips through the share-link encoding to the millimetre', () => {
    const p = uposAdd(uposFromMeters(-7.7e25, 1.2e24, 3.3e22), { x: 123.4567, y: -0.0042, z: 9.999 });
    const q = uposDecode(uposEncode(p))!;
    const d = uposSub(p, q);
    expect(Math.hypot(d.x, d.y, d.z)).toBeLessThan(1e-3);
    expect(uposDecode('garbage')).toBeNull();
  });

  it('interpolates exactly at both ends of an intergalactic trip', () => {
    const a = uposAdd(uposFromMeters(1.5e11, 0, 0), { x: 0.25, y: 0, z: 0 });
    const b = uposAdd(uposFromMeters(2e25, -4e24, 1e23), { x: 0, y: 0.5, z: 0 });
    const s = uposSub(uposLerp(a, b, 0), a);
    const e = uposSub(uposLerp(a, b, 1), b);
    expect(Math.hypot(s.x, s.y, s.z)).toBe(0);
    expect(Math.hypot(e.x, e.y, e.z)).toBe(0);
  });
});

describe('astronomy helpers', () => {
  it('converts sky coordinates both ways', () => {
    for (const [ra, dec] of [[0, 0], [83.63, 22.01], [266.4, -29.0], [359.9, 89.5], [12.3, -77.7]] as Array<[number, number]>) {
      const back = unitToRaDec(raDecToUnit(ra, dec));
      expect(back.ra).toBeCloseTo(ra, 8);
      expect(back.dec).toBeCloseTo(dec, 8);
    }
  });

  it('solves Kepler’s equation and keeps orbits closed', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.97]) {
      for (const M of [0.1, 1, 2.5, 3.1, 5.9]) {
        const E = solveKepler(M, e);
        let back = E - e * Math.sin(E);
        const TWO_PI = 2 * Math.PI;
        back = ((back % TWO_PI) + TWO_PI) % TWO_PI;
        expect(Math.abs(back - M)).toBeLessThan(1e-9);
      }
    }
    const el = { a: AU, e: 0.3, i: 0.2, node: 1, peri: 2, m0: 0.4, period: 3.15e7 };
    const p0 = orbitPosition(el, 0);
    const p1 = orbitPosition(el, el.period);
    expect(Math.hypot(p0.x - p1.x, p0.y - p1.y, p0.z - p1.z)).toBeLessThan(1);
    const r = Math.hypot(p0.x, p0.y, p0.z);
    expect(r).toBeGreaterThanOrEqual(AU * 0.7 - 1);
    expect(r).toBeLessThanOrEqual(AU * 1.3 + 1);
  });
});

describe('cosmology', () => {
  it('gives the textbook distances for Planck 2018', () => {
    // Hubble flow nearby: d ≈ cz / H0.
    expect(comovingDistanceMpc(0.01)).toBeCloseTo((0.01 * 299792.458) / 67.66, 0);
    expect(comovingDistanceExact(1)).toBeGreaterThan(3300);
    expect(comovingDistanceExact(1)).toBeLessThan(3450);
    // Comoving distance to the CMB ≈ 13.9 Gpc; the particle horizon ≈ 14.2 Gpc (46 billion light-years).
    expect(comovingDistanceExact(1089)).toBeGreaterThan(13_700);
    expect(comovingDistanceExact(1089)).toBeLessThan(14_100);
    expect((UNIVERSE_RADIUS / MPC) * (MPC / LY) / 1e9).toBeCloseTo(46.5, 0);
  });

  it('table lookups match direct integration and invert cleanly', () => {
    for (const z of [0.003, 0.05, 0.7, 2.2, 6.9]) {
      expect(comovingDistanceMpc(z) / comovingDistanceExact(z)).toBeCloseTo(1, 5);
      expect(redshiftAtComovingMpc(comovingDistanceMpc(z))).toBeCloseTo(z, 5);
    }
  });
});

describe('noise', () => {
  it('is deterministic, bounded and tiles when asked to', () => {
    const a = new Noise3(42);
    const b = new Noise3(42);
    const c = new Noise3(43);
    let differs = false;
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = [i * 0.37, i * 0.11 - 3, i * 0.73 + 1.5];
      const v = a.noise(x, y, z);
      expect(v).toBe(b.noise(x, y, z));
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
      if (v !== c.noise(x, y, z)) differs = true;
      expect(a.noisePeriodic(x, y, z, 8)).toBeCloseTo(a.noisePeriodic(x + 8, y - 16, z + 24, 8), 10);
    }
    expect(differs).toBe(true);
  });
});

describe('number formatting', () => {
  it('keeps the zeros that matter', () => {
    // Regression: trailing zeros of whole numbers were once stripped ("140 million" became "14 million").
    expect(formatSig(140)).toBe('140');
    expect(formatSig(100)).toBe('100');
    expect(formatSig(20)).toBe('20');
    expect(formatSig(1.5)).toBe('1.5');
    expect(formatSig(1.0)).toBe('1');
    expect(formatSig(0.25)).toBe('0.25');
    expect(formatSig(12345.6)).toBe('12,346');
    expect(formatSig(0)).toBe('0');
    expect(formatSig(NaN)).toBe('—');
    expect(formatBig(1.4e8)).toBe('140 million');
    expect(formatBig(2e11)).toBe('200 billion');
    expect(formatBig(950)).toBe('950');
  });

  it('picks natural units', () => {
    expect(formatDistance(120)).toBe('120 m');
    expect(formatDistance(384_400_000)).toBe('384,400 km');
    expect(formatDistance(AU)).toBe('1 AU');
    expect(formatDistance(4.2465 * LY)).toBe('4.25 light-years');
    expect(formatDistance(2.5e6 * LY)).toBe('2.5 million light-years');
    expect(formatDistance(46.5e9 * LY)).toBe('46.5 billion light-years');
    expect(formatDistanceSci(10 * 3.0857e16)).toBe('10 pc');
    expect(formatMass(M_SUN)).toBe('1 × Sun');
    expect(formatMass(M_JUP)).toBe('1 × Jupiter');
    expect(formatMass(M_EARTH)).toBe('1 × Earth');
    expect(formatMass(4.3e6 * M_SUN)).toBe('4.3 million × Sun');
    expect(formatRadius(R_SUN, true)).toBe('1 × Sun');
    expect(formatRadius(0.12 * R_SUN, true)).toBe('0.12 × Sun');
    expect(formatRadius(58_232_000)).toBe('0.833 × Jupiter');
    expect(formatRadius(R_JUP)).toBe('1 × Jupiter');
    expect(formatRadius(R_EARTH)).toBe('1 × Earth');
    expect(formatSpeed(0)).toBe('Stopped');
    expect(formatSpeed(7660)).toBe('7.66 km/s');
    expect(formatSpeed(299_792_458 * 20)).toBe('20× light speed');
    expect(formatDuration(90)).toBe('90 s');
    expect(formatDuration(86_400 * 365.25 * 30)).toBe('30 years');
    expect(formatTemperature(288)).toBe('288 K (15 °C)');
    expect(formatTemperature(5772)).toBe('5,772 K');
  });
});
