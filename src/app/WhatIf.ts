import { AU } from '../core/units';
import { G } from '../sim/physics';
import type { Body } from '../universe/Body';
import type { BodyJson } from '../universe/SolarSystem';

/**
 * What if: the explorer's own changes to the worlds. They are part of the explorer, each with a
 * button where it belongs (a planet's details offer it a moon), and there is no mode to switch
 * on. What is made obeys the same physics as what was found: a new moon is a body like any
 * other, on an orbit whose period follows from the planet's mass, pulling on its planet and on a
 * ship; it is drawn, named, listed and flown to like the rest, and says in its facts that it was
 * made. So far: a moon can be given to a world, and taken away again.
 */

/** the bodies made here are numbered from this on (the catalogue's ids end far below) */
export const MADE_FIRST_ID = 900_000_001;
/** as many as this at a time (the layers that draw bodies have room for a few more than the catalogue's) */
export const MADE_MOST = 24;

/** rock and ice (kg/m³): what moons this side of the frost line and beyond it are mostly made of */
const ROCK = 3000, ICE = 1500;
const FROST_LINE = 3 * AU;

export interface NewMoon {
  json: BodyJson;
  /** its radius and the radius of its orbit (m), and how long once round takes (days) */
  radius: number;
  orbit: number;
  periodDays: number;
}

/** Can this world be given a moon? A planet or a dwarf planet that still has room for one. */
export function canHaveMoon(b: Body, made: number): boolean {
  return (b.kind === 'planet' || b.kind === 'dwarf') && b.gm > 0 && b.valid && made < MADE_MOST;
}

/**
 * A new moon for `parent`, as it would be described in the catalogue. Its size goes with its
 * planet's (an eighth of it, between a small moon's and our Moon's); rock near the Sun, ice beyond
 * the frost line; a circular orbit in the plane of the planet's equator, between the planet and the
 * eye where there is room (`eyeDistance`: from the planet's centre, m), never inside the Roche
 * limit where it would be pulled apart; and the period that Kepler's third law gives it there.
 * `count`: how many moons have been made for this planet before; `id`: its number.
 */
export function newMoon(parent: Body, eyeDistance: number, sunDistance: number, jd: number, count: number, id: number): NewMoon {
  const R = parent.radius;
  const radius = Math.min(1.8e6, Math.max(60e3, 0.12 * R));
  const icy = sunDistance > FROST_LINE;
  const rho = icy ? ICE : ROCK;
  const mass = rho * (4 / 3) * Math.PI * radius ** 3;
  const parentRho = parent.gm / G / ((4 / 3) * Math.PI * R ** 3);
  const roche = 2.44 * R * Math.cbrt(parentRho / rho);
  const orbit = Math.min(60 * R, Math.max(3 * R, 1.1 * roche, 0.55 * eyeDistance));
  const periodDays = (2 * Math.PI * Math.sqrt(orbit ** 3 / (parent.gm + G * mass))) / 86400;
  return {
    radius, orbit, periodDays,
    json: {
      id, name: `${parent.name}'s new moon${count > 0 ? ` ${count + 1}` : ''}`, type: 'moon', parent: parent.id, made: true,
      radii: [radius / 1e3, radius / 1e3, radius / 1e3], gm: (G * mass) / 1e9,
      albedo: icy ? 0.55 : 0.12, color: icy ? [0.82, 0.84, 0.88] : [0.52, 0.5, 0.47],
      ephem: { kind: 'satellite', orbit: { frame: 'equatorial', epochJd: jd, a: orbit / 1e3, e: 0, i: 0, node: 0, w: 0, M: 0, P: periodDays } },
    },
  };
}
