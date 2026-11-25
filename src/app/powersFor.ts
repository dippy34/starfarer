import { Comet } from '../render/SmallBodies';
import { BlackHole } from '../universe/BlackHoles';
import { Body, type SpaceObject } from '../universe/Body';
import { DeepSkyObject } from '../universe/DeepSky';
import { Galaxy } from '../universe/Galaxies';
import { Landmark } from '../universe/Landmarks';
import { MilkyWay } from '../universe/MilkyWay';
import { ExoPlanet } from '../universe/Planets';
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

const LIVE = 'Live physics runs in our Solar System only, so far';
const NO_MASS = 'No measured mass for this world in our data';
const STAR_MASS = 'No measured mass for this star in our data';
const STAR_SIZE = "A star's size is not changed separately here";
const SIZE_DATA = 'Size needs a measured mass and size in our data';
const ADD_KIND = 'Add works on planets, dwarf planets and stars only';
const ADD_FULL = `The limit of ${MADE_MOST} made worlds has been reached`;
const INVALID = 'Its position is not known at this date';
const SMALL = 'Comets and belt asteroids stay on their recorded paths';
const CRAFT = 'Spacecraft follow their own paths, not the live simulation';
const PLACE = 'A place is a viewpoint, not an object that can be changed';
const DEEP_MASS = 'No measured mass for galaxies and nebulae in our data';
const UNKNOWN = 'This kind cannot join the live simulation yet';

/**
 * The one capability table behind both the app's powers and the card's buttons.
 * `made` is the number of made worlds already taking the app's fixed body slots.
 */
export function powersFor(obj: SpaceObject, made = 0): PowerTable {
  if (obj instanceof Body) {
    if (!obj.valid) return none(INVALID);
    const weighed = obj.gm > 0;
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
  if (obj instanceof ExoPlanet || obj instanceof BlackHole) return none(LIVE);
  if (obj instanceof CatalogStar) return table(no(STAR_MASS), no(LIVE), no(LIVE), no(LIVE), no(LIVE));
  if (obj instanceof Comet || obj.kind === 'asteroid' || obj.kind === 'comet') return none(SMALL);
  if (obj instanceof Galaxy || obj instanceof MilkyWay || obj instanceof DeepSkyObject) {
    return table(no(DEEP_MASS), no(LIVE), no(LIVE), no(LIVE), no(LIVE));
  }
  if (obj instanceof Spacecraft || obj.kind === 'spacecraft' || obj.kind === 'ship' || obj.kind === 'station') return none(CRAFT);
  if (obj instanceof Landmark || obj instanceof RingSpot || obj.kind === 'place') return none(PLACE);
  return none(UNKNOWN);
}
