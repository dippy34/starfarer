import { OBLIQUITY_J2000 } from '../core/frames';
import { AU, SUN_ABS_MAG } from '../core/units';
import { C, G, M_EARTH, M_JUPITER, M_SUN, mainSequence, num, R_EARTH, R_JUPITER, R_SUN, radiusFromDensity } from '../sim/physics';
import type { Body } from '../universe/Body';
import type { BodyJson } from '../universe/SolarSystem';
import type { MadeRecord } from './SceneWorld';
import { circularVelocity, massWords, starMassWords } from './Powers';

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
 *
 * A star can also be given a made world of a generated look (WORLD_KINDS: a rocky, ocean, desert,
 * lava or icy world, an ice giant, a gas giant): no original and no map, drawn with the look of its
 * type that the made-up planets of other stars have (src/render/PlanetLook.ts), varied by a seed.
 * Its type and seed are kept with it (`madeAs`), so that Undo, Replay, a save and a link bring back
 * the same world.
 */

/** the bodies made here are numbered from this on (the catalogue's ids end far below) */
export const MADE_FIRST_ID = 900_000_001;
/** as many as this between one return to reality and the next (the layers that draw bodies have room for a few more than the catalogue's) */
export const MADE_MOST = 24;

/**
 * The worlds that are made with a generated look of their own (src/render/PlanetLook.ts), named by
 * the type of the look, in the order Add offers them: no map, no original, and a seed that varies
 * the look within its type.
 */
export const WORLD_KINDS = ['terran', 'ocean', 'desert', 'lava', 'ice', 'giant', 'icegiant'] as const;
export type WorldKind = (typeof WORLD_KINDS)[number];
export const isWorldKind = (k: string): k is WorldKind => (WORLD_KINDS as readonly string[]).includes(k);

/** what Add offers: a planet, a star, a black hole round a star; a moon round a planet or a dwarf planet (what a planet is, from its mass, is its look: `typeFor`) */
export type Choice = 'planet' | 'star' | 'hole' | 'moon';

/** what can be made, as it is kept: a moon, a copy of the Earth, of Jupiter, of the Sun, a world of a generated look, or a black hole */
export type Kind = 'moon' | 'earth' | 'jupiter' | 'sun' | WorldKind | 'hole';
/** a copy: of the Earth, of Jupiter, of the Sun */
export type CopyKind = 'earth' | 'jupiter' | 'sun';
export const isCopyKind = (k: string): k is CopyKind => k === 'earth' || k === 'jupiter' || k === 'sun';
/** the catalogue's number of the body each copy is a copy of */
export const TWIN_OF: Record<CopyKind, number> = { earth: 399, jupiter: 599, sun: 10 };

/** rock and ice (kg/m³): what moons this side of the frost line and beyond it are mostly made of */
const ROCK = 3000, ICE = 1500;
/**
 * Where things are round a star (m): the frost line, beyond which a moon is made of ice; how near
 * it a planet, and a second sun (which needs more room), are made at the nearest; and the edge of
 * its planets, beyond which nothing is made.
 */
export interface Zones { frost: number; nearestPlanet: number; nearestSun: number; farthest: number }

/** Round the Sun: the frost line at 3 AU, the nearest planet at 0.1 AU and sun at 0.3 AU, the farthest at 60 AU. */
export const SUN_ZONES: Zones = { frost: 3 * AU, nearestPlanet: 0.1 * AU, nearestSun: 0.3 * AU, farthest: 60 * AU };

/**
 * The same zones round another star of `lumSun` times the Sun's light and `massSun` times its mass.
 * Distances set by warmth (the frost line, and how near to its star a world is made) go as the
 * square root of the star's light: a world's equilibrium temperature goes as L^¼ / d^½, so a given
 * temperature is at d ∝ √L (the snow line of Hayashi 1981, 2.7 AU √L, is the classic use of it).
 * The edge of the planets goes as the square root of the star's mass, as the app's own generator
 * has it (src/universe/Planets.ts: generatePlanets). Round TRAPPIST-1 (L = 0.00055, M = 0.09 Suns)
 * the frost line is at 0.07 AU, among its planets at 0.01 to 0.06 AU, not 3 AU out.
 */
