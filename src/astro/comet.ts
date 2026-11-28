import { Vector3 } from 'three';
import { eclToEqu } from '../core/frames';
import { AU, GM_SUN } from '../core/units';
import { keplerState, type OrbitalElements } from './kepler';

/** A catalogued comet's row (src/render/SmallBodies.ts): name, type, e, q (AU), i, node, peri, tp, M1, K1, nucleus (km), number. */
export type CometRow = [string, string, number, number, number, number, number, number, number | null, number | null, number | null, number];

/** The orbit a comet's row gives (JPL SBDB elements, round the Sun). */
export function cometElements(r: CometRow): OrbitalElements {
  return { q: r[3] * AU, e: r[2], i: r[4], node: r[5], peri: r[6], tp: r[7], mu: GM_SUN };
}

/**
 * Where the comet's own orbit has it at `jd` (TDB), and how fast it goes: m and m/s from the Sun,
 * in the ICRF's axes. The one place this is worked out: the worker that moves every comet
 * (src/workers/comets.worker.ts) and the stand-in a moved comet gets (src/app/CometBody.ts) use it.
 */
export function cometState(el: OrbitalElements, jd: number, pos: Vector3, vel: Vector3): void {
  keplerState(el, jd, pos, vel);
  eclToEqu(pos);
  eclToEqu(vel);
}
