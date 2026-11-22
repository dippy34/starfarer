import { OBLIQUITY_J2000 } from '../core/frames';
import { AU } from '../core/units';
import { G } from '../sim/physics';
import type { Body } from '../universe/Body';
import type { BodyJson } from '../universe/SolarSystem';
import { circularVelocity } from './Powers';

/**
 * What if: what the explorer adds to the worlds (the card's Add, src/ui/Hud.ts). A planet or a
 * dwarf planet can be given a moon; a star a planet like the Earth, one like Jupiter, or a second
 * sun. What is made obeys the same physics as what was found: it joins the simulation the moment
 * it is made (src/app/LivePhysics.ts), on a circle round what it was given to, and from then on
 * pulls and is pulled like the rest; it is drawn, named, listed, flown to, moved, made heavier and
 * taken away like the rest, and says in its facts that it was made.
 *
 * A copy (of the Earth, of Jupiter, of the Sun) has the size, mass, spin and face of what it is a
 * copy of, and nothing else of it: no air, clouds, rings or lights of its own, and where it has
 * ground to stand on that ground is not the original's.
 */

/** the bodies made here are numbered from this on (the catalogue's ids end far below) */
export const MADE_FIRST_ID = 900_000_001;
/** as many as this between one return to reality and the next (the layers that draw bodies have room for a few more than the catalogue's) */
export const MADE_MOST = 24;

/** what can be made: a moon, or a copy of the Earth, of Jupiter, of the Sun */
export type Kind = 'moon' | 'earth' | 'jupiter' | 'sun';
/** the catalogue's number of the body each copy is a copy of */
export const TWIN_OF: Record<Exclude<Kind, 'moon'>, number> = { earth: 399, jupiter: 599, sun: 10 };

/** rock and ice (kg/m³): what moons this side of the frost line and beyond it are mostly made of */
const ROCK = 3000, ICE = 1500;
const FROST_LINE = 3 * AU;
/** what is made for a star starts no nearer it than this (a sun needs more room than a planet), and no farther than the edge of the planets (m) */
const NEAREST_PLANET = 0.1 * AU, NEAREST_SUN = 0.3 * AU, FARTHEST = 60 * AU;
/** what is made starts this share of the way from what it is given to towards the eye, where there is room */
const TOWARDS_EYE = 0.55;

type Triple = [number, number, number];

/** the pole of the plane the planets move in (the ecliptic's north, ICRF) */
const PLANETS_POLE: Triple = [0, -Math.sin(OBLIQUITY_J2000), Math.cos(OBLIQUITY_J2000)];

export interface Plan {
  /** the new body, as the catalogue would describe it */
  json: BodyJson;
  /** the radius of its orbit (m), and how long once round takes (days) */
  orbit: number;
  periodDays: number;
  /** where it starts and how it moves there, from the body it is given to (m, m/s) */
  pos: Triple;
  vel: Triple;
}

/**
 * What can be added to a world: a moon to a planet or a dwarf planet; to a star a planet like the
 * Earth, one like Jupiter, or another sun. Nothing once `made` bodies have been made already and
 * there is room for no more.
 */
export function canAdd(b: Body, made: number): Kind[] {
  if (!b.valid || !(b.gm > 0) || made >= MADE_MOST) return [];
  if (b.kind === 'star') return ['earth', 'jupiter', 'sun'];
  return b.kind === 'planet' || b.kind === 'dwarf' ? ['moon'] : [];
}

/**
 * A new moon for `parent`. Its size goes with its planet's (an eighth of it, between a small
 * moon's and our Moon's); rock near its sun, ice beyond the frost line (`sunDistance`, m); a
 * circular orbit in the plane of the planet's equator, the way the planet turns, between the
 * planet and the eye where there is room (`eye`: from the planet's centre to the eye, m), never
 * inside the Roche limit where it would be pulled apart; and the period that Kepler's third law
 * gives it there. `count`: how many moons have been made for this planet before; `id`: its number.
 */
