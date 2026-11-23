import { keplerDrift } from './KeplerDrift';
import { FLUID_ROCHE } from './physics';

/**
 * Tides that tear a world apart: the Roche limit, and how long a world must stay inside it to come
 * apart. Plain arithmetic, used by the simulation (src/sim/NBody.ts) to tell when a world comes
 * apart, and by the app to warn of it (src/app/LivePhysics.ts, src/app/App.ts).
 *
 * Inside the Roche limit of a heavier body, the difference of that body's pull across a world is
 * more than the world's own gravity holds it together with. For a world held together by its
 * gravity alone, which then takes the shape the pulls on it give it, as a liquid would, the limit is
 * the fluid one (src/sim/physics.ts: FLUID_ROCHE, Chandrasekhar 1969 as Leinhardt et al. 2012 give it),
 *     d = 2.46 R_M (ρ_M / ρ_m)^⅓ = 2.46 R_m (M / m)^⅓
 * (R_M and ρ_M the heavier body's radius and density, R_m, ρ_m and m the world's; the second form
 * needs no density of the heavier body: a star, or a black hole, has a limit too). A rigid ball,
 * keeping its shape, would hold together further in, to 1.26 R_m (M / m)^⅓, where the difference of
 * the pull across it, 2GM R_m / d³, is its own gravity at its surface, Gm / R_m², worked out: d = R_m
 * (2M / m)^⅓. Rubble piles in between: Leinhardt, Ogilvie, Latter & Kokubo (2012, MNRAS 424, 1419)
 * found their simulated ones held together to about 2.2. Which limit a world obeys is the app's to say
 * (LivePhysics: `frailty`): the fluid one, for a world gravity has made round.
 *
 * Coming apart takes time. A world that crosses the limit and hits, or leaves it again, before its
 * pieces can drift apart is not torn apart by the crossing: Mars falling onto the Earth from far off
 * crosses the Earth's limit for Mars (17,500 km out) and hits 16 minutes later. How long is enough is taken to
 * be the time a pebble would take to circle the world at its surface, 2π √(R³ / Gm), the time its
 * own gravity takes to pull anything back into place (Mars: 1.7 hours; the Moon: 1.8): a
 * simplification of this app's, said where it shows (LivePhysics' ALSO_LEFT_OUT).
 */

export { FLUID_ROCHE };
/** the limit of a rigid ball held by its gravity alone (no strength): d = R_m (2 M / m)^⅓, worked out above */
export const RIGID_ROCHE = Math.cbrt(2);

/**
 * The distance (m, between centres) inside which the tides of a body of G times its mass `gmBig`
 * tear apart a world of radius `radius` (m) and G times its mass `gm` (m³/s²): coef R (M / m)^⅓.
 * 0 if they never do: no coefficient (a world that is not torn apart), a world of no known mass, or
 * one at least as heavy as the other.
 */
export function tidalLimit(coef: number, radius: number, gm: number, gmBig: number): number {
  return coef > 0 && gm > 0 && radius > 0 && gmBig > gm ? coef * radius * Math.cbrt(gmBig / gm) : 0;
}

/** The time (s) a pebble takes to circle a world of radius `radius` (m) and G times its mass `gm` at its surface: 2π √(R³ / Gm). */
export function selfTime(radius: number, gm: number): number {
  return 2 * Math.PI * Math.sqrt((radius * radius * radius) / gm);
}

/** the path ahead is looked at in this many steps of the time it must stay */
const LOOKS = 48;
const r = new Float64Array(3), v = new Float64Array(3);

/**
 * Does a world inside a tidal limit stay inside it, on its two-body orbit about the other body,
 * for `time` seconds (without leaving the limit or touching)? `pos` and `vel` are its place and
 * motion from the other body (m, m/s), `mu` G times both masses, `limit` the tidal limit and
 * `touch` their radii added (m). False if it is not inside now.
 */
export function staysInside(pos: ArrayLike<number>, vel: ArrayLike<number>, mu: number, limit: number, touch: number, time: number): boolean {
  for (let c = 0; c < 3; c++) { r[c] = pos[c]; v[c] = vel[c]; }
  const d0 = Math.hypot(r[0], r[1], r[2]);
  if (!(d0 < limit) || !(d0 > touch) || !(time >= 0)) return false;
  for (let k = 1; k <= LOOKS; k++) {
    keplerDrift(r, v, 0, mu, time / LOOKS);
    const d = Math.hypot(r[0], r[1], r[2]);
    if (!(d < limit) || !(d > touch)) return false;
  }
  return true;
}