export function zonesOf(lumSun: number, massSun: number): Zones {
  const warm = Math.sqrt(lumSun), reach = Math.sqrt(massSun);
  return { frost: SUN_ZONES.frost * warm, nearestPlanet: SUN_ZONES.nearestPlanet * warm, nearestSun: SUN_ZONES.nearestSun * warm, farthest: SUN_ZONES.farthest * reach };
}
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
 * Earth, one like Jupiter, another sun, or a made world of a generated look. Nothing once `made` bodies have been made already and
 * there is room for no more.
 */
export function canAdd(b: Body, made: number): Choice[] {
  if (!b.valid || !(b.gm > 0) || made >= MADE_MOST) return [];
  if (b.kind === 'star') return ['planet', 'star', 'hole'];
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
export function newMoon(parent: Body, eye: ArrayLike<number>, sunDistance: number, count: number, id: number, zones: Zones = SUN_ZONES): Plan {
  const R = parent.radius;
  const radius = Math.min(1.8e6, Math.max(60e3, 0.12 * R));
  const icy = sunDistance > zones.frost;
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
export function newTwin(like: Body, texture: string | null, star: Body, eye: ArrayLike<number>, count: number, id: number, zones: Zones = SUN_ZONES): Plan {
  const described = like.meta as unknown as BodyJson, gm = (described.gm ?? 0) * 1e9;
  const nearest = like.kind === 'star' ? zones.nearestSun : zones.nearestPlanet;
  const orbit = Math.min(zones.farthest, Math.max(nearest, TOWARDS_EYE * Math.hypot(eye[0], eye[1], eye[2])));
  const kind = (Object.keys(TWIN_OF) as (keyof typeof TWIN_OF)[]).find((k) => TWIN_OF[k] === like.id) ?? 'earth';
  return {
    ...circle(orbit, star.gm + gm, PLANETS_POLE, eye),
    json: {
      ...described, id, name: `${like.name} ${count + 2}`, parent: star.id, made: true, twinOf: like.id,
      systemGm: undefined, texture: texture ?? undefined, ephem: { kind: 'placed' }, madeAs: { kind, kg: gm / G, icy: false },
    },
  };
}

/** What a generated look gives the body that wears it: its mean albedo and a colour for it seen as a point. */
export interface MadeLook { albedo: number; color: [number, number, number] }

/** A new seed for a look (a whole number below a million), not `not`. */
export function newSeed(random: () => number, not = -1): number {
  let seed = Math.floor(random() * 1e6);
  if (seed === not) seed = (seed + 1) % 1e6;
  return seed;
}

/**
 * A made world of a generated look (`kind`: its type) for the star `star`: no map and no original, its size from its
 * mass (madeSize), `look` for its brightness; on a circle round the star in the plane the planets move in, the way they go,
 * between the star and the eye where there is room (`eye`: from the star's centre to the eye, m). `count`: how many of this
 * kind have been made before; `id`: its number; `seed`: what varies its look within its kind.
 */
export function newWorld(kind: WorldKind, star: Body, eye: ArrayLike<number>, count: number, id: number, seed: number, look: MadeLook, zones: Zones = SUN_ZONES): Plan {
  const kg = WORLD_BASE[kind], gm = G * kg, radius = madeSize(kind, kg, false).radius;
  const orbit = Math.min(zones.farthest, Math.max(zones.nearestPlanet, TOWARDS_EYE * Math.hypot(eye[0], eye[1], eye[2])));
  return {
    ...circle(orbit, star.gm + gm, PLANETS_POLE, eye),
    json: {
      id, name: `New ${WORLD_NAME[kind]}${count > 0 ? ` ${count + 1}` : ''}`, type: 'planet', parent: star.id, made: true,
      radii: [radius / 1e3, radius / 1e3, radius / 1e3], gm: gm / 1e9, albedo: look.albedo, color: look.color,
      ephem: { kind: 'placed' }, madeAs: { kind, kg, icy: false, seed },
    },
  };
}

/**
 * A black hole of your own for the star `star`: ten Suns (HOLE_BASE) to begin with, its size the event horizon (madeSize), no
 * light (its albedo and colour are black: a hole shines by nothing), on a circle round the star in the plane the planets move in,
 * the way they go, between the star and the eye where there is room (as a second sun is, at the nearest `zones.nearestSun`).
 * `count`: how many holes have been made before; `id`: its number.
 */
export function newHole(star: Body, eye: ArrayLike<number>, count: number, id: number, zones: Zones = SUN_ZONES): Plan {
  const kg = HOLE_BASE, gm = G * kg, radius = madeSize('hole', kg, false).radius;
  const orbit = Math.min(zones.farthest, Math.max(zones.nearestSun, TOWARDS_EYE * Math.hypot(eye[0], eye[1], eye[2])));
  return {
    ...circle(orbit, star.gm + gm, PLANETS_POLE, eye),
    json: {
      id, name: `Black hole${count > 0 ? ` ${count + 1}` : ''}`, type: 'planet', parent: star.id, made: true,
      radii: [radius / 1e3, radius / 1e3, radius / 1e3], gm: gm / 1e9, albedo: 0, color: [0, 0, 0],
      ephem: { kind: 'placed' }, madeAs: { kind: 'hole', kg, icy: false },
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
export const BROWN_DWARF_FROM = 13 * M_JUPITER;
/** from here (kg) hydrogen fuses: a star of the main sequence (src/sim/physics.ts, mainSequence) */
export const STAR_FROM = 0.08 * M_SUN;
/** the lightest planet or moon made: a millionth of an Earth; the heaviest on its slider: 10,000 Earths; the heaviest star: 150 Suns; the heaviest black hole: ten billion Suns */
export const PLANET_LOW = 1e-6 * M_EARTH, PLANET_HIGH = 1e4 * M_EARTH, STAR_HIGH = 150 * M_SUN, HOLE_HIGH = 1e10 * M_SUN;

/**
 * The masses each kind can be made with (kg): from a small moon to two suns across the four. A
 * moon from a millionth of the Moon's mass (a rock some 36 km across) to ten Moons; a world like
 * the Earth from a twentieth of the Earth's (Mercury has 0.055) to ten Earths; one like Jupiter from
 * there to where a star begins; a sun from there to two Suns.
 */
export const MADE_MASS: Record<Kind, readonly [number, number]> = {
  // a moon and a planet of any look (and the copies of the Earth and Jupiter that links and saves written before still hold): from a
  // millionth of an Earth to 10,000 Earths on the slider (the number field takes up to the heaviest star: see `takeMass`)
  moon: [PLANET_LOW, PLANET_HIGH],
  earth: [PLANET_LOW, PLANET_HIGH],
  jupiter: [PLANET_LOW, PLANET_HIGH],
  terran: [PLANET_LOW, PLANET_HIGH],
  ocean: [PLANET_LOW, PLANET_HIGH],
  desert: [PLANET_LOW, PLANET_HIGH],
  lava: [PLANET_LOW, PLANET_HIGH],
  ice: [PLANET_LOW, PLANET_HIGH],
  icegiant: [PLANET_LOW, PLANET_HIGH],
  giant: [PLANET_LOW, PLANET_HIGH],
  // a star: from where hydrogen fuses (0.08 Suns) to the heaviest stars found (150 Suns, Crowther et al. 2010)
  sun: [STAR_FROM, STAR_HIGH],
  // a black hole: from one Sun (the lightest found are a few) to ten billion (the heaviest measured are some tens of billions)
  hole: [M_SUN, HOLE_HIGH],
};

/** a black hole is made with ten Suns, as Add makes it; the slider moves it from there */
export const HOLE_BASE = 10 * M_SUN;

/** The Schwarzschild radius, the size of a black hole's event horizon (m): r = 2GM / c² (the Sun's is 2.95 km; ten Suns' 29.5 km). */
export function schwarzschild(kg: number): number {
  return (2 * G * kg) / (C * C);
}

/**
 * How near a black hole of `holeKg` a world of radius `radius` (m) and mass `worldKg` can come before the hole's tides tear it
 * apart (m, from the hole's centre): the Roche limit of a rigid body, d = R (2 M_hole / M_world)^⅓ (the Earth and ten Suns:
 * about 1.2 million km). A real world has some give, which moves it by a fraction; the rigid form is the simple one.
 */
export function rocheLimit(radius: number, worldKg: number, holeKg: number): number {
  return radius * Math.cbrt((2 * holeKg) / worldKg);
}

/**
 * What a made world of a generated look has when it is first made (kg): the Earth's mass for the
 * rock, ocean, desert and lava worlds, a hundredth of it for an icy one (as Europa's 0.008 and
 * Ganymede's 0.025), Uranus's 14.5 for an ice giant, Jupiter's for a gas giant. The slider moves it from there.
 */
export const WORLD_BASE: Record<WorldKind, number> = {
  terran: M_EARTH, ocean: M_EARTH, desert: M_EARTH, lava: M_EARTH, ice: 0.01 * M_EARTH, icegiant: 14.5 * M_EARTH, giant: M_JUPITER,
};

/** What each kind of made world is, in words: "A rocky world". */
export const WORLD_NAME: Record<WorldKind, string> = {
  terran: 'rocky world', ocean: 'ocean world', desert: 'desert world', lava: 'lava world', ice: 'icy world', giant: 'gas giant', icegiant: 'ice giant',
};

/** How a made body's size follows from its mass (madeSize). */
export type SizeRule = 'rock' | 'ice' | 'earth' | 'terran' | 'neptunian' | 'between' | 'giant' | 'brown dwarf' | 'star' | 'horizon';

/**
 * The published mass-radius relation the worlds of your own follow (Chen & Kipping 2017, "Probabilistic
 * Forecasting of the Masses and Radii of Other Worlds", ApJ 834, 17, Table 1): R ∝ M^0.2790 for rocky
 * (Terran) worlds, R ∝ M^0.589 for Neptunian ones above 2.04 Earths, the two meeting there. Taken
 * through the Earth's own size (their constant, 1.008 +0.046/-0.045 R⊕, has the Earth within it), so
 * a rocky world of the Earth's mass is the Earth's size. Checked against the planets (docs/notes/ideas.md):
 * Mars and Venus within 2 %, Uranus within 3 % and Neptune within 12 % (their scatter is 14.6 %). Not for
 * gas giants: their Jovian piece makes Jupiter's mass 1.25 Jupiters across (its giants are mostly hot,
 * puffed-up ones), so those keep Jupiter's size.
 */
export const TERRAN_SLOPE = 0.279, NEPTUNIAN_SLOPE = 0.589, NEPTUNIAN_FROM = 2.04 * M_EARTH;
const NEPTUNIAN_BASE = R_EARTH * Math.pow(NEPTUNIAN_FROM / M_EARTH, TERRAN_SLOPE);

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
 * - a world like the Earth (a copy): rock at the Earth's mean density, R = R⊕ (M / M⊕)^⅓ (5 Earths: 1.71 R⊕);
 * - a rock, ocean, desert or lava world of your own: rocky worlds as measured ones are, R = R⊕ (M / M⊕)^0.279 (TERRAN_SLOPE: 5 Earths 1.57 R⊕);
 * - an icy world: a ball of ice and rock (1,500 kg/m³), as an icy moon; an ice giant: as a rocky world up to 2.04 Earths, then
 *   as Neptunian worlds are, R ∝ M^0.589 (NEPTUNIAN_SLOPE: Uranus's mass 3.87 R⊕, it measures 3.98);
 * - a gas giant: as a giant like Jupiter (below), from 10 Earths;
 * - a giant from 0.3 Jupiters on, and a brown dwarf: about Jupiter's size;
 * - between 10 Earths and 0.3 Jupiters, where a world's size depends on how much gas it has
 *   gathered: the straight line between the two in the logarithm, from the rock of 10 Earths
 *   (2.15 R⊕) to Jupiter's size (Neptune's 17 Earths come out 3.2 R⊕; it measures 3.9);
 * - a sun: a star of the main sequence of that mass: its radius, temperature and light.
 */
export function madeSize(kind: Kind, kg: number, icy: boolean): Sized {
  // (past what a look's own rule covers, a planet's size follows its mass alone: `bigWorld`)
  switch (kind) {
    case 'moon': return { radius: radiusFromDensity(kg, icy ? ICE : ROCK), rule: icy ? 'ice' : 'rock' };
    // (a copy of the Earth keeps the Earth's density, as a copy; a rocky world of your own follows the published relation)
    case 'earth': return { radius: R_EARTH * Math.cbrt(kg / M_EARTH), rule: 'earth' };
    case 'terran': case 'ocean': case 'desert': case 'lava':
      return kg > ROCKY_MOST ? bigWorld(kg) : { radius: R_EARTH * Math.pow(kg / M_EARTH, TERRAN_SLOPE), rule: 'terran' };
    case 'ice':
      if (kg > ICY_MOST) return kg > ROCKY_MOST ? bigWorld(kg) : { radius: R_EARTH * Math.pow(kg / M_EARTH, TERRAN_SLOPE), rule: 'terran' };
      return { radius: radiusFromDensity(kg, ICE), rule: 'ice' };
    case 'icegiant':
      if (kg <= NEPTUNIAN_FROM) return { radius: R_EARTH * Math.pow(kg / M_EARTH, TERRAN_SLOPE), rule: 'terran' };
      if (kg > ICEGIANT_MOST) return bigWorld(kg);
      return { radius: NEPTUNIAN_BASE * Math.pow(kg / NEPTUNIAN_FROM, NEPTUNIAN_SLOPE), rule: 'neptunian' };
    case 'giant':
      return kg < ROCKY_MOST ? { radius: R_EARTH * Math.pow(kg / M_EARTH, TERRAN_SLOPE), rule: 'terran' } : bigWorld(kg);
    case 'jupiter':
      if (kg >= GIANT_FROM) return { radius: R_JUPITER, rule: kg >= BROWN_DWARF_FROM ? 'brown dwarf' : 'giant' };
      return { radius: ROCK_TOP * Math.pow(kg / ROCKY_MOST, BETWEEN), rule: 'between' };
    case 'sun': {
      const ms = mainSequence(kg / M_SUN);
      return { radius: ms.radius.value, rule: 'star', teff: ms.teff.value, lum: ms.lum.value };
    }
    // a black hole: its event horizon, the Schwarzschild radius
    case 'hole': return { radius: schwarzschild(kg), rule: 'horizon' };
  }
}

/** an icy world is a ball of ice and rock up to this mass (kg; 5 Earths), and an ice giant is of rock, ice and gas up to this (50 Earths) */
const ICY_MOST = 5 * M_EARTH, ICEGIANT_MOST = 50 * M_EARTH;

/**
 * A world heavier than its look's own rule covers: its size follows its mass alone, from the rock of 10 Earths (2.15 R⊕) to Jupiter's size
 * at 0.3 Jupiters, where it stays whatever the mass (a giant planet, then a brown dwarf from 13 Jupiters: its insides are squeezed so hard that
 * more mass makes it no larger).
 */
function bigWorld(kg: number): Sized {
  if (kg >= GIANT_FROM) return { radius: R_JUPITER, rule: kg >= BROWN_DWARF_FROM ? 'brown dwarf' : 'giant' };
  return { radius: ROCK_TOP * Math.pow(kg / ROCKY_MOST, BETWEEN), rule: 'between' };
}

/**
 * What a planet of `kg` is, as its look, until the explorer picks one: rocky up to 2 Earths, an ice giant to 50 (Uranus and Neptune are 14.5
 * and 17), a gas giant beyond.
 */
export function typeFor(kg: number): WorldKind {
  return kg <= 2 * M_EARTH ? 'terran' : kg <= 50 * M_EARTH ? 'icegiant' : 'giant';
}

/** a planet is of a look (the kinds of `WORLD_KINDS`; the copies of the Earth and Jupiter that old saves hold are planets too) */
export const isPlanetKind = (k: string): boolean => isWorldKind(k) || k === 'earth' || k === 'jupiter';

/** the unit a made body's mass is typed in: Earths for a planet or a moon, Suns for a star or a black hole */
export const massUnit = (kind: string): { name: 'Earths' | 'Suns'; kg: number } => (kind === 'sun' || kind === 'hole' ? { name: 'Suns', kg: M_SUN } : { name: 'Earths', kg: M_EARTH });

/** a number as the field shows it: four figures at most, thousands set apart ("1,000", "0.000001", "10,000,000,000") */
export function amountWords(x: number): string {
  return Number(x.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 12 });
}

/**
 * The mass a person typed for something of `kind`: in Earths for a planet or a moon, in Suns for a star or a black hole (commas, spaces and the
 * unit's name after it are allowed). The mass (kg), or a plain line saying why not. A planet is taken up to the heaviest star: past 0.08 Suns it
 * is one (the slider ends at 10,000 Earths, for quick changes).
 */
export function takeMass(text: string, kind: string): { kg: number } | { why: string } {
  const u = massUnit(kind), [lo, hi] = typedRange(kind);
  const cleaned = text.trim().replace(/,/g, '').replace(/\s*(earths?|suns?)$/i, '').trim();
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return { why: `Type a number of ${u.name}` };
  const x = Number(cleaned), kg = x * u.kg;
  if (!(x > 0) || !Number.isFinite(x) || kg < lo * (1 - 1e-12) || kg > hi * (1 + 1e-12)) return { why: rangeWords(kind) };
  return { kg };
}

/** what can be typed for a mass (kg): the slider's range, except that a planet goes up to the heaviest star */
export function typedRange(kind: string): readonly [number, number] {
  return isPlanetKind(kind) ? [PLANET_LOW, STAR_HIGH] : MADE_MASS[kind as Kind];
}

/** the range a mass may be typed in, in plain words */
export function rangeWords(kind: string): string {
  if (kind === 'sun') return 'A star is from 0.08 to 150 Suns';
  if (kind === 'hole') return 'A black hole is from 1 Sun to 10 billion Suns';
  return `From a millionth of an Earth to ${amountWords(STAR_HIGH / M_EARTH)} Earths (past 10,000 it is a brown dwarf or a star)`;
}

/** the size of a made world as an explorer may set it by hand, in Earth radii: from a thousandth to 30 */
export const SIZE_BY_HAND: readonly [number, number] = [1e-3, 30];

/** The radius (m) a person typed in Earth radii for a world made, or a plain line saying why not. */
export function takeRadius(text: string): { radius: number } | { why: string } {
  const cleaned = text.trim().replace(/,/g, '').replace(/\s*(earth radii|earth radius|radii|radius)$/i, '').trim();
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return { why: 'Type a size in Earth radii' };
  const x = Number(cleaned);
  if (!(x >= SIZE_BY_HAND[0]) || x > SIZE_BY_HAND[1]) return { why: 'From a thousandth of an Earth radius to 30' };
  return { radius: x * R_EARTH };
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
/** The size of a black hole's event horizon as its card says it: "29.5 km in radius". */
export const horizonRadiusWords = (radius: number) => `${Number((radius / 1e3).toPrecision(3)).toLocaleString('en-US')} km`;

/** What a body made as `kind` with `kg` of mass is, in words: its mass, and what it is and how big. */
export function madeWords(kind: Kind, kg: number, icy: boolean, byHand?: number): { mass: string; what: string } {
  const s = madeSize(kind, kg, icy), mass = kind === 'sun' ? starMassWords(kg) : massWords(kg);
  // (a size the explorer set by hand: said as it is, in the Earth's size, and as theirs)
  if (byHand !== undefined && (isWorldKind(kind) || kind === 'moon') && !(s.rule === 'brown dwarf' && isWorldKind(kind))) {
    const name = kind === 'moon' ? 'A moon' : (/^[aeiou]/.test(WORLD_NAME[kind as WorldKind]) ? 'An ' : 'A ') + WORLD_NAME[kind as WorldKind];
    return { mass, what: `${name}, ${times(byHand / R_EARTH)} times the Earth's size, set by you` };
  }
  if (isWorldKind(kind)) {
    // (past 13 Jupiters of mass deuterium fuses in it: whatever its look, it is a brown dwarf)
    if (s.rule === 'brown dwarf') return { mass, what: "A brown dwarf, Jupiter's size" };
    const a = WORLD_NAME[kind], name = (/^[aeiou]/.test(a) ? 'An ' : 'A ') + a;
    const size = s.rule === 'ice' ? `${km(s.radius)} in radius` : s.rule === 'giant' ? "Jupiter's size"
      : Math.abs(s.radius / R_EARTH - 1) < 0.005 ? "the Earth's size" : `${times(s.radius / R_EARTH)} times the Earth's size`;
    return { mass, what: `${name}, ${size}` };
  }
  switch (s.rule) {
    case 'horizon': return { mass, what: `A black hole, its event horizon ${horizonRadiusWords(s.radius)} in radius` };
    case 'rock': return { mass, what: `Rock, ${km(s.radius)} in radius` };
    case 'ice': return { mass, what: `Ice and rock, ${km(s.radius)} in radius` };
    case 'earth': case 'terran': return { mass, what: Math.abs(s.radius / R_EARTH - 1) < 0.005 ? "Rock, the Earth's size" : `Rock, ${times(s.radius / R_EARTH)} times the Earth's size` };
    case 'neptunian': return { mass, what: `Rock, ice and gas, ${times(s.radius / R_EARTH)} times the Earth's size` };
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
      return { label, text, math: `R = (3M / 4πρ)^⅓ = (3·${num(kg)} kg / (4π·${rho.toLocaleString('en-US')} kg/m³))^⅓ = ${text}: a ball of ${s.rule === 'ice' ? (kind === 'ice' ? 'ice and rock' : 'ice and rock (beyond the frost line)') : 'rock'}` };
    }
    case 'earth':
      return { label, text, math: `R = R⊕ (M / M⊕)^⅓ = 6,371 km·(${num(kg / M_EARTH)})^⅓ = ${text}: rock at the Earth's mean density, ${EARTH_DENSITY.toLocaleString('en-US')} kg/m³` };
    case 'terran':
      return { label, text, math: `R = R⊕ (M / M⊕)^0.279 = 6,371 km·(${num(kg / M_EARTH)})^0.279 = ${text}: rocky worlds as measured ones are (Chen & Kipping 2017: rock is squeezed smaller as the mass grows)` };
    case 'neptunian':
      return { label, text, math: `R = R₂ (M / 2.04 M⊕)^0.589 = ${km(NEPTUNIAN_BASE)}·(${num(kg / NEPTUNIAN_FROM)})^0.589 = ${text}: worlds of rock, ice and gas above 2 Earths, as measured ones are (Chen & Kipping 2017; Uranus's mass gives 3.9 times the Earth's size, it measures 4.0)` };
    case 'between':
      return { label, text, math: `R = R₁₀ (M / 10 M⊕)^${num(BETWEEN, 3)} = ${km(ROCK_TOP)}·(${num(kg / ROCKY_MOST)})^${num(BETWEEN, 3)} = ${text}: between a rock of 10 Earths and Jupiter's size at 0.3 Jupiters (a world's size here depends on how much gas it has gathered)` };
    case 'giant': case 'brown dwarf':
      return { label, text, math: `R ≈ R♃ = ${km(R_JUPITER)}: ${s.rule === 'giant' ? 'a giant planet' : 'a brown dwarf'} is about Jupiter's size whatever its mass, its insides squeezed so hard that more mass makes it no larger` };
    case 'star':
      return { label, text, math: `${mainSequence(kg / M_SUN).radius.math}: a star of the main sequence (its temperature and light follow from its mass too)` };
    case 'horizon': {
      const t = horizonRadiusWords(s.radius);
      return { label: 'Its event horizon (made by you)', text: t, math: `r = 2GM / c² = 2·6.6743×10⁻¹¹·${num(kg)} kg / (299,792,458 m/s)² = ${t}: the size inside which not even light escapes (the Schwarzschild radius)` };
    }
  }
}

/**
 * A made world described again from what a link or a save kept of it (src/app/SceneWorld.ts), as
 * newMoon and newTwin described it when it was made: `home` is what it was made for, `like` what
 * a copy is a copy of (null for a moon or a world of a generated look), `texture` the key of that one's map, `look` the
 * brightness of a world of a generated look (null for the others). Its mass and size
 * as it was made are set by whoever makes it (LivePhysics.adoptWorld): this is its look and name.
 */
export function madeAgain(m: MadeRecord, home: Body, like: Body | null, texture: string | null, look: MadeLook | null = null): BodyJson {
  if (m.kind === 'hole') return { ...newHole(home, [1, 0, 0], 0, m.id).json, name: m.name, madeAs: { kind: 'hole', kg: m.kg, icy: false } };
  if (isWorldKind(m.kind) && look) {
    const plan = newWorld(m.kind, home, [1, 0, 0], 0, m.id, m.seed ?? 0, look);
    return { ...plan.json, name: m.name, madeAs: { kind: m.kind, kg: m.kg, icy: false, seed: m.seed ?? 0, ...(m.rings ? { rings: true } : {}), ...(m.hue ? { hue: m.hue } : {}) } };
  }
  const plan = m.kind === 'moon' || !like ? newMoon(home, [1, 0, 0], m.icy ? Infinity : 0, 0, m.id) : newTwin(like, texture, home, [1, 0, 0], 0, m.id);
  return { ...plan.json, name: m.name, madeAs: { kind: m.kind, kg: m.kg, icy: m.icy } };
}
