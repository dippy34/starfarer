import { describe, expect, it } from 'vitest';
import { AU, C_LIGHT, formatDistance, formatSpeed, KPC, LY, MPC, PC } from '../src/core/units';

describe('distance readout', () => {
  it.each([
    [1.7, '1.7 m'],
    [999.94, '999.9 m'],
    [1_000, '1.00 km'],
    [42_190, '42.19 km'],
    [408_000, '408 km'], // the ISS
    [5_560_000, '5,560 km'],
    [21_660_000, '21,660 km'],
    [384_400_000, '384,400 km'], // the Moon
    [1.049e10, '10.490 million km'],
    [0.3871 * AU, '0.3871 AU'], // Mercury
    [AU, '1.0000 AU'],
    [30.07 * AU, '30.07 AU'],
    [4.2465 * LY, '4.247 ly'], // Proxima Centauri
    [642.5 * LY, '642.5 ly'],
    [8.277 * KPC, '8.28 kpc'], // the galactic centre
    [778 * KPC, '778.00 kpc'], // Andromeda
    [16.5 * MPC, '16.50 Mpc'],
  ])('%d m reads "%s"', (metres, text) => {
    expect(formatDistance(metres)).toBe(text);
  });

  it('never falls back to exponent notation and keeps the sign', () => {
    for (let e = -1; e < 26; e += 0.25) expect(formatDistance(10 ** e)).not.toMatch(/e\+|×10/);
    expect(formatDistance(-384_400_000)).toBe('-384,400 km');
  });

  it('does not depend on the browser locale', () => {
    // (toLocaleString would print 384.400 or 384 400 elsewhere)
    expect(formatDistance(384_400_000)).toBe('384,400 km');
  });
});

describe('speed readout', () => {
  it.each([
    [0, '0.0 m/s'],
    [343, '343.0 m/s'],
    [7_660, '7.66 km/s'], // low Earth orbit
    [29_780, '29.78 km/s'], // the Earth around the Sun
    [617_500, '618 km/s'], // escape from the Sun's surface
    [0.5 * C_LIGHT, '0.500 c'],
    [3 * LY, '3.000 ly/s'],
    [2_000 * PC, '2000.0 pc/s'],
    [5 * MPC, '5.000 Mpc/s'],
  ])('%d m/s reads "%s"', (mps, text) => {
    expect(formatSpeed(mps)).toBe(text);
  });
});
