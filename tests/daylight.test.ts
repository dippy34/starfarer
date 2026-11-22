import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { orbitDrift, sunHeight, sunriseIn } from '../src/app/Daylight';

const DAY = 86400, YEAR = 365.25 * DAY;
const z = new Vector3(0, 0, 1);

describe('sunrise at a place', () => {
  it('on the Earth\'s equator at midnight: in six hours of the solar day', () => {
    const spin = z.clone().multiplyScalar((2 * Math.PI) / 86164.1);
    const orbit = z.clone().multiplyScalar((2 * Math.PI) / YEAR);
    const t = sunriseIn(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), spin, orbit);
    expect(t! / 3600).toBeCloseTo(6, 3);
    // at noon the next sunrise is eighteen hours on
    expect(sunriseIn(new Vector3(1, 0, 0), new Vector3(1, 0, 0), spin, orbit)! / 3600).toBeCloseTo(18, 3);
  });

  it('on the Moon at midnight: a quarter of its 29.5-day day, from its spin and its drift round the Sun', () => {
    const spin = z.clone().multiplyScalar((2 * Math.PI) / (27.3217 * DAY));
    const orbit = z.clone().multiplyScalar((2 * Math.PI) / YEAR);
    const t = sunriseIn(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), spin, orbit)!;
    expect(t / DAY).toBeCloseTo(29.53 / 4, 1);
  });

  it('a height over the horizon is reached later; a polar night never ends today', () => {
    const spin = z.clone().multiplyScalar((2 * Math.PI) / 86164.1);
    const orbit = new Vector3();
    const t0 = sunriseIn(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), spin, orbit, 0)!;
    const t6 = sunriseIn(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), spin, orbit, (6 * Math.PI) / 180)!;
    expect((t6 - t0) / 60).toBeCloseTo(24, 0);
    // 80° north in the northern winter (the Sun 23.4° below the equator): it never rises
    const lat = (80 * Math.PI) / 180, dec = (-23.4 * Math.PI) / 180;
    const up = new Vector3(Math.cos(lat), 0, Math.sin(lat));
    const sun = new Vector3(Math.cos(dec), 0, Math.sin(dec));
    expect(sunHeight(up, sun)).toBeLessThan(0);
    expect(sunriseIn(up, sun, spin, orbit)).toBeNull();
  });

  it('the Sun\'s drift along the sky is the orbit\'s angular velocity', () => {
    const w = orbitDrift(new Vector3(1.496e11, 0, 0), new Vector3(0, 29780, 0));
    expect((w.z * YEAR) / (2 * Math.PI)).toBeCloseTo(1, 1);
  });
});
