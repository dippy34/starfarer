import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SUN_ABS_MAG, SUN_RADIUS, SUN_TEFF } from '../src/core/units';
import { absMagForRadius, bolometricCorrection, estimateStarRadius } from '../src/universe/StarRadii';
import { CatalogStar } from '../src/universe/Stars';

const star = (names: string[], absMag: number, teff: number) => new CatalogStar('t', new Vector3(1, 0, 0), absMag, teff, '', names, null);

describe('star radii', () => {
  it('the bolometric correction of Torres (2010): small for the Sun, large for cool and hot stars', () => {
    expect(bolometricCorrection(SUN_TEFF)).toBeCloseTo(-0.08, 2);
    expect(bolometricCorrection(10000)).toBeCloseTo(-0.25, 2);
    expect(bolometricCorrection(30000)).toBeCloseTo(-2.89, 2);
    expect(bolometricCorrection(3600)).toBeLessThan(-1.9);
    // where the polynomial changes (log Teff 3.70 and 3.90) the published pieces meet within 0.03 mag
    for (const x of [3.7, 3.9]) expect(Math.abs(bolometricCorrection(10 ** (x + 1e-9)) - bolometricCorrection(10 ** (x - 1e-9)))).toBeLessThan(0.03);
    // below 3,300 K the polynomial is not followed down
    expect(bolometricCorrection(2500)).toBe(bolometricCorrection(3300));
  });

  it('the Sun comes out at its own radius, and the radius and the magnitude invert each other', () => {
    expect(estimateStarRadius(SUN_ABS_MAG, SUN_TEFF) / SUN_RADIUS).toBeCloseTo(1, 12);
    for (const [r, t] of [[0.15, 3100], [1, 5772], [8, 12000], [700, 3600]]) {
      expect(estimateStarRadius(absMagForRadius(r, t), t) / SUN_RADIUS).toBeCloseTo(r, 9);
    }
  });

  it('a red dwarf and a red supergiant are no longer several times too small', () => {
    // Proxima as the catalogue has it (M_V 15.44, 3,383 K from its colour), measured 0.145 R☉:
    // without the correction 0.022
    const proxima = estimateStarRadius(15.44, 3383) / SUN_RADIUS;
    expect(proxima).toBeGreaterThan(0.06);
    expect(proxima).toBeLessThan(0.2);
    // Betelgeuse as the catalogue has it (M_V -5.47, 3,794 K), measured 764 R☉ (at 168 pc): without it 270
    const betelgeuse = estimateStarRadius(-5.47, 3794) / SUN_RADIUS;
    expect(betelgeuse).toBeGreaterThan(400);
  });

  it('a star with a measured radius has it, and says so', () => {
    const p = star(['Proxima Centauri', 'Gl 551'], 15.44, 3383);
    expect(p.radius / SUN_RADIUS).toBeCloseTo(0.145, 6);
    expect(p.teff).toBe(3042);
    const rows = Object.fromEntries(p.info());
    expect(rows.Radius).toMatch(/0\.145 R☉ \(measured: Ségransan et al\. 2003\)/);
    expect(rows.Temperature).toMatch(/3,042 K \(measured/);
    const b = star(['Betelgeuse'], -5.47, 3794);
    expect(b.radius / SUN_RADIUS).toBeCloseTo(764, 6);
    expect(b.teff).toBe(3794);
    const other = star(['HIP 25'], 1.73, 5395);
    expect(Object.fromEntries(other.info()).Radius).toMatch(/\(estimated\)/);
  });
});
