import { describe, expect, it } from 'vitest';
import { LIMB_POWER, limbGain, starLook } from '../src/render/StarLook';

describe('how a star is drawn up close', () => {
  it('the steepened limb darkening keeps the disk as bright as it was on the whole', () => {
    for (const [a, b] of [[0.22, 0.2], [0.44, 0.2], [0.61, 0.2], [0.78, 0.2]]) {
      const gain = limbGain(a, b);
      // the mean over the disk (rings of equal mu weigh mu), on a finer grid than the code's
      let sum = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const mu = (i + 0.5) / n, x = 1 - mu;
        sum += gain * Math.max(1 - a * x - b * x * x, 0) ** LIMB_POWER * mu;
      }
      expect((2 * sum) / n).toBeCloseTo(1, 3);
      // the middle is the brighter for it, the more the stronger the darkening
      expect(gain).toBeGreaterThan(1 / (1 - a / 3 - b / 6));
    }
    expect(limbGain(0.78, 0.2)).toBeGreaterThan(limbGain(0.22, 0.2));
  });

  it('the Sun: a convective surface, a little activity, the measured limb darkening', () => {
    const sun = starLook('sun', 5772, 1, 4.83, true);
    expect(sun.limbA).toBeCloseTo(0.44, 2);
    expect(sun.turbulence).toBeGreaterThan(0.45);
    expect(sun.granAmp).toBeGreaterThan(0.1);
    expect(sun.flattening).toBe(0);
    expect(sun.limbGain).toBeCloseTo(limbGain(sun.limbA, sun.limbB), 12);
  });

  it('a red dwarf is a red dwarf, however small its estimated radius comes out', () => {
    // Proxima Centauri as the catalogue has it: 3383 K, and 0.022 solar radii by the estimate
    // without a bolometric correction (it is 0.15): not a white dwarf's smooth, quiet face
    const proxima = starLook('proxima', 3383, 0.022, 15.5);
    expect(proxima.turbulence).toBeGreaterThan(0.45);
    expect(proxima.granAmp).toBeGreaterThan(0.1);
    expect(proxima.corona).toBeGreaterThan(0.4);
    // and a white dwarf is one: hot, small, smooth
    const sirusB = starLook('sirius b', 25000, 0.0084, 11.2);
    expect(sirusB.turbulence).toBeLessThan(0.1);
    expect(sirusB.granAmp).toBeLessThan(0.02);
    expect(sirusB.spots).toBe(0);
  });

  it('hot stars are smooth and may spin flat; supergiants seethe in a few giant cells', () => {
    const vega = starLook('vega', 9600, 2.4, 0.58);
    expect(vega.turbulence).toBeLessThan(0.2);
    expect(vega.spots).toBe(0);
    const betelgeuse = starLook('betelgeuse', 3600, 760, -5.8);
    expect(betelgeuse.granFreq).toBeLessThan(4);
    expect(betelgeuse.granAmp).toBeGreaterThan(0.4);
  });

  it('a star looks the same every time', () => {
    expect(starLook('tau ceti', 5340, 0.79, 5.7)).toEqual(starLook('tau ceti', 5340, 0.79, 5.7));
  });
});

/**
 * The arithmetic of the star points (render/shaders/psf.ts), tried here in the same form: a
 * star's light is summed over each pixel's area with an approximate error function. Whatever
 * the approximation's error, a star must keep all of its light wherever it sits on the pixels.
 */
describe("a star's light on the pixels", () => {
  const erf = (x: number) => {
    const x2 = x * x;
    return Math.sign(x) * Math.sqrt(1 - Math.exp((-x2 * (1.2732395 + 0.147 * x2)) / (1 + 0.147 * x2)));
  };
  const onPixel = (x: number, s: number) => 0.5 * (erf(((x + 0.5) * 0.70710678) / s) - erf(((x - 0.5) * 0.70710678) / s));
  const total = (cx: number, cy: number, s: number) => {
    let sum = 0;
    for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) sum += onPixel(i - cx, s) * onPixel(j - cy, s);
    return sum;
  };

  it('is all there, wherever the star sits between the pixels', () => {
    for (const s of [0.5, 0.7, 1, 1.6]) {
      for (const [cx, cy] of [[0, 0], [0.5, 0], [0.5, 0.5], [0.13, 0.37], [0.25, 0.75]]) {
        expect(total(cx, cy, s)).toBeCloseTo(1, 5);
      }
    }
  });

  it('a star half a pixel wide in the middle of a pixel is mostly that pixel; on a corner, four alike', () => {
    expect(onPixel(0, 0.5) ** 2).toBeGreaterThan(0.45);
    const corner = onPixel(-0.5, 0.5) * onPixel(-0.5, 0.5);
    expect(corner).toBeCloseTo(0.25 * (erf(1.41421356) ** 2), 6);
    expect(corner).toBeGreaterThan(0.22);
  });

  it('wide, it is the plain bell curve', () => {
    const s = 1.6;
    for (const x of [0, 1, 2.5, 4]) expect(onPixel(x, s)).toBeCloseTo(Math.exp((-x * x) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI)), 2);
  });
});
