import { describe, expect, it } from 'vitest';
import { canvasRatio, CANVAS_PIXELS } from '../src/core/device';

describe("the canvas's pixels per CSS pixel", () => {
  it('a desktop or a tablet: the screen\'s own, up to 2, as ever', () => {
    expect(canvasRatio(1, 1920, 1080)).toBe(1);
    expect(canvasRatio(1.5, 1280, 720)).toBe(1.5);
    expect(canvasRatio(2, 1512, 982)).toBe(2);
    expect(canvasRatio(2, 820, 1180)).toBe(2);
    expect(canvasRatio(3, 1280, 720)).toBe(2); // a large screen of 3 would be 8 million pixels
  });

  it("a phone: its own density, so that a star a pixel wide is one of the screen's pixels", () => {
    expect(canvasRatio(3, 393, 852)).toBe(3);      // 3.0 million
    expect(canvasRatio(3, 360, 780)).toBe(3);
    expect(canvasRatio(2.625, 412, 915)).toBe(2.625);
    expect(canvasRatio(3, 852, 393)).toBe(3);      // on its side too
  });

  it('but never more pixels than the budget', () => {
    for (const [dpr, w, h] of [[3, 430, 932], [3.5, 412, 915], [4, 360, 800]]) {
      const r = canvasRatio(dpr, w, h);
      expect(r).toBeLessThan(dpr);
      expect(r).toBeGreaterThan(2);
      expect(r * r * w * h).toBeCloseTo(CANVAS_PIXELS, -2);
    }
  });

  it('a ratio the browser does not give is 1', () => {
    expect(canvasRatio(0, 800, 600)).toBe(1);
    expect(canvasRatio(NaN, 800, 600)).toBe(1);
  });
});
