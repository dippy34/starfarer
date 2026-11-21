import { Vector3 } from 'three';
import { SUN_RADIUS } from '../core/units';

/**
 * The stars whose shape has been measured. A handful of near, bright, fast-spinning stars have
 * been resolved by optical interferometers (the CHARA array, the VLTI): each is wider across its
 * equator than from pole to pole, and the fit of a rotating star to the measurements gives its
 * two radii and how its axis lies to us. Per star: polar and equatorial radius (solar radii), the
 * inclination of the axis to the line of sight (degrees: 0 is pole-on) and the position angle of
 * the pole on the sky (degrees east of north), from
 *
 *   Altair      Monnier et al. 2007 (Science 317, 342), table 1, gravity darkening fitted
 *   Vega        Monnier et al. 2012 (ApJ 761, L3), table 2, their "concordance" model
 *   Regulus     Che et al. 2011 (ApJ 732, 68), table 4, gravity darkening fitted
 *   Caph        the same paper, table 3, likewise
 *   Alderamin   Zhao et al. 2009 (ApJ 701, 209), table 3, gravity darkening fitted
 *   Rasalhague  the same paper, table 4, its standard model (the only one its data settle)
 *   Achernar    Domiciano de Souza et al. 2014 (A&A 569, A10): the equatorial radius, its ratio
 *               to the polar one (1.35) and the pole's angles, as Kervella et al. 2022
 *               (arXiv:2209.07537) quote them
 *
 * Which of its two poles a star turns to us, and which way round it spins, the fits mostly leave
 * open: nothing drawn here tells the two apart.
 *
 * No other star is drawn flattened: how fast a star spins and where its axis points is in none
 * of the catalogues the app has. (Sirius, for one, turns slowly and is round.)
 */
const MEASURED = new Map<string, [rPol: number, rEq: number, incl: number, pa: number, source: string]>([
  ['Altair', [1.634, 2.029, 57.2, -61.8, 'Monnier et al. 2007']],
  ['Vega', [2.418, 2.726, 6.2, -58, 'Monnier et al. 2012']],
  ['Regulus', [3.22, 4.21, 86.3, 258, 'Che et al. 2011']],
  ['Caph', [3.06, 3.79, 19.9, -7.09, 'Che et al. 2011']],
  ['Alderamin', [2.162, 2.74, 55.7, -178.84, 'Zhao et al. 2009']],
  ['Rasalhague', [2.39, 2.871, 87.7, -53.88, 'Zhao et al. 2009']],
  ['Achernar', [9.16 / 1.35, 9.16, 60.6, 216.9, 'Domiciano de Souza et al. 2014']],
]);

export interface StarShape {
  /** polar and equatorial radius (m) */
  rPol: number;
  rEq: number;
  /** its axis to the line of sight from the Sun (rad: 0 is pole-on), and the pole's position angle on the sky (rad east of north) */
  incl: number;
  pa: number;
  /** who measured it */
  source: string;
}

/** The measured shape of the star that goes by one of these names, if it has one. */
export function starShape(names: readonly string[]): StarShape | null {
  for (const n of names) {
    const m = MEASURED.get(n);
    if (!m) continue;
    const deg = Math.PI / 180;
    return { rPol: m[0] * SUN_RADIUS, rEq: m[1] * SUN_RADIUS, incl: m[2] * deg, pa: m[3] * deg, source: m[4] };
  }
  return null;
}

/** How much shorter the star is from pole to pole than across its equator (0: a sphere). */
export function shapeFlattening(shape: StarShape): number {
  return 1 - shape.rPol / shape.rEq;
}

/**
 * The star's axis in space (unit; ICRF, as the catalogue's positions are): the pole turned
 * towards the Sun, from its inclination to the line of sight and its position angle on the sky.
 * `fromSun`: where the star is from the Sun (any length).
 */
export function shapeAxis(shape: StarShape, fromSun: Vector3, out = new Vector3()): Vector3 {
  const d = new Vector3().copy(fromSun).normalize();
  // north and east on the sky where the star is: towards the celestial pole, and towards growing right ascension
  const pole = new Vector3(0, 0, 1);
  const east = new Vector3().crossVectors(pole, d).normalize();
  const north = new Vector3().crossVectors(d, east);
  const across = Math.sin(shape.incl);
  return out.copy(d).multiplyScalar(-Math.cos(shape.incl))
    .addScaledVector(north, across * Math.cos(shape.pa))
    .addScaledVector(east, across * Math.sin(shape.pa))
    .normalize();
}
