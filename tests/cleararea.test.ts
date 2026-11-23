import { describe, expect, it } from 'vitest';
import { Quaternion } from 'three';
import { isClear, largestClear, worth } from '../src/core/clearArea';
import { ViewCone } from '../src/render/Cull';
import { viewFrame } from '../src/app/Powers';

// a phone on its side (844 x 390) with the ship's instruments: the rail, the card, the two chips, the read-outs
const RAIL = { l: 10, t: 116, r: 78, b: 326 };
const CARD = { l: 88, t: 192, r: 425.6, b: 380 };
const CHIP_L = { l: 10, t: 10, r: 215.6, b: 57.1 };
const CHIP_R = { l: 657.8, t: 10, r: 834, b: 57.1 };
const SHIP = [{ l: 451.6, t: 62, r: 834, b: 165.9 }, { l: 451.6, t: 171.9, r: 834, b: 211.9 }, { l: 451.6, t: 328, r: 834, b: 380 }];

describe('the clear part of the view', () => {
  it('is the whole view when nothing covers it', () => {
    expect(largestClear(844, 390, [], 4, 112, 96)).toEqual({ l: 0, t: 0, r: 844, b: 390 });
  });

  it('is found among the parts of the interface, not under any of them', () => {
    const all = [RAIL, CARD, CHIP_L, CHIP_R, ...SHIP];
    const box = largestClear(844, 390, all, 4, 112, 96, 1.6)!;
    expect(box).not.toBeNull();
    expect(isClear(box, all, 4 - 1e-9)).toBe(true);
    // above the card, between the rail and the instruments: not the strip the card's top leaves along the whole width
    expect(box.r).toBeLessThanOrEqual(451.6 - 4 + 1e-9);
    expect(box.b).toBeLessThanOrEqual(192 - 4 + 1e-9);
    // (so a marker 96 x 80 fits about its middle, kept 4 px from the interface)
    const x = (box.l + box.r) / 2, y = (box.t + box.b) / 2;
    expect(isClear({ l: x - 48, r: x + 48, t: y - 36, b: y + 44 }, all, 4 - 1e-9)).toBe(true);
  });

  it('is the room beside the card when the ship has no instruments over it', () => {
    const all = [RAIL, { l: 88, t: 192, r: 468, b: 380 }, CHIP_L, CHIP_R];
    const box = largestClear(844, 390, all, 4, 112, 96, 1.6)!;
    expect(box.l).toBeGreaterThanOrEqual(468);
    expect((box.l + box.r) / 2).toBeGreaterThan(560);
  });

  it('is none where nothing is big enough, and a long strip is worth less than a block', () => {
    expect(largestClear(100, 100, [], 4, 112, 96)).toBeNull();
    expect(worth({ l: 0, t: 0, r: 800, b: 100 }, 1.6)).toBeLessThan(worth({ l: 0, t: 0, r: 235, b: 390 }, 1.6));
  });

  it('keeps a rectangle that is still clear', () => {
    expect(isClear({ l: 100, t: 60, r: 400, b: 180 }, [CARD], 4)).toBe(true);
    expect(isClear({ l: 100, t: 60, r: 400, b: 190 }, [CARD], 4)).toBe(false);
  });
});

describe('a view whose optical centre is off the middle', () => {
  it('frames where the middle of the free part is, whatever the centre', () => {
    // the free part's middle is where the optical centre is: the subject is straight ahead
    const free = { left: 468, top: 0, right: 844, bottom: 390 };
    const at = viewFrame(free, 844, 390, 50, 656 - 422, 0);
    expect(at.dir[0]).toBeCloseTo(0, 9);
    expect(at.dir[1]).toBeCloseTo(0, 9);
    expect(viewFrame(free, 844, 390, 50).dir[0]).toBeGreaterThan(0.2);
  });

  it('is culled by a cone that reaches farther on the side the centre is shifted from', () => {
    const plain = new ViewCone(), shifted = new ViewCone();
    plain.set(new Quaternion(), 60, 2, 0);
    shifted.set(new Quaternion(), 60, 2, 0, 0.8, 0);
    // 56 degrees off the axis: out of the plain cone's corners (about 52), inside the shifted one's (about 60)
    const x = Math.sin((56 * Math.PI) / 180), z = -Math.cos((56 * Math.PI) / 180);
    expect(plain.sees(x, 0, z, 0.01)).toBe(false);
    expect(shifted.sees(x, 0, z, 0.01)).toBe(true);
  });
});
