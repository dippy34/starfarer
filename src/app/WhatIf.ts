import { OBLIQUITY_J2000 } from '../core/frames';
import { AU, SUN_ABS_MAG } from '../core/units';
import { G, M_EARTH, M_JUPITER, M_SUN, mainSequence, num, R_EARTH, R_JUPITER, R_SUN, radiusFromDensity } from '../sim/physics';
import type { Body } from '../universe/Body';
import type { BodyJson } from '../universe/SolarSystem';
import { circularVelocity, M_MOON, massWords } from './Powers';

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
 * ground to stand on that ground is not the original's. While it is being put in place its mass
 * can be set, from a small moon to two suns across the four kinds (MADE_MASS), and its size then
 * follows from its mass by the rule for what it is (madeSize), and for a sun its light and colour.
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
      ephem: { kind: 'placed' }, madeAs: { kind: 'moon', kg: gm / G, icy },
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
  const kind = (Object.keys(TWIN_OF) as (keyof typeof TWIN_OF)[]).find((k) => TWIN_OF[k] === like.id) ?? 'earth';
  return {
    ...circle(orbit, star.gm + gm, PLANETS_POLE, eye),
    json: {
      ...described, id, name: `${like.name} ${count + 2}`, parent: star.id, made: true, twinOf: like.id,
      systemGm: undefined, texture: texture ?? undefined, ephem: { kind: 'placed' }, madeAs: { kind, kg: gm / G, icy: false },
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

// ---------------------------------------------------------------- what is made: its mass, and the size that follows

/** worlds like the Earth are made of rock at the Earth's mean density, up to this mass (kg) */
export const ROCKY_MOST = 10 * M_EARTH;
/** the Earth's mean density (kg/m³; NASA's planetary fact sheet): R = R⊕ (M / M⊕)^⅓ is a ball of it */
export const EARTH_DENSITY = 5514;
/** from this mass (kg) a giant planet is about Jupiter's size: its insides are squeezed so hard that more mass makes it no larger */
export const GIANT_FROM = 0.3 * M_JUPITER;
/** from here (kg) deuterium fuses in a giant's core: a brown dwarf, still about Jupiter's size */
const BROWN_DWARF_FROM = 13 * M_JUPITER;
/** from here (kg) hydrogen fuses: a star of the main sequence (src/sim/physics.ts, mainSequence) */
export const STAR_FROM = 0.08 * M_SUN;

/**
 * The masses each kind can be made with (kg): from a small moon to two suns across the four. A
 * moon from a millionth of the Moon's mass (a rock some 36 km across) to ten Moons; a world like
 * the Earth from a twentieth of the Earth's (Mercury has 0.055) to ten Earths; one like Jupiter from
 * there to where a star begins; a sun from there to two Suns.
 */
export const MADE_MASS: Record<Kind, readonly [number, number]> = {
  moon: [1e-6 * M_MOON, 10 * M_MOON],
  earth: [0.05 * M_EARTH, ROCKY_MOST],
  jupiter: [ROCKY_MOST, STAR_FROM],
  sun: [STAR_FROM, 2 * M_SUN],
};

/** How a made body's size follows from its mass (madeSize). */
export type SizeRule = 'rock' | 'ice' | 'earth' | 'between' | 'giant' | 'brown dwarf' | 'star';

export interface Sized {
  /** its mean radius (m), and the rule that gave it */
  radius: number;
  rule: SizeRule;
  /** a sun's surface temperature (K) and light (times the Sun's), from the main sequence */
  teff?: number;
  lum?: number;
}

/** the radius of a rock of ROCKY_MOST (m), and the power of the mass that takes it to Jupiter's at GIANT_FROM */
const ROCK_TOP = R_EARTH * Math.cbrt(ROCKY_MOST / M_EARTH);
const BETWEEN = Math.log(R_JUPITER / ROCK_TOP) / Math.log(GIANT_FROM / ROCKY_MOST);

/**
 * The size of a body made as `kind` with `kg` of mass (`icy`: a moon made beyond the frost line):
 * - a moon: a ball of rock (3,000 kg/m³), or of ice and rock (1,500), as newMoon makes one;
 * - a world like the Earth: rock at the Earth's mean density, R = R⊕ (M / M⊕)^⅓ (5 Earths: 1.71 R⊕);
 * - a giant from 0.3 Jupiters on, and a brown dwarf: about Jupiter's size;
 * - between 10 Earths and 0.3 Jupiters, where a world's size depends on how much gas it has
 *   gathered: the straight line between the two in the logarithm, from the rock of 10 Earths
 *   (2.15 R⊕) to Jupiter's size (Neptune's 17 Earths come out 3.2 R⊕; it measures 3.9);
 * - a sun: a star of the main sequence of that mass: its radius, temperature and light.
 */
export function madeSize(kind: Kind, kg: number, icy: boolean): Sized {
  switch (kind) {
    case 'moon': return { radius: radiusFromDensity(kg, icy ? ICE : ROCK), rule: icy ? 'ice' : 'rock' };
    case 'earth': return { radius: R_EARTH * Math.cbrt(kg / M_EARTH), rule: 'earth' };
    case 'jupiter':
      if (kg >= GIANT_FROM) return { radius: R_JUPITER, rule: kg >= BROWN_DWARF_FROM ? 'brown dwarf' : 'giant' };
      return { radius: ROCK_TOP * Math.pow(kg / ROCKY_MOST, BETWEEN), rule: 'between' };
    case 'sun': {
      const ms = mainSequence(kg / M_SUN);
      return { radius: ms.radius.value, rule: 'star', teff: ms.teff.value, lum: ms.lum.value };
    }
  }
}

/**
 * A made sun's absolute magnitude, from its light (times the Sun's): the Sun's, brighter or fainter
 * by that. (Light of every colour is counted as if it were visible light: a red dwarf would look
 * fainter than this, its light being mostly infrared.)
 */
export function madeAbsMag(lum: number): number {
  return SUN_ABS_MAG - 2.5 * Math.log10(lum);
}

/** within this many powers of ten of what Add makes, the slider means exactly that */
const MADE_SNAP = 0.03;

/** Where on its slider (0 to 1, even in the logarithm) a body made as `kind` with `kg` stands. */
export function madeSlider(kind: Kind, kg: number): number {
  const [lo, hi] = MADE_MASS[kind];
  return Math.max(0, Math.min(1, Math.log(kg / lo) / Math.log(hi / lo)));
}

/** The mass (kg) at `s` (0 to 1) on the slider of `kind`: exactly `base` (what Add makes) within MADE_SNAP powers of ten of it. */
export function madeMassAt(kind: Kind, s: number, base: number): number {
  const [lo, hi] = MADE_MASS[kind];
  const kg = lo * Math.pow(hi / lo, Math.max(0, Math.min(1, s)));
  return Math.abs(Math.log10(kg / base)) < MADE_SNAP ? base : kg;
}

/** A ratio as a person says it: "1.71", "3.18", "0.13". */
const times = (x: number) => String(Number(x.toPrecision(x < 1 ? 2 : 3)));
const km = (m: number) => `${Math.round(m / 1e3).toLocaleString('en-US')} km`;

/** What a body made as `kind` with `kg` of mass is, in words: its mass, and what it is and how big. */
export function madeWords(kind: Kind, kg: number, icy: boolean): { mass: string; what: string } {
  const s = madeSize(kind, kg, icy), mass = massWords(kg);
  switch (s.rule) {
    case 'rock': return { mass, what: `Rock, ${km(s.radius)} in radius` };
    case 'ice': return { mass, what: `Ice and rock, ${km(s.radius)} in radius` };
    case 'earth': return { mass, what: Math.abs(s.radius / R_EARTH - 1) < 0.005 ? "Rock, the Earth's size" : `Rock, ${times(s.radius / R_EARTH)} times the Earth's size` };
    case 'between': return { mass, what: `Rock and gas, ${times(s.radius / R_EARTH)} times the Earth's size` };
    case 'giant': return { mass, what: "A giant of gas, Jupiter's size" };
    case 'brown dwarf': return { mass, what: "A brown dwarf, Jupiter's size" };
    case 'star': return { mass, what: Math.abs(kg / M_SUN - 1) < 0.005 ? 'A star like the Sun' : `A star, ${times(s.radius / R_SUN)} times the Sun's size, ${(Math.round(s.teff! / 10) * 10).toLocaleString('en-US')} K` };
  }
}

/** How the size of a body made as `kind` with `kg` of mass was worked out: the formula, the numbers put in, the result, and the rule. */
export function madeWorking(kind: Kind, kg: number, icy: boolean): { label: string; text: string; math: string } {
  const s = madeSize(kind, kg, icy), text = km(s.radius), label = 'Its size (made by you)';
  switch (s.rule) {
    case 'rock': case 'ice': {
      const rho = s.rule === 'ice' ? ICE : ROCK;
      return { label, text, math: `R = (3M / 4πρ)^⅓ = (3·${num(kg)} kg / (4π·${rho.toLocaleString('en-US')} kg/m³))^⅓ = ${text}: a ball of ${s.rule === 'ice' ? 'ice and rock (beyond the frost line)' : 'rock'}` };
    }
    case 'earth':
      return { label, text, math: `R = R⊕ (M / M⊕)^⅓ = 6,371 km·(${num(kg / M_EARTH)})^⅓ = ${text}: rock at the Earth's mean density, ${EARTH_DENSITY.toLocaleString('en-US')} kg/m³` };
    case 'between':
      return { label, text, math: `R = R₁₀ (M / 10 M⊕)^${num(BETWEEN, 3)} = ${km(ROCK_TOP)}·(${num(kg / ROCKY_MOST)})^${num(BETWEEN, 3)} = ${text}: between a rock of 10 Earths and Jupiter's size at 0.3 Jupiters (a world's size here depends on how much gas it has gathered)` };
    case 'giant': case 'brown dwarf':
      return { label, text, math: `R ≈ R♃ = ${km(R_JUPITER)}: ${s.rule === 'giant' ? 'a giant planet' : 'a brown dwarf'} is about Jupiter's size whatever its mass, its insides squeezed so hard that more mass makes it no larger` };
    case 'star':
      return { label, text, math: `${mainSequence(kg / M_SUN).radius.math}: a star of the main sequence (its temperature and light follow from its mass too)` };
  }
}
