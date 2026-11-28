import { Comet } from '../render/SmallBodies';
import { BlackHole } from '../universe/BlackHoles';
import { Body, type SpaceObject } from '../universe/Body';
import { DeepSkyObject } from '../universe/DeepSky';
import { Galaxy } from '../universe/Galaxies';
import { Landmark } from '../universe/Landmarks';
import { MilkyWay } from '../universe/MilkyWay';
import { ExoPlanet, type PlanetarySystem, type PlanetSpec } from '../universe/Planets';
import { SimBody } from '../universe/PlanetarySim';
import { RingSpot } from '../universe/RingSpot';
import { Spacecraft } from '../universe/Spacecraft';
import { CatalogStar } from '../universe/Stars';
import { canAdd, MADE_MOST } from './WhatIf';

/** The five powers on every opened object card, in their shown order. */
export const POWER_NAMES = ['mass', 'size', 'move', 'add', 'remove'] as const;
export type PowerName = (typeof POWER_NAMES)[number];

/** A power either works exactly as it does today, or says plainly why it cannot. */
export type PowerStatus = { readonly works: true } | { readonly works: false; readonly reason: string };
export type PowerTable = Readonly<Record<PowerName, PowerStatus>>;

const WORKS: PowerStatus = { works: true };
const no = (reason: string): PowerStatus => ({ works: false, reason });
const table = (mass: PowerStatus, size: PowerStatus, move: PowerStatus, add: PowerStatus, remove: PowerStatus): PowerTable => ({ mass, size, move, add, remove });
const none = (reason: string): PowerTable => table(no(reason), no(reason), no(reason), no(reason), no(reason));

const ONE_AT_A_TIME = 'Live physics is on in another system: one at a time';
const UNDO_ELSEWHERE = 'Undo is still offered in another system, for a few seconds';
const ORBITS_DISAGREE = "Its star's mass and its planets' orbits disagree in our data";
const NO_PLANETS = 'Live physics runs round stars with planets, so far';
const HOLE = 'Live physics does not take black holes yet';
const DEEP = 'A galaxy or nebula cannot join live physics yet';
const STAR_UNWEIGHED = 'No measured mass for its star in our data';
const SIZE_ESTIMATED = 'Its size is estimated, not measured';
const SIZE_GENERATED = 'Its size is generated, not measured';
const SIZE_UNSEEN = 'Only a transit measures a size; it was found otherwise';
const ADD_SUN = 'Add works only round the Sun, so far';
const GONE = 'It has been taken away: Undo brings it back';
const NO_MASS = 'No measured mass for this world in our data';
const STAR_MASS = 'No measured mass for this star in our data';
const STAR_SIZE = "A star's size is not changed separately here";
const SIZE_DATA = 'Size needs a measured mass and size in our data';
const ADD_KIND = 'Add works on planets, dwarf planets and stars only';
const ADD_FULL = `The limit of ${MADE_MOST} made worlds has been reached`;
const INVALID = 'Its position is not known at this date';
const SMALL = 'Belt asteroids stay on their recorded paths, so far';
const COMET_MASS = 'No measured mass for comets in our data';
const COMET_SIZE = "A comet's size is not changed here";
const CRAFT = 'Spacecraft follow their own paths, not the live simulation';
const PLACE = 'A place is a viewpoint, not an object that can be changed';
const DEEP_MASS = 'No measured mass for galaxies and nebulae in our data';
const UNKNOWN = 'This kind cannot join the live simulation yet';
const HOLE_SIZE = 'Its size is its event horizon: set by its mass';
const HOLE_ADD = 'Nothing is added to a black hole';
const HOLE_SET = "A black hole's size is set by its mass";

/**
 * Where an object is, as far as its powers go: for a star, its planetary system (null: it has
 * none; left out: not known, taken as none), and where live physics runs now (the Solar System, one
 * other star's planetary system, or nowhere: left out, nowhere). Live physics runs in one system at
 * a time (src/app/App.ts). `undo`: the system in `live` is not running, but Back to reality was just
 * used there and its Undo is still offered: it keeps the turn until then.
 */
export interface PowerPlace {
  readonly system?: PlanetarySystem | null;
  readonly live?: 'solar' | PlanetarySystem | null;
  readonly undo?: boolean;
}

/**
 * The one capability table behind both the app's powers and the card's buttons.
 * `made` is the number of made worlds already taking the app's fixed body slots.
 */
