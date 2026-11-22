import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Ephemeris } from '../src/astro/ephemeris';
import { SolarSystem } from '../src/universe/SolarSystem';

// the Solar System as shipped (no ephemeris is needed for what is catalogued)
const data = JSON.parse(readFileSync(new URL('../public/data/solar/system.json', import.meta.url), 'utf8'));
const system = new SolarSystem(data, {} as Ephemeris);
const period = (name: string) => system.meanPeriod(system.bodies.find((b) => b.name === name)!);

describe("a world's catalogued period", () => {
  it('a planet: from the mean motion of JPL mean elements (the Earth: the Earth-Moon barycentre)', () => {
    expect(period('Earth')!.days).toBeCloseTo(365.256, 2);
    expect(period('Jupiter')!.days / 365.25).toBeCloseTo(11.86, 1);
    expect(period('Neptune')!.days / 365.25).toBeCloseTo(164.8, 0);
  });

  it("Pluto, which those elements leave out: NASA's fact sheet", () => {
    expect(period('Pluto')).toEqual({ days: 90560, source: "NASA's Pluto fact sheet (NSSDCA)", how: 'catalogued' });
  });

  it('a moon: its JPL mean elements; a small body: Kepler on its catalogued orbit', () => {
    expect(period('Moon')!.days).toBeCloseTo(27.32, 2);
    expect(period('Ceres')!.days / 365.25).toBeCloseTo(4.6, 1);
  });
});
