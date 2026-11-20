import { describe, expect, it } from 'vitest';
import { BLOOM_LEVELS, BLOOM_SIGMA, bloomVeil } from '../src/render/shaders/bloom';

/**
 * The renderer's bloom chain (Renderer.ts: downMat, upMat), in the same arithmetic on a grey
 * picture: halved BLOOM_LEVELS times through the 13-tap filter, then added up from the smallest
 * level through the 3 x 3 tent. Returns what the composite reads (per unit of its strength).
 */
type Picture = { w: number; h: number; d: Float64Array };
const at = (p: Picture, x: number, y: number) => p.d[Math.min(Math.max(y, 0), p.h - 1) * p.w + Math.min(Math.max(x, 0), p.w - 1)];
/** a bilinear read at (x, y) in pixels of `p`, pixel centres at whole numbers, clamped at the edges */
function read(p: Picture, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  return (at(p, x0, y0) * (1 - fx) + at(p, x0 + 1, y0) * fx) * (1 - fy) + (at(p, x0, y0 + 1) * (1 - fx) + at(p, x0 + 1, y0 + 1) * fx) * fy;
}
function down(src: Picture): Picture {
  const out = { w: src.w >> 1, h: src.h >> 1, d: new Float64Array((src.w >> 1) * (src.h >> 1)) };
  for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) {
    const x = ((i + 0.5) / out.w) * src.w - 0.5, y = ((j + 0.5) / out.h) * src.h - 0.5;
    const t = (dx: number, dy: number) => read(src, x + dx, y + dy);
    out.d[j * out.w + i] = 0.125 * t(0, 0) + 0.03125 * (t(-2, 2) + t(2, 2) + t(-2, -2) + t(2, -2))
      + 0.0625 * (t(0, 2) + t(-2, 0) + t(2, 0) + t(0, -2)) + 0.125 * (t(-1, 1) + t(1, 1) + t(-1, -1) + t(1, -1));
  }
  return out;
}
function up(src: Picture, prev: Picture): Picture {
  const out = { w: prev.w, h: prev.h, d: new Float64Array(prev.w * prev.h) };
  for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) {
    const x = ((i + 0.5) / out.w) * src.w - 0.5, y = ((j + 0.5) / out.h) * src.h - 0.5;
    const t = (dx: number, dy: number) => read(src, x + dx, y + dy);
    const tent = t(-1, 1) + 2 * t(0, 1) + t(1, 1) + 2 * t(-1, 0) + 4 * t(0, 0) + 2 * t(1, 0) + t(-1, -1) + 2 * t(0, -1) + t(1, -1);
    out.d[j * out.w + i] = tent / 16 + prev.d[j * out.w + i];
  }
  return out;
}
function bloom(scene: Picture): (x: number, y: number) => number {
  const chain: Picture[] = [];
  for (let k = 0, src = scene; k < BLOOM_LEVELS; k++) chain.push(src = down(src));
  let sum = chain[chain.length - 1];
  for (let k = chain.length - 2; k >= 0; k--) sum = up(sum, chain[k]);
  return (x, y) => read(sum, ((x + 0.5) / scene.w) * sum.w - 0.5, ((y + 0.5) / scene.h) * sum.h - 0.5);
}

/** An evenly bright disk of `radius` pixels in the middle of a dark frame, and the bloom over it. */
function overDisk(radius: number, size = 512): (fromCentre: number) => number {
  const scene = { w: size, h: size, d: new Float64Array(size * size) };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    scene.d[j * size + i] = Math.min(Math.max(radius - Math.hypot(i - size / 2 + 0.5, j - size / 2 + 0.5) + 0.5, 0), 1);
  }
  const b = bloom(scene);
  return (fromCentre) => b(size / 2 - 0.5 + fromCentre, size / 2 - 0.5);
}

describe("what the frame's bloom lays over a bright disk", () => {
  it('over an area that fills the frame, every level adds its whole share', () => {
    const flat = { w: 256, h: 256, d: new Float64Array(256 * 256).fill(1) };
    expect(bloom(flat)(128, 128)).toBeCloseTo(BLOOM_LEVELS, 9);
    expect(bloomVeil(1e6, 1e6)).toBeCloseTo(BLOOM_LEVELS, 9);
  });

  it('the allowance made for it follows the chain itself: at the middle of disks of any size', () => {
    for (const radius of [6, 12, 25, 50, 100]) {
      const measured = overDisk(radius)(0);
      expect(Math.abs(bloomVeil(radius, radius) - measured)).toBeLessThan(0.12);
    }
    // (a disk of a few pixels gathers one level's worth, a large one nearly all seven; the
    // smallest are below what the allowance is good for, and too small to show a face)
    expect(overDisk(3)(0)).toBeLessThan(1.3);
    expect(overDisk(100)(0)).toBeGreaterThan(5.5);
    expect(BLOOM_SIGMA).toBeGreaterThan(2);
  });

  it('and from the middle of a disk to its edge, where half of it is left', () => {
    for (const radius of [50, 100]) {
      const measured = overDisk(radius);
      for (const share of [0.3, 0.5, 0.8, 0.9]) {
        expect(Math.abs(bloomVeil(radius, radius * (1 - share)) - measured(share * radius))).toBeLessThan(0.2);
      }
      // at the very edge: half of what the levels narrower than the disk gather, all of the wider ones'
      const edge = measured(radius) / measured(0);
      expect(edge).toBeGreaterThan(0.45);
      expect(edge).toBeLessThan(0.6);
      expect(Math.abs(bloomVeil(radius, 0) / bloomVeil(radius, radius) - edge)).toBeLessThan(0.1);
    }
  });
});
