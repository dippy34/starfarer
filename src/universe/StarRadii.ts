import { SUN_ABS_MAG, SUN_RADIUS, SUN_TEFF } from '../core/units';

/**
 * A star's radius from its brightness and temperature, and the measured radii of the stars that
 * have one.
 *
 * The catalogues give a star's brightness in the visual band (V) only. Its radius follows from
 * its whole output (L = 4 pi R^2 sigma T^4), which a cool or a hot star puts largely outside that
 * band: the visual magnitude is brought to the bolometric one by a bolometric correction,
 * BC_V(Teff), here the polynomial in log Teff of Flower (1996, ApJ 469, 355) with the coefficients
 * as corrected by Torres (2010, AJ 140, 1158, table 1). Without it a red dwarf came out several
 * times too small (Proxima Centauri 0.022 solar radii where it is measured at 0.145) and a red
 * supergiant half its size. Below about 3,300 K the polynomial turns down steeply (-5 magnitudes
 * at 3,000 K, -11 at 2,500 K), far beyond what the coolest dwarfs measured show (Proxima: about
 * -3.8 at 3,042 K, from its measured luminosity): cooler stars take the correction at 3,300 K, so
 * their radii err small rather than wildly large.
 */
const BC_COOL = [-0.190537291496456e5, 0.155144866764412e5, -0.421278819301717e4, 0.381476328422343e3];
const BC_MID = [-0.370510203809015e5, 0.385672629965804e5, -0.150651486316025e5, 0.261724637119416e4, -0.170623810323864e3];
const BC_HOT = [-0.118115450538963e6, 0.137145973583929e6, -0.636233812100225e5, 0.147412923562646e5, -0.170587278406872e4, 0.788731721804990e2];
/** the range of temperature (K) over which the correction is taken as fitted */
const BC_TEFF_MIN = 3300, BC_TEFF_MAX = 50000;

/** The bolometric correction in V (magnitudes) at an effective temperature (K): Torres 2010. */
export function bolometricCorrection(teff: number): number {
  const x = Math.log10(Math.min(BC_TEFF_MAX, Math.max(BC_TEFF_MIN, teff)));
  const c = x < 3.7 ? BC_COOL : x < 3.9 ? BC_MID : BC_HOT;
  let bc = 0;
  for (let i = c.length - 1; i >= 0; i--) bc = bc * x + c[i];
  return bc;
}

/** the Sun's bolometric absolute magnitude on the same scale (so the Sun comes out at its own radius) */
const SUN_MBOL = SUN_ABS_MAG + bolometricCorrection(SUN_TEFF);

/** Radius (m) from the visual absolute magnitude and the effective temperature (K). */
export function estimateStarRadius(absMag: number, teff: number): number {
  const mbol = absMag + bolometricCorrection(teff);
  return SUN_RADIUS * (SUN_TEFF / teff) ** 2 * Math.pow(10, -0.2 * (mbol - SUN_MBOL));
}

/** The visual absolute magnitude of a star of radius `rSun` (solar radii) and temperature `teff` (K): the inverse of the above. */
export function absMagForRadius(rSun: number, teff: number): number {
  return SUN_MBOL - 5 * Math.log10(rSun * (teff / SUN_TEFF) ** 2) - bolometricCorrection(teff);
}

/**
 * Radii measured directly (interferometry: the angular diameter, with the distance), and the one
 * temperature measured with it that the catalogue's colour gets wrong. Per star: radius (solar
 * radii), temperature (K, or null to keep the catalogue's) and the source.
 *
 *   Proxima Centauri  Ségransan et al. 2003 (A&A 397, L5): 0.145 ± 0.011 R☉, 3,042 ± 117 K (VLTI).
 *                     (Its catalogue temperature, 3,383 K, comes from its colour, which saturates
 *                     for the coolest dwarfs.)
 *   Rigil Kentaurus   Kervella et al. 2017 (A&A 597, A137): 1.2234 ± 0.0053 R☉ (VLTI)
 *   Toliman           the same paper: 0.8632 ± 0.0037 R☉
 *   Sirius            Kervella et al. 2003 (A&A 408, 681): 1.711 ± 0.013 R☉ (VLTI)
 *   Arcturus          Ramírez & Allende Prieto 2011 (ApJ 743, 135): 25.4 ± 0.2 R☉
 *   Aldebaran         Richichi & Roccatagliata 2005 (A&A 433, 305): 44.2 ± 0.9 R☉
 *   Betelgeuse        Joyce et al. 2020 (ApJ 902, 63): 764 (+116, -62) R☉, at their distance of
 *                     168 pc (the app's catalogue has it at 153 pc)
 *
 * The stars whose flattened shape has been measured have their two radii in StarShapes.ts.
 */
const MEASURED = new Map<string, [rSun: number, teff: number | null, source: string]>([
  ['Proxima Centauri', [0.145, 3042, 'Ségransan et al. 2003']],
  ['Rigil Kentaurus', [1.2234, null, 'Kervella et al. 2017']],
  ['Toliman', [0.8632, null, 'Kervella et al. 2017']],
  ['Sirius', [1.711, null, 'Kervella et al. 2003']],
  ['Arcturus', [25.4, null, 'Ramírez & Allende Prieto 2011']],
  ['Aldebaran', [44.2, null, 'Richichi & Roccatagliata 2005']],
  ['Betelgeuse', [764, null, 'Joyce et al. 2020']],
]);

export interface MeasuredStar {
  /** radius (m) */
  radius: number;
  /** effective temperature (K), where measured with it */
  teff: number | null;
  source: string;
}

/** The measured radius of the star that goes by one of these names, if it has one. */
export function measuredStar(names: readonly string[]): MeasuredStar | null {
  for (const n of names) {
    const m = MEASURED.get(n);
    if (m) return { radius: m[0] * SUN_RADIUS, teff: m[1], source: m[2] };
  }
  return null;
}
