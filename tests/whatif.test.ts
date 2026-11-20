import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Ephemeris } from '../src/astro/ephemeris';
import { canHaveMoon, MADE_FIRST_ID, MADE_MOST, newMoon } from '../src/app/WhatIf';
import { workedOut } from '../src/app/Worked';
import { AU, J2000_JD } from '../src/core/units';
import { G } from '../src/sim/physics';
import { SolarSystem, type SystemJson } from '../src/universe/SolarSystem';

/** The Sun, the Earth and the Moon as the catalogue has them, the planets on their mean orbits (no ephemeris files). */
function system(): SolarSystem {
  const all = JSON.parse(readFileSync('public/data/solar/system.json', 'utf8')) as SystemJson;
  const data: SystemJson = { ...all, bodies: all.bodies.filter((b) => [10, 399, 301, 599].includes(b.id)) };
  const eph = {
    request: () => null,
    isLoaded: () => false,
    approxHeliocentric: (name: string, jd: number, out: Vector3) => {
      // a circle is all these tests need: a year long for the Earth, twelve for Jupiter
      const [a, years] = name === 'EMB' ? [1, 1] : [5.2, 11.86];
      const th = (2 * Math.PI * (jd - J2000_JD)) / (365.25 * years);
      return out.set(a * AU * Math.cos(th), a * AU * Math.sin(th), 0);
    },
  } as unknown as Ephemeris;
  const s = new SolarSystem(data, eph);
  s.update(J2000_JD);
  return s;
}

describe('a moon made for a world', () => {
  const jd = J2000_JD;

  it('is sized to its planet, of rock near the Sun and of ice far out, and goes round as Kepler says', () => {
    const s = system();
    const earth = s.byId.get(399)!, jupiter = s.byId.get(599)!;
    const m = newMoon(earth, 5 * earth.radius, AU, jd, 0, MADE_FIRST_ID);
    expect(m.json.name).toBe("Earth's new moon");
    expect(m.radius).toBeCloseTo(0.12 * earth.radius, 0);
    // rock: 3 g/cm³
    expect((m.json.gm! * 1e9) / G / ((4 / 3) * Math.PI * m.radius ** 3)).toBeCloseTo(3000, 6);
    expect(m.json.albedo).toBeLessThan(0.2);
    // Kepler's third law with the planet's mass and its own
    expect(m.periodDays * 86400).toBeCloseTo(2 * Math.PI * Math.sqrt(m.orbit ** 3 / (earth.gm + m.json.gm! * 1e9)), 6);
    // the second for the same planet has a name of its own
    expect(newMoon(earth, 5 * earth.radius, AU, jd, 1, MADE_FIRST_ID + 1).json.name).toBe("Earth's new moon 2");
    // Jupiter's: no bigger than our Moon, and of ice
    const j = newMoon(jupiter, 10 * jupiter.radius, 5.2 * AU, jd, 0, MADE_FIRST_ID + 2);
    expect(j.radius).toBe(1.8e6);
    expect(j.json.albedo).toBeGreaterThan(0.4);
  });

  it('is put between the planet and the eye where there is room: never inside the Roche limit, never out of reach', () => {
    const s = system();
    const earth = s.byId.get(399)!;
    const R = earth.radius;
    const at = (eye: number) => newMoon(earth, eye * R, AU, jd, 0, MADE_FIRST_ID).orbit / R;
    expect(at(10)).toBeCloseTo(5.5, 6);
    // from close by: clear of the Roche limit of a rocky moon about the Earth (2.44 R (5.51 / 3)^(1/3) = 2.99 R)
    expect(at(1.2)).toBeGreaterThan(3);
    expect(at(1.2)).toBeLessThan(3.4);
    // from far away: still a moon of the planet
    expect(at(5000)).toBeCloseTo(60, 9);
  });

  it('joins the system: it stands where the eye looks, in the plane of the equator, and moves on', () => {
    const s = system();
    const earth = s.byId.get(399)!;
    const before = s.bodies.length;
    const plan = newMoon(earth, 8 * earth.radius, AU, jd, 0, MADE_FIRST_ID);
    const moon = s.add(plan.json);
    // the eye: over the Earth's equator, in some direction of the sky (the Earth's pole from its rotation model)
    const rot = earth.rotation!;
    const ra = (rot.ra[0] * Math.PI) / 180, dec = (rot.dec[0] * Math.PI) / 180;
    const pole = new Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
    const dir = new Vector3(1, 0.3, 0).cross(pole).normalize();
    s.place(moon, dir, jd);
    s.update(jd);
    expect(s.bodies.length).toBe(before + 1);
    expect(moon.parent).toBe(earth);
    expect(earth.children).toContain(moon);
    const rel = moon.pos.clone().sub(earth.pos);
    expect(rel.length() / plan.orbit).toBeCloseTo(1, 9);
    expect(rel.clone().normalize().dot(dir)).toBeCloseTo(1, 9);
    expect(Math.abs(rel.clone().normalize().dot(pole))).toBeLessThan(1e-9);
    // a quarter of its period later it is a quarter of the way round, still in that plane
    s.update(jd + plan.periodDays / 4);
    const later = moon.pos.clone().sub(earth.pos);
    expect(later.length() / plan.orbit).toBeCloseTo(1, 9);
    expect(later.clone().normalize().dot(dir)).toBeCloseTo(0, 6);
    expect(Math.abs(later.clone().normalize().dot(pole))).toBeLessThan(1e-9);
    // its speed is that of a circular orbit there
    expect(moon.vel.clone().sub(earth.vel).length()).toBeCloseTo(Math.sqrt((earth.gm + moon.gm) / plan.orbit), 3);
    // and what is worked out for it is worked out as for any moon
    const year = workedOut(moon).find((w) => w.label === 'Once round Earth')!;
    expect(year.math).toContain('P = 2π√(a³ / G(M + m))');
    expect(moon.info()[0]).toEqual(['Type', 'Moon (made by you)']);
  });

  it('can be taken away again, and the catalogue cannot', () => {
    const s = system();
    const earth = s.byId.get(399)!, theMoon = s.byId.get(301)!;
    const before = s.bodies.length;
    const moon = s.add(newMoon(earth, 8 * earth.radius, AU, jd, 0, MADE_FIRST_ID).json);
    s.update(jd);
    s.remove(moon);
    expect(s.bodies.length).toBe(before);
    expect(s.byId.has(MADE_FIRST_ID)).toBe(false);
    expect(earth.children).toEqual([theMoon]);
    expect(moon.valid).toBe(false);
    s.update(jd + 1);   // (and nothing trips over its absence)
    // the same number twice is a mistake in the code
    s.add(newMoon(earth, 8 * earth.radius, AU, jd, 0, MADE_FIRST_ID).json);
    expect(() => s.add(newMoon(earth, 8 * earth.radius, AU, jd, 1, MADE_FIRST_ID).json)).toThrow('there already');
  });

  it('is offered to planets and dwarf planets, while there is room for more', () => {
    const s = system();
    expect(canHaveMoon(s.byId.get(399)!, 0)).toBe(true);
    expect(canHaveMoon(s.byId.get(399)!, MADE_MOST)).toBe(false);
    expect(canHaveMoon(s.byId.get(301)!, 0)).toBe(false);   // a moon of a moon: not yet
    expect(canHaveMoon(s.sun, 0)).toBe(false);
  });
});
