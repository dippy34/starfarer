/**
 * A ship over ground that is being refined rides with it.
 *
 * The ground a ship meets is the terrain's drawn mesh under it (PlanetTerrain.groundRadius), or, where no tile
 * is there yet, a coarse height from the main thread. As tiles come in, morph in and are replaced, the ground
 * at one and the same place moves, by metres at a few hundred metres up on the Moon and by tens or hundreds of
 * metres on steep ground on the Earth, more when the ship arrives faster than the tiles (measured by the
 * test-health pass, HANDOFF.md "Ground and level of detail"). Left alone, a ground that rises into a falling ship is a
 * crash in the air and one that sinks is a longer fall: the level of detail decides the landing, not the flying.
 *
 * So a change of the ground at the ship's own place, from a tile (not from the ship having moved) is added to the
 * ship's height as well: its height above the ground and its velocity are what they were.
 */

/** only a ship this low over the ground rides with it (m): above, the ground is a distance and not a floor */
export const RIDE_ALTITUDE = 3000;
/** the most one frame's refinement may move the ship (m): a bound against a broken tile, not a limit of the terrain */
export const RIDE_MOST = 1000;

/**
 * How far the ship is moved along the vertical (m, positive away from the world's centre) for `refined`, the
 * change of the ground at its own place since it was last looked at (m, positive: the ground rose), the ship
 * being `altitude` metres over the ground as it was (m) and `landed` or not (a landed ship follows the ground as
 * it is, World.place). Zero for anything it should not ride: a number that is not one, a ship landed, high
 * over the ground (and far under it).
 */
export function rideShift(refined: number, altitude: number, landed: boolean): number {
  if (landed || !Number.isFinite(refined) || !Number.isFinite(altitude)) return 0;
  if (altitude > RIDE_ALTITUDE || altitude < -RIDE_ALTITUDE) return 0;
  if (refined === 0) return 0;
  return Math.max(-RIDE_MOST, Math.min(RIDE_MOST, refined));
}
