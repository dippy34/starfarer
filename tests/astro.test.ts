import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { isOpen, keplerState, openPath, perifocalMatrix, solveKeplerElliptic, solveKeplerHyperbolic, stateToElements } from '../src/astro/kepler';
import { blackbodyRGB, bvToTeff, magToIrradiance, irradianceToMag } from '../src/astro/photometry';
import { evaluateRotation, orientationMatrix } from '../src/astro/rotation';
import { GAL_TO_EQU, vectorToRaDec } from '../src/core/frames';
import { calendarToJd, jdToCalendar, setLeapSeconds, tdbToUtc, utcToTdb } from '../src/core/time';
import { AU, GM_SUN } from '../src/core/units';
import { UPos } from '../src/core/upos';
import { SolarSystem, type SystemJson } from '../src/universe/SolarSystem';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUB = join(ROOT, 'public');

// Serve /data/... from public/ for modules that fetch().
globalThis.fetch = (async (input: string | URL) => {
  const path = join(PUB, String(input).replace(/^\//, ''));
  const buf = readFileSync(path);
  return new Response(buf);
}) as typeof fetch;

describe('time scales', () => {
  it('J2000 epoch', () => {
    expect(calendarToJd(2000, 1, 1.5)).toBe(2451545.0);
    const c = jdToCalendar(2451545.0);
    expect([c.year, c.month, c.day, c.hour]).toEqual([2000, 1, 1, 12]);
  });
  it('UTC <-> TDB with leap seconds', () => {
    setLeapSeconds([[1972, 1, 1, 10], [2017, 1, 1, 37]]);
    const utc = calendarToJd(2026, 10, 1);
    expect((utcToTdb(utc) - utc) * 86400).toBeCloseTo(69.184, 3);
    expect(Math.abs(tdbToUtc(utcToTdb(utc)) - utc) * 86400).toBeLessThan(1e-4);
  });
});

describe('double-double positions', () => {
  it('keeps millimetres at 100 Mpc', () => {
    const big = 3.0857e24; // ~100 Mpc in metres
    const a = UPos.from(big, -big, big);
    const b = a.clone().addXYZ(1e-3, 2e-3, -3e-3);
    const d = b.sub(a);
    expect(d.x).toBeCloseTo(1e-3, 9);
    expect(d.y).toBeCloseTo(2e-3, 9);
    expect(d.z).toBeCloseTo(-3e-3, 9);
  });

  it('matches the textbook double-double formulas bit for bit', () => {
    // Reference: the error-free transformations written out with explicit (high, low) pairs.
    const twoSum = (a: number, b: number): [number, number] => { const s = a + b; const bb = s - a; return [s, a - (s - bb) + (b - bb)]; };
    const refAdd = (h: number, l: number, b: number): [number, number] => { const [s, e] = twoSum(h, b); const e2 = e + l; const r = s + e2; return [r, e2 - (r - s)]; };
    const refAddDD = (ah: number, al: number, bh: number, bl: number): [number, number] => { const [s, e] = twoSum(ah, bh); const e2 = e + al + bl; const r = s + e2; return [r, e2 - (r - s)]; };
    const refSub = (ah: number, al: number, bh: number, bl: number): number => { const [s, e] = twoSum(ah, -bh); return s + (e + al - bl); };
    let seed = 20261001;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const any = () => (rnd() - 0.5) * 10 ** (rnd() * 34 - 6); // millimetres to beyond the observable universe
    for (let i = 0; i < 3000; i++) {
      const p = UPos.from(any(), any(), any());
      const q = UPos.from(any(), any(), any()).addXYZ(any(), any(), any());
      let h = p.xh, l = p.xl;
      for (let k = 0; k < 4; k++) {
        const dx = any();
        p.addXYZ(dx, 0, 0);
        [h, l] = refAdd(h, l, dx);
      }
      expect(Object.is(p.xh, h) && Object.is(p.xl, l)).toBe(true);
      expect(Object.is(p.sub(q).x, refSub(h, l, q.xh, q.xl))).toBe(true);
      p.addUPos(q);
      [h, l] = refAddDD(h, l, q.xh, q.xl);
      expect(Object.is(p.xh, h) && Object.is(p.xl, l)).toBe(true);
    }
  });

  it('walks a kilometre in millimetre steps at the edge of the observable universe without drift', () => {
    const edge = 4.4e26; // m
    const a = UPos.from(edge, -edge, edge);
    const b = a.clone();
    for (let i = 0; i < 1_000_000; i++) b.addXYZ(1e-3, -1e-3, 0);
    const d = b.sub(a);
    expect(d.x).toBeCloseTo(1000, 6);
    expect(d.y).toBeCloseTo(-1000, 6);
    expect(d.z).toBe(0);
  });

  it('interpolates between far-apart positions on their difference', () => {
    const a = UPos.from(3.0857e24, 0, 0).addXYZ(0.25, 0, 0);
    const b = a.clone().addXYZ(8, -4, 2);
    const m = UPos.lerp(a, b, 0.25);
    const d = m.sub(a);
    expect([d.x, d.y, d.z]).toEqual([2, -1, 0.5]);
  });
});

describe('frames', () => {
  it('Galactic centre direction (l=0, b=0) is RA 266.405°, Dec −28.936°', () => {
    const v = new Vector3(1, 0, 0).applyMatrix3(GAL_TO_EQU);
    const { ra, dec } = vectorToRaDec(v);
    expect(ra).toBeCloseTo(266.405, 2);
    expect(dec).toBeCloseTo(-28.936, 2);
  });
  it('north Galactic pole', () => {
    const { ra, dec } = vectorToRaDec(new Vector3(0, 0, 1).applyMatrix3(GAL_TO_EQU));
    expect(ra).toBeCloseTo(192.85948, 4);
    expect(dec).toBeCloseTo(27.12825, 4);
  });
});

describe('Kepler solvers', () => {
  it('elliptic', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.99, 0.9999]) {
      for (const M of [-3, -1, -0.01, 0.001, 0.5, 2, 3.1]) {
        const E = solveKeplerElliptic(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
      }
    }
  });
  it('hyperbolic', () => {
    for (const e of [1.01, 1.5, 3]) for (const M of [-20, -1, 0.1, 5, 50]) {
      const H = solveKeplerHyperbolic(M, e);
      expect(e * Math.sinh(H) - H).toBeCloseTo(M, 8);
    }
  });
  it('state -> elements -> state round trip', () => {
    const el = { q: 0.8 * AU, e: 0.3, i: 12, node: 40, peri: 70, tp: 2451000, mu: GM_SUN };
    const r = new Vector3(), v = new Vector3();
    keplerState(el, 2451234.5, r, v);
    const el2 = stateToElements(r, v, GM_SUN, 2451234.5);
    const r2 = new Vector3();
    keplerState(el2, 2451400, r2);
    const r1 = new Vector3();
    keplerState(el, 2451400, r1);
    expect(r1.distanceTo(r2)).toBeLessThan(1); // metres
  });
  it('an open path is drawn from q and the true anomaly: at exactly the speed of escape a parabola, beyond it a hyperbola, from the body outwards', () => {
    // (the Moon thrown square to the line from the Earth, at the speed of escape and at 1.6 times the speed of a circle)
    const mu = 4.035e14, q = 3.844e8, out = new Float64Array(2 * 220);
    for (const f of [Math.SQRT2, 1.6]) {
      const r = new Vector3(q, 0, 0), v = new Vector3(0, f * Math.sqrt(mu / q), 0);
      const el = stateToElements(r, v, mu, 2461315);
      // (at exactly the speed of escape rounding puts it on either side of e = 1: the energy says it is open)
      expect(isOpen(v.lengthSq() / 2 - mu / q, mu, q)).toBe(true);
      const e = Math.max(1, el.e);
      expect(e).toBeCloseTo(f * f - 1, 9);
      const n = openPath(el.q, e, 0, 4 * q, 192, 14, out);
      expect(n).toBe(1 + 14 + 192);
      expect([out[0], out[1]]).toEqual([0, 0]);
      // every point is on the conic r (1 + e cos ν) = q (1 + e), measured from the Earth, and they go out from the body
      let last = 0;
      for (let k = 0; k < n; k++) {
        const x = q + out[2 * k], y = out[2 * k + 1], d = Math.hypot(x, y), nu = Math.atan2(y, x);
        expect(d * (1 + e * Math.cos(nu)) / (q * (1 + e))).toBeCloseTo(1, 12);
        expect(nu).toBeGreaterThanOrEqual(last);
        last = nu;
      }
      // the last point is as far out as asked: four times the distance it was thrown from
      expect(Math.hypot(q + out[2 * n - 2], out[2 * n - 1]) / (4 * q)).toBeCloseTo(1, 9);
    }
    // a hyperbola never turns as far as its asymptote, however far out it is drawn
    const n = openPath(q, 1.56, 0, 1e6 * q, 192, 14, out);
    expect(Math.atan2(out[2 * n - 1], q + out[2 * n - 2])).toBeLessThan(Math.acos(-1 / 1.56));
    // one coming in is drawn on through its nearest point; one already beyond the end gets no path
    const inbound = openPath(q, 1, -1, 4 * q, 192, 14, out);
    expect(Math.atan2(out[2 * inbound - 1], q * 2 / (1 + Math.cos(-1)) * Math.cos(-1) + out[2 * inbound - 2])).toBeGreaterThan(0);
    expect(openPath(q, 1, 2.5, 4 * q, 192, 14, out)).toBe(1);
    // the true anomaly is read from where the body is, in the plane of the path
    const el = stateToElements(new Vector3(0, q, 0), new Vector3(-Math.SQRT2 * Math.sqrt(mu / q), 0, 0), mu, 0);
    const R = perifocalMatrix(el.i, el.node, el.peri).elements;
    expect(Math.atan2(q * R[4], q * R[1])).toBeCloseTo(0, 6);
  });
  it('a bound orbit is not open, however near the edge, and an exact escape is', () => {
    expect(isOpen(-1e-9, 1, 1)).toBe(false);
    expect(isOpen(-1e-13, 1, 1)).toBe(true);
    expect(isOpen(0, 1, 1)).toBe(true);
  });
  it('near-parabolic is continuous across e = 1', () => {
    const base = { q: AU, i: 10, node: 20, peri: 30, tp: 2460000, mu: GM_SUN };
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    keplerState({ ...base, e: 0.999995 }, 2460030, a);
    keplerState({ ...base, e: 1.0 }, 2460030, b);
    keplerState({ ...base, e: 1.000005 }, 2460030, c);
    expect(a.distanceTo(b) / b.length()).toBeLessThan(1e-4);
    expect(c.distanceTo(b) / b.length()).toBeLessThan(1e-4);
  });
});

