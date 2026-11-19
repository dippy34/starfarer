/**
 * Stellar colour physics: blackbody colours and colour-index → temperature.
 */

export type RGB = [number, number, number];

/**
 * Approximate sRGB (gamma-encoded, 0–1) colour of a blackbody at T kelvin.
 * Tanner Helland's fit to Mitchell Charity's blackbody table, valid ~1000–40000 K.
 */
export function blackbodySrgb(tempK: number): RGB {
  const t = Math.max(1000, Math.min(40000, tempK)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number): number => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/**
 * Linear-light RGB colour of a blackbody, normalised so the brightest channel
 * is 1. `saturation` > 1 exaggerates the tint slightly, which reads better on
 * small point sprites (real star colours are subtle).
 */
export function blackbodyLinear(tempK: number, saturation = 1.25): RGB {
  const [r, g, b] = blackbodySrgb(tempK);
  let lr = toLinear(r);
  let lg = toLinear(g);
  let lb = toLinear(b);
  const mean = (lr + lg + lb) / 3;
  lr = Math.max(0, mean + (lr - mean) * saturation);
  lg = Math.max(0, mean + (lg - mean) * saturation);
  lb = Math.max(0, mean + (lb - mean) * saturation);
  const m = Math.max(lr, lg, lb, 1e-6);
  return [lr / m, lg / m, lb / m];
}

/** Effective temperature from Johnson B−V (Ballesteros 2012). */
export function bvToTeff(bv: number): number {
  const x = Math.max(-0.4, Math.min(2.2, bv));
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
}

/** Effective temperature from Gaia BP−RP (Mucciarelli & Bellazzini 2020, dwarf relation). */
export function bpRpToTeff(bpRp: number): number {
  const c = Math.max(-0.5, Math.min(5, bpRp));
  const theta = 0.4929 + 0.5092 * c - 0.0353 * c * c;
  return Math.max(2300, Math.min(40000, 5040 / theta));
}

/** Inverse of bpRpToTeff (used to give procedural stars a Gaia-like colour index). */
export function teffToBpRp(teff: number): number {
  const theta = 5040 / Math.max(2300, Math.min(40000, teff));
  // Solve −0.0353c² + 0.5092c + (0.4929 − θ) = 0 for the physical root.
  const disc = 0.5092 * 0.5092 + 4 * 0.0353 * (0.4929 - theta);
  return (0.5092 - Math.sqrt(Math.max(0, disc))) / (2 * 0.0353);
}

/** Approximate B−V from temperature (inverse Ballesteros, by bisection). */
export function teffToBv(teff: number): number {
  let lo = -0.4;
  let hi = 2.2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bvToTeff(mid) > teff) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Harvard spectral class letter + subclass digit for a temperature, e.g. 5772 K → "G2". */
export function spectralClass(teff: number): string {
  const bounds: Array<[string, number, number]> = [
    ['O', 30000, 52000],
    ['B', 10000, 30000],
    ['A', 7500, 10000],
    ['F', 6000, 7500],
    ['G', 5200, 6000],
    ['K', 3700, 5200],
    ['M', 2400, 3700],
    ['L', 1300, 2400],
    ['T', 500, 1300],
  ];
  for (const [letter, lo, hi] of bounds) {
    if (teff >= lo) {
      const sub = Math.max(0, Math.min(9, Math.floor(((hi - Math.min(teff, hi)) / (hi - lo)) * 10)));
      return `${letter}${sub}`;
    }
  }
  return 'Y0';
}
