import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { describe as describeObject } from '../src/app/destinations';
import { UPos } from '../src/core/upos';
import { readGrade, type DistanceGrade, type StarRef } from '../src/universe/StarCatalog';
import { CatalogStar } from '../src/universe/Stars';

// A node's quality file (pipeline/build_distance_quality.py): 2 bits a star, then each poor star's
// parallax (int16) and error (uint16) in microarcseconds.
function qualityFile(grades: number[], poor: [number, number][]): Uint8Array {
  const packed = new Uint8Array((grades.length + 3) >> 2);
  grades.forEach((g, s) => { packed[s >> 2] |= g << (2 * (s & 3)); });
  const out = new Uint8Array(packed.length + 4 * poor.length);
  out.set(packed);
  const v = new DataView(out.buffer);
  poor.forEach(([p, e], k) => { v.setInt16(packed.length + 4 * k, p, true); v.setUint16(packed.length + 4 * k + 2, e, true); });
  return out;
}

describe('how far a star\'s distance can be trusted', () => {
  it('is read from its node\'s quality file, the poor ones with their parallax and its error', () => {
    // (good, poor, not graded, poor, Hipparcos only, good)
    const q = qualityFile([1, 2, 0, 2, 3, 1], [[312, 95], [-40, 210]]);
    expect(readGrade(q, 6, 0)).toEqual({ grade: 'good' });
    expect(readGrade(q, 6, 1)).toEqual({ grade: 'poor', parallaxMas: 0.312, errorMas: 0.095 });
    expect(readGrade(q, 6, 2)).toEqual({ grade: 'ungraded' });
    expect(readGrade(q, 6, 3)).toEqual({ grade: 'poor', parallaxMas: -0.04, errorMas: 0.21 });
    expect(readGrade(q, 6, 4)).toEqual({ grade: 'hipFar' });
    expect(readGrade(q, 6, 5)).toEqual({ grade: 'good' });
  });

  const star = (grade: DistanceGrade | null) => {
    // a giant 3,200 pc off, as the catalogue has it
    const s = new CatalogStar('t', new Vector3(3200, 0, 0), -2.1, 4500, 'K0 III', ['HIP 1'], { catalog: { source: 'AT-HYG v4.0', license: 'CC BY-SA 4.0' } as StarRef['catalog'], node: {} as StarRef['node'], slot: 0 });
    s.distanceGrade = grade;
    const app = { rig: { upos: UPos.from(0, 0, 0) } } as unknown as Parameters<typeof describeObject>[0];
    return new Map(s.info()).set('detail', describeObject(app, s));
  };

  it('a poor one: its card says so, with the numbers, and does not state what follows from it as fact', () => {
    const rows = star({ grade: 'poor', parallaxMas: 0.312, errorMas: 0.095 });
    expect(rows.get('Distance from Sun')).toMatch(/distance uncertain \(parallax 0\.312 ± 0\.095 mas\)$/);
    expect(rows.get('Absolute mag (V)')).toMatch(/uncertain/);
    expect(rows.get('Luminosity (V)')).toMatch(/uncertain/);
    expect(rows.get('Radius')).toMatch(/uncertain distance/);
    expect(rows.get('detail')).toMatch(/\(uncertain\)$/);
  });

  it('from Hipparcos alone, far off: uncertain too; a good one (or one not graded) as before', () => {
    expect(star({ grade: 'hipFar' }).get('Distance from Sun')).toMatch(/from Hipparcos alone/);
    for (const g of [{ grade: 'good' } as const, null]) {
      const rows = star(g);
      expect(rows.get('Distance from Sun')).not.toMatch(/uncertain/);
      expect(rows.get('Luminosity (V)')).not.toMatch(/uncertain/);
      expect(rows.get('Radius')).toMatch(/\(estimated\)$/);
      expect(rows.get('detail')).not.toMatch(/uncertain/);
    }
  });
});
