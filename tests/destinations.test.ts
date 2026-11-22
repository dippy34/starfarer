import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { App } from '../src/app/App';
import { CATEGORIES, describe as describeObject, distanceText, EXOPLANETS, GALAXIES, HOLES, NEBULAE, PLANETS, STARS, starTint } from '../src/app/destinations';
import { AU, LY, PC, SUN_RADIUS } from '../src/core/units';
import { UPos } from '../src/core/upos';
import { CatalogStar } from '../src/universe/Stars';

describe('distances in a list', () => {
  it('are kilometres nearby and light years beyond the Solar System, in plain words', () => {
    expect(distanceText(384_400e3)).toBe('384,400 km');
    expect(distanceText(4.2465 * LY)).toBe('4.25 light years');
    expect(distanceText(26.3 * LY)).toBe('26.3 light years');
    expect(distanceText(1344 * LY)).toBe('1,344 light years');
    expect(distanceText(163_000 * LY)).toBe('163 thousand light years');
    expect(distanceText(2.537e6 * LY)).toBe('2.5 million light years');
    expect(distanceText(53.5e6 * LY)).toBe('54 million light years');
    expect(distanceText(2.4e9 * LY)).toBe('2.4 billion light years');
  });
});

describe("a star's card, close by", () => {
  it("says how far it is in the place chip's units, not \"0.00 light years\"", () => {
    const star = new CatalogStar('t', new Vector3(1, 0, 0), 4.83, 5772, 'G2V', ['Test'], null);
    const at = (m: number) => ({ rig: { upos: UPos.from(PC + m, 0, 0), target: null, surface: 0 } }) as unknown as App;
    expect(describeObject(at(SUN_RADIUS + 5.066e9), star)).toBe('star · 5.066 million km');
    expect(describeObject(at(SUN_RADIUS + 11.4 * AU), star)).toBe('star · 11.40 AU');
    expect(describeObject(at(4.25 * LY), star)).toBe('star · 4.25 light years');
  });
});

describe('the lists of places', () => {
  it('have no section and no name twice', () => {
    const ids = CATEGORIES.map((c) => c[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const list of [PLANETS, STARS, EXOPLANETS, NEBULAE, GALAXIES, HOLES]) expect(new Set(list).size).toBe(list.length);
  });

  it('tint a star by its temperature: blue-white when hot, orange when cool, sun-like when unknown', () => {
    const blue = starTint(12000), cool = starTint(3200);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(cool[0]).toBeGreaterThan(cool[2]);
    expect(starTint(0)).toEqual(starTint(5800));
  });
});
