import { Vector3 } from 'three';
import { mirrored } from './shipGeometry';

/**
 * The canopy's frame round the pilot's eye (rig-local metres, looking down -z), as lines: pure
 * data, for the cockpit to build and for the tests to measure. Placed so that space fills the
 * view: the windscreen's pillars far out (55 degrees off the middle all the way up: a phone held
 * sideways sees them at its edges, an upright one not at all), the bow over the
 * windscreen 28 degrees up (an upright phone sees it as a thin line just under its instruments),
 * the spine starting high overhead (no rod rising into the interface), the sill 34 degrees down.
 */
export interface MemberSpec {
  /** the member's centre line through these points (smoothed) */
  pts: Vector3[];
  /** half its width as the eye sees it, half its depth (m) */
  half: number;
  depth: number;
  /** the canopy's sill (a heavier rail) rather than a frame member */
  sill?: boolean;
  /** samples between points of the line */
  per?: number;
}

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export function canopyFrame(): MemberSpec[] {
  const m: MemberSpec[] = [];
  // the canopy's lower edge, round from behind on the left to behind on the right
  m.push({ pts: mirrored([V(-0.86, -0.42, 0.34), V(-0.88, -0.47, 0.0), V(-0.78, -0.52, -0.36), V(-0.52, -0.555, -0.66), V(0, -0.57, -0.84)]), half: 0.026, depth: 0.03, sill: true });
  // windscreen pillars, 55 degrees out to the sides from the sill to the top (a phone held sideways
  // sees them at its edges, a desk's wide view just past them)
  for (const s of [-1, 1]) m.push({ pts: [V(s * 0.7, -0.535, -0.49), V(s * 0.62, 0.36, -0.44)], half: 0.009, depth: 0.014, per: 10 });
  // the bow over the windscreen
  m.push({ pts: [V(-0.62, 0.36, -0.44), V(-0.36, 0.41, -0.64), V(0, 0.425, -0.74), V(0.36, 0.41, -0.64), V(0.62, 0.36, -0.44)], half: 0.009, depth: 0.012 });
  // the spine back over the head (starting high overhead), the rear bow
  m.push({ pts: [V(0, 0.72, -0.44), V(0, 0.79, -0.1), V(0, 0.8, 0.3)], half: 0.012, depth: 0.02 });
  m.push({ pts: mirrored([V(-0.86, -0.42, 0.34), V(-0.82, 0.1, 0.33), V(-0.56, 0.56, 0.31), V(0, 0.8, 0.3)]), half: 0.014, depth: 0.022 });
  // the upper rails: from the pillars' tops back along the canopy to the rear bow
  for (const s of [-1, 1]) m.push({ pts: [V(s * 0.62, 0.36, -0.44), V(s * 0.68, 0.46, -0.2), V(s * 0.66, 0.5, 0.05), V(s * 0.6, 0.53, 0.31)], half: 0.012, depth: 0.02 });
  return m;
}

/** An arc round the eye's vertical (rig-local): radius, height, from and to (degrees off the middle), segments. */
export function arc(r: number, y: number, a0: number, a1: number, n: number): Vector3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * (Math.PI / 180);
    return V(Math.sin(a) * r, y, -Math.cos(a) * r);
  });
}