describe('photometry', () => {
  it('magnitude <-> irradiance', () => {
    expect(irradianceToMag(magToIrradiance(3.7))).toBeCloseTo(3.7, 10);
    expect(magToIrradiance(-26.74)).toBeCloseTo(Math.PI, 10);
  });
  it('blackbody colours', () => {
    const cool = blackbodyRGB(3000), sun = blackbodyRGB(5772), hot = blackbodyRGB(20000);
    expect(cool[0]).toBeGreaterThan(cool[2]);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(Math.min(...sun)).toBeGreaterThan(0.75); // the Sun is nearly white
    expect(bvToTeff(0.65)).toBeGreaterThan(5600);
    expect(bvToTeff(0.65)).toBeLessThan(6000);
  });
});

describe('Solar System vs JPL Horizons', () => {
  let sys: SolarSystem;
  const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/horizons.json'), 'utf8'));
  beforeAll(async () => {
    sys = await SolarSystem.load('/data');
  });

  const vec = (target: number, center: number, jd: number) =>
    fixture.vectors.find((v: { target: number; center: number; jd: number }) => v.target === target && v.center === center && v.jd === jd).km as number[];

  it.each([
    // [target, center, tolerance km]
    [399, 0, 50], [10, 0, 5], [4, 0, 200], [5, 0, 500], [6, 0, 2000], [8, 0, 5000], [9, 0, 20000], [301, 399, 1],
  ])('DE442S body %i wrt %i matches Horizons (DE441) within %i km', async (target, center, tol) => {
    for (const jd of [2461315.5, 2451545.0, 2433282.5]) {
      await sys.ephemeris.request(jd);
      const p = new Vector3();
      if (target === 301) {
        const a = new Vector3(), b = new Vector3();
        sys.ephemeris.evaluate(3, 301, jd, a);
        sys.ephemeris.evaluate(3, 399, jd, b);
        p.copy(a).sub(b);
      } else if (target === 399) {
        const a = new Vector3();
        sys.ephemeris.evaluate(0, 3, jd, p);
        sys.ephemeris.evaluate(3, 399, jd, a);
        p.add(a);
      } else {
        sys.ephemeris.evaluate(center, target, jd, p);
      }
      const ref = vec(target, center, jd);
      const err = Math.hypot(p.x - ref[0], p.y - ref[1], p.z - ref[2]);
      expect(err, `jd ${jd}`).toBeLessThan(tol);
    }
  });

  it.each([
    // moon, planet, max error as fraction of the orbit radius (mean elements are approximate)
    ['Io', 599, 0.03], ['Titan', 699, 0.05], ['Triton', 899, 0.01], ['Phobos', 499, 0.07], ['Charon', 999, 0.01], ['Miranda', 799, 0.03],
  ])('%s (calibrated JPL elements) tracks Horizons', async (name, planetId, tol) => {
    const moon = sys.bodies.find((b) => b.name === name)!;
    const planet = sys.byId.get(planetId)!;
    for (const jd of [2461315.5, 2451545.0, 2433282.5]) {
      await sys.ephemeris.request(jd);
      sys.update(jd);
      const rel = moon.pos.clone().sub(planet.pos).multiplyScalar(1e-3);
      const ref = vec(moon.id, planetId, jd);
      const r = Math.hypot(ref[0], ref[1], ref[2]);
      const err = Math.hypot(rel.x - ref[0], rel.y - ref[1], rel.z - ref[2]);
      expect(err / r, `${name} @ ${jd}: ${err.toFixed(0)} km of ${r.toFixed(0)} km`).toBeLessThan(tol);
    }
  });

  it('Earth orientation: prime meridian near GMST at J2000', () => {
    const earth = sys.byId.get(399)!;
    const o = evaluateRotation(earth.rotation!, sys.data.nutPrecAngles, 2451545.0, { ra: 0, dec: 0, w: 0 });
    const m = orientationMatrix(o);
    const greenwich = new Vector3(1, 0, 0).applyMatrix4(m);
    const { ra } = vectorToRaDec(greenwich);
    expect(Math.abs(ra - 280.46)).toBeLessThan(0.5); // GMST at J2000.0 = 280.46°
  });
});

export type { SystemJson };
