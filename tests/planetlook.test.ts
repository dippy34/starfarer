import { describe, expect, it } from 'vitest';
import { generatedLook, madeLook, ringColor, turnHue, type V3 } from '../src/render/PlanetLook';

const close = (a: V3, b: V3, eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps);

describe('a made world\'s colours turned round the colour wheel', () => {
  it('turnHue: greys stay grey, a third of a turn takes red to green and green to blue, a whole turn changes nothing', () => {
    expect(close(turnHue([0.5, 0.5, 0.5], 0.37), [0.5, 0.5, 0.5])).toBe(true);
    expect(close(turnHue([1, 0, 0], 1 / 3), [0, 1, 0])).toBe(true);
    expect(close(turnHue([0, 1, 0], 1 / 3), [0, 0, 1])).toBe(true);
    expect(close(turnHue([0.3, 0.2, 0.1], 1), [0.3, 0.2, 0.1])).toBe(true);
    // (never below zero, and about as bright: the sum of the three is kept where none is clipped)
    for (const turn of [0.1, 0.25, 0.5, 0.8]) {
      const c = turnHue([0.36, 0.24, 0.15], turn);
      expect(Math.min(...c)).toBeGreaterThanOrEqual(0);
      expect(c[0] + c[1] + c[2]).toBeCloseTo(0.75, 9);
    }
  });

  it('a look with no turn is the look as it was; a turn changes every colour of it and nothing else', () => {
    for (const kind of ['terran', 'ocean', 'desert', 'lava', 'ice', 'giant', 'icegiant'] as const) {
      const plain = generatedLook(madeLook(kind, 4242, 7e6)), none = generatedLook(madeLook(kind, 4242, 7e6, false, 0));
      expect(none).toEqual(plain);
      const turned = generatedLook(madeLook(kind, 4242, 7e6, false, 0.5));
      expect(turned.albedo).toBe(plain.albedo);
      expect(turned.typeId).toBe(plain.typeId);
      for (const [k, v] of Object.entries(plain.pal)) {
        if (Array.isArray(v)) expect(turned.pal[k]).toEqual(turnHue(v, 0.5));
        else expect(turned.pal[k]).toBe(v);
      }
    }
  });

  it('rings change nothing of the rest of the look; a cold world\'s icy ring takes the turned colours', () => {
    const bare = generatedLook(madeLook('giant', 99, 7e7)), ringed = generatedLook(madeLook('giant', 99, 7e7, true));
    expect({ ...ringed.pal, uRing: 0 }).toEqual(bare.pal);
    expect(ringed.pal.uRing).toBe(1);
    const spec = madeLook('giant', 99, 7e7, true, 0.25), turned = generatedLook(spec);
    expect(ringColor(spec, turned)).not.toEqual(ringColor(madeLook('giant', 99, 7e7, true), ringed));
  });
});
