import { describe, expect, it } from 'vitest';
import { CATEGORIES, distanceText, EXOPLANETS, GALAXIES, HOLES, NEBULAE, PLANETS, STARS, starTint } from '../src/app/destinations';
import { LY } from '../src/core/units';

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