export function powersFor(obj: SpaceObject, made = 0, where: PowerPlace = {}): PowerTable {
  // (a body of another star's system, as live physics has it, has the powers of what it stands for)
  if (obj instanceof SimBody) return planetary(obj.system, obj.shows instanceof ExoPlanet ? obj.shows : null, where);
  if (obj instanceof Body) {
    if (where.live && where.live !== 'solar') return none(where.undo ? UNDO_ELSEWHERE : ONE_AT_A_TIME);
    if (!obj.valid) return none(INVALID);
    const weighed = obj.gm > 0;
    // (a black hole of your own: pulled and pulling like any world; its size is set by its mass, and nothing is added to it)
    if ((obj.meta.madeAs as { kind?: string } | undefined)?.kind === 'hole') return table(WORKS, no(HOLE_SIZE), WORKS, no(HOLE_ADD), WORKS);
    const size = obj.kind !== 'star' && weighed && obj.radius > 0 && !obj.radiusEstimated;
    const addReason = made >= MADE_MOST ? ADD_FULL : !weighed ? NO_MASS : ADD_KIND;
    return table(
      weighed ? WORKS : no(NO_MASS),
      size ? WORKS : no(obj.kind === 'star' ? STAR_SIZE : SIZE_DATA),
      WORKS,
      canAdd(obj, made).length ? WORKS : no(addReason),
      WORKS,
    );
  }
  if (obj instanceof ExoPlanet) return planetary(obj.system, obj, where);
  // (a black hole of the catalogue: its mass changes the hole itself, its horizon and its shadow with it; nothing round it is simulated)
  if (obj instanceof BlackHole) return table(WORKS, no(HOLE_SET), no(HOLE), no(HOLE), no(HOLE));
  if (obj instanceof CatalogStar) {
    if (where.system) return planetary(where.system, null, where);
    return table(no(STAR_MASS), no(NO_PLANETS), no(NO_PLANETS), no(NO_PLANETS), no(NO_PLANETS));
  }
  if (obj instanceof Comet) return comet(obj, where);
  if (obj.kind === 'asteroid' || obj.kind === 'comet') return none(SMALL);
  if (obj instanceof Galaxy || obj instanceof MilkyWay || obj instanceof DeepSkyObject) {
    return table(no(DEEP_MASS), no(DEEP), no(DEEP), no(DEEP), no(DEEP));
  }
  if (obj instanceof Spacecraft || obj.kind === 'spacecraft' || obj.kind === 'ship' || obj.kind === 'station') return none(CRAFT);
  if (obj instanceof Landmark || obj instanceof RingSpot || obj.kind === 'place') return none(PLACE);
  return none(UNKNOWN);
}

/**
 * The powers over a comet: Remove, which hides it, and Move, which moves or throws it, the simulation
 * carrying it from there with no mass (live physics starts, as for any change); its mass and size are
 * not in the data and a comet pulls nothing, so Mass, Size and Add stay off.
 * Not while live physics runs in another star's system (one at a time).
 */
function comet(_c: Comet, where: PowerPlace): PowerTable {
  if (where.live && where.live !== 'solar') return none(where.undo ? UNDO_ELSEWHERE : ONE_AT_A_TIME);
  return table(no(COMET_MASS), no(COMET_SIZE), WORKS, no(ADD_KIND), WORKS);
}

/**
 * The powers in another star's planetary system (src/universe/PlanetarySim.ts), on one of its
 * planets or (`planet` null) on its star: Mass, Move (and Throw) and Remove; Size only for a planet
 * whose size was measured; Add not yet. None while live physics runs in another system, nor in a
 * system whose star's mass is not known at all.
 */
function planetary(system: PlanetarySystem, planet: ExoPlanet | null, where: PowerPlace): PowerTable {
  if (where.live && where.live !== system) return none(where.undo ? UNDO_ELSEWHERE : ONE_AT_A_TIME);
  if (system.hostMass.from === 'unknown') return none(STAR_UNWEIGHED);
  if (system.hostMass.from === 'disagree') return none(ORBITS_DISAGREE);
  if (system.live?.gone(planet ?? system.host)) return none(GONE);
  if (!planet) return table(WORKS, no(STAR_SIZE), WORKS, no(ADD_SUN), WORKS);
  return table(WORKS, sizeOf(planet.spec), WORKS, no(ADD_SUN), WORKS);
}

/**
 * Size works on a planet whose size was measured: one found crossing its star (a transit, the one
 * way a planet's size is measured), and not marked estimated. The archive's table also gives a size
 * for planets found otherwise (by the wobble of their star, mostly), worked out from their mass by a
 * rule (Chen & Kipping 2017), which the app does not take for a measurement.
 */
export function sizeOf(s: PlanetSpec): PowerStatus {
  if (!s.real) return no(SIZE_GENERATED);
  if (s.est.includes('radius')) return no(SIZE_ESTIMATED);
  return s.method === 'Transit' ? WORKS : no(SIZE_UNSEEN);
}