export function newMoon(parent: Body, eye: ArrayLike<number>, sunDistance: number, count: number, id: number): Plan {
  const R = parent.radius;
  const radius = Math.min(1.8e6, Math.max(60e3, 0.12 * R));
  const icy = sunDistance > FROST_LINE;
  const rho = icy ? ICE : ROCK;
  const gm = G * rho * (4 / 3) * Math.PI * radius ** 3;
  const parentRho = parent.gm / G / ((4 / 3) * Math.PI * R ** 3);
  const roche = 2.44 * R * Math.cbrt(parentRho / rho);
  const orbit = Math.min(60 * R, Math.max(3 * R, 1.1 * roche, TOWARDS_EYE * Math.hypot(eye[0], eye[1], eye[2])));
  // (the way it turns: the pole of its rotation model is the northern one, whichever way it spins about it)
  const o = parent.orientation.elements, spin = parent.rotation && parent.rotation.pm[1] < 0 ? -1 : 1;
  return {
    ...circle(orbit, parent.gm + gm, [spin * o[8], spin * o[9], spin * o[10]], eye),
    json: {
      id, name: `${parent.name}'s new moon${count > 0 ? ` ${count + 1}` : ''}`, type: 'moon', parent: parent.id, made: true,
      radii: [radius / 1e3, radius / 1e3, radius / 1e3], gm: gm / 1e9,
      albedo: icy ? 0.55 : 0.12, color: icy ? [0.82, 0.84, 0.88] : [0.52, 0.5, 0.47],
      ephem: { kind: 'placed' },
    },
  };
}

/**
 * A copy of `like` (a planet, or the Sun) for the star `star`: as the catalogue describes the
 * original, with `texture` for its face (the key of the original's map, or null); on a circle
 * round the star in the plane the planets move in, the way they go, between the star and the eye
 * where there is room (`eye`: from the star's centre to the eye, m). `count`: how many copies of
 * it have been made before; `id`: its number.
 */
export function newTwin(like: Body, texture: string | null, star: Body, eye: ArrayLike<number>, count: number, id: number): Plan {
  const described = like.meta as unknown as BodyJson, gm = (described.gm ?? 0) * 1e9;
  const nearest = like.kind === 'star' ? NEAREST_SUN : NEAREST_PLANET;
  const orbit = Math.min(FARTHEST, Math.max(nearest, TOWARDS_EYE * Math.hypot(eye[0], eye[1], eye[2])));
  return {
    ...circle(orbit, star.gm + gm, PLANETS_POLE, eye),
    json: {
      ...described, id, name: `${like.name} ${count + 2}`, parent: star.id, made: true, twinOf: like.id,
      systemGm: undefined, texture: texture ?? undefined, ephem: { kind: 'placed' },
    },
  };
}

/**
 * A circle of radius `orbit` (m) about what a body is given to, the two together having `mu` (G
 * times their masses, m³/s²), in the plane whose normal is `normal`, turning the way a right
 * hand's fingers curl about it: the body starts on the side the eye is on, as nearly as the plane
 * allows.
 */
function circle(orbit: number, mu: number, normal: Triple, eye: ArrayLike<number>): Pick<Plan, 'orbit' | 'periodDays' | 'pos' | 'vel'> {
  const up = eye[0] * normal[0] + eye[1] * normal[1] + eye[2] * normal[2];
  let side: Triple = [eye[0] - up * normal[0], eye[1] - up * normal[1], eye[2] - up * normal[2]];
  // (an eye straight over the pole is on no side: any will do)
  if (Math.hypot(...side) <= 1e-6 * Math.abs(up)) {
    const a: Triple = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    side = [normal[1] * a[2] - normal[2] * a[1], normal[2] * a[0] - normal[0] * a[2], normal[0] * a[1] - normal[1] * a[0]];
  }
  const k = orbit / Math.hypot(...side);
  const pos: Triple = [k * side[0], k * side[1], k * side[2]];
  return { orbit, periodDays: (2 * Math.PI * Math.sqrt(orbit ** 3 / mu)) / 86400, pos, vel: circularVelocity(pos, mu, normal) };
}
