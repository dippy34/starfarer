import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { SUN_RADIUS } from '../src/core/units';
import { CatalogStar, estimateStarRadius } from '../src/universe/Stars';
import { shapeAxis, shapeFlattening, starShape } from '../src/universe/StarShapes';

const deg = Math.PI / 180;
/** where the catalogue has them from the Sun (pc: public/data/stars/named.json) */
const ALTAIR = new Vector3(2.3555, -4.4876, 0.7907);
const VEGA = new Vector3(0.9605, -5.9082, 4.8097);
const REGULUS = new Vector3(-21.0189, 11.1319, 5.0414);

/** North and east on the sky at a star: towards the celestial pole, and towards growing right ascension. */
function sky(star: Vector3): { toSun: Vector3; north: Vector3; east: Vector3 } {
  const d = star.clone().normalize();
  const east = new Vector3(0, 0, 1).cross(d).normalize();
  return { toSun: d.clone().negate(), north: d.clone().cross(east), east };
}

describe('the stars whose shape has been measured', () => {
  it('Altair is a fifth shorter from pole to pole than across (Monnier et al. 2007)', () => {
    const altair = starShape(['Altair', 'α Aql', '53 Aql'])!;
    expect(altair.rEq / SUN_RADIUS).toBeCloseTo(2.029, 9);
    expect(altair.rPol / SUN_RADIUS).toBeCloseTo(1.634, 9);
    expect(shapeFlattening(altair)).toBeCloseTo(0.195, 3);
    expect(altair.source).toBe('Monnier et al. 2007');
    // found by any of its names, the catalogue's first or not
    expect(starShape(['HR 7557', 'Altair'])).toEqual(altair);
  });

  it('the seven that have one, each wider across its equator; no other star', () => {
    for (const name of ['Altair', 'Vega', 'Regulus', 'Caph', 'Alderamin', 'Rasalhague', 'Achernar']) {
      const s = starShape([name])!;
      expect(s, name).not.toBeNull();
      expect(shapeFlattening(s), name).toBeGreaterThan(0.1);
      expect(shapeFlattening(s), name).toBeLessThan(0.3);
    }
    // Achernar, the flattest star known: its equator a third wider than its axis is long
    const achernar = starShape(['Achernar'])!;
    expect(achernar.rEq / achernar.rPol).toBeCloseTo(1.35, 9);
    expect(achernar.rEq / SUN_RADIUS).toBeCloseTo(9.16, 9);
    // Sirius turns slowly and is round; so is whatever has not been measured
    expect(starShape(['Sirius', 'α CMa'])).toBeNull();
    expect(starShape(['HIP 1001'])).toBeNull();
    expect(starShape([])).toBeNull();
    // (and a name that is a word of the language is not a star)
    expect(starShape(['constructor', 'toString'])).toBeNull();
  });

  it('the axis stands in space as it was measured from here: tilted to the line of sight, at its angle on the sky', () => {
    const altair = starShape(['Altair'])!;
    const axis = shapeAxis(altair, ALTAIR);
    const { toSun, north, east } = sky(ALTAIR);
    expect(axis.length()).toBeCloseTo(1, 12);
    // 57.2 degrees from pole-on, the pole 61.8 degrees west of north on the sky
    expect(axis.angleTo(toSun) / deg).toBeCloseTo(57.2, 9);
    expect(Math.atan2(axis.dot(east), axis.dot(north)) / deg).toBeCloseTo(-61.8, 9);
    // the same however far away the star is put
    expect(shapeAxis(altair, ALTAIR.clone().multiplyScalar(3e16)).angleTo(axis)).toBeLessThan(1e-12);
  });

  it('Vega shows us its pole, Regulus its equator', () => {
    const vega = shapeAxis(starShape(['Vega'])!, VEGA);
    expect(vega.angleTo(sky(VEGA).toSun) / deg).toBeCloseTo(6.2, 9);
    const regulus = shapeAxis(starShape(['Regulus'])!, REGULUS);
    expect(Math.abs(90 - regulus.angleTo(sky(REGULUS).toSun) / deg)).toBeLessThan(4);
    // (258 degrees east of north: the pole lies nearly due west on the sky)
    expect(regulus.dot(sky(REGULUS).east)).toBeLessThan(-0.95);
  });

  it('a measured star is as wide as it was found to be, and says so; any other says its size is estimated', () => {
    const vega = new CatalogStar('vega', VEGA.clone(), 0.6, 10138, 'A0V', ['Vega', 'α Lyr'], null);
    expect(vega.shape).not.toBeNull();
    expect(vega.radius / SUN_RADIUS).toBeCloseTo(2.726, 9);
    const rows = new Map(vega.info());
    expect(rows.get('Radius')).toBe('2.73 R☉ across the equator, 2.42 R☉ at the poles (measured)');
    expect(rows.get('Shape')).toBe('Flattened 11 % by its spin; from the Sun it is seen nearly pole-on (Monnier et al. 2012)');
    const altair = new Map(new CatalogStar('altair', ALTAIR.clone(), 2.21, 8004, 'A7V', ['Altair'], null).info());
    expect(altair.get('Shape')).toBe('Flattened 19 % by its spin; from the Sun it is seen 57° from pole-on (Monnier et al. 2007)');
    const regulus = new Map(new CatalogStar('regulus', REGULUS.clone(), -0.57, 11359, 'B7V', ['Regulus'], null).info());
    expect(regulus.get('Shape')).toContain('nearly equator-on');
    const sirius = new CatalogStar('sirius', new Vector3(-0.4944, 2.4768, -0.7584), 1.45, 10014, 'A0m', ['Sirius', 'α CMa'], null);
    expect(sirius.shape).toBeNull();
    // (round: its radius measured as a sphere's, StarRadii.ts)
    expect(sirius.radius / SUN_RADIUS).toBeCloseTo(1.711, 9);
    expect(new Map(sirius.info()).get('Radius')).toContain('(measured: Kervella et al. 2003)');
    expect(new Map(sirius.info()).has('Shape')).toBe(false);
    const fomalhaut = new CatalogStar('fomalhaut', new Vector3(1, 0, 0), 1.72, 8590, 'A3V', ['Fomalhaut'], null);
    expect(fomalhaut.radius).toBe(estimateStarRadius(1.72, 8590));
    expect(new Map(fomalhaut.info()).get('Radius')).toContain('(estimated)');
  });
});
