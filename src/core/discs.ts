/**
 * Discs over discs: what eclipses, and anything hidden behind something round, come down to.
 */

/** Area of overlap of two discs of radii r1, r2 whose centres are d apart (as in the body shader). */
export function discOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const a2 = Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  const k = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2);
  return r1 * r1 * a1 + r2 * r2 * a2 - 0.5 * Math.sqrt(Math.max(k, 0));
}

/** The share (0..1) of a disc of radius r1 that a disc of radius r2 covers, their centres d apart. */
export function discCovered(r1: number, r2: number, d: number): number {
  return r1 > 0 ? Math.min(1, discOverlap(r1, r2, d) / (Math.PI * r1 * r1)) : d < r2 ? 1 : 0;
}

/**
 * How much of a body's sunlit face another body's shadow takes (0..1): the share of its disc, as the
 * Sun sees it, that the other's covers, times how much of the Sun the other can hide from there.
 * `radius`, `occluder`: their radii; `apart`: between their centres across the Sun's direction;
 * `behind`: how far the body is behind the occluder along it; `sunAngle`: the Sun's angular radius there.
 *
 * A moon's shadow on its planet is a dot, even while it crosses the very middle of the disc; a
 * planet's on its moon is all of the moon. (Measured at the body's centre alone, Io crossing in
 * front of Jupiter read as Jupiter gone dark.)
 */
export function shadowShare(radius: number, occluder: number, apart: number, behind: number, sunAngle: number): number {
  if (!(behind > 0)) return 0;
  const depth = Math.min(1, (occluder / behind / sunAngle) ** 2);
  return depth * discCovered(radius, occluder, apart);
}
