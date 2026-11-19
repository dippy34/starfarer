/**
 * Stellar physics: turn the two numbers every star has — absolute magnitude
 * and temperature (colour) — into a physically consistent set of properties.
 * Real catalogue stars and procedural stars go through the same function, so
 * a real star's derived values (radius, luminosity, mass) are standard
 * astrophysical estimates from its measured brightness and colour.
 */
import { blackbodyLinear, bpRpToTeff, spectralClass } from '../core/color';
import { dexp, dlog, dlog10, dpow } from '../core/dmath';
import { Rng } from '../core/rng';
import { C, DAY, G, L_SUN, M_JUP, M_SUN, R_JUP, R_SUN, T_SUN } from '../core/units';
import type { StarProps, StarType } from './types';

/** Main-sequence locus: absolute G magnitude → effective temperature (K). */
const MS_TABLE: Array<[number, number]> = [
  [-6, 38000], [-4, 25000], [-1.5, 15000], [0.5, 9700], [1.9, 8200], [2.7, 7200], [3.6, 6500], [4.4, 6000], [4.67, 5772],
  [5.6, 5300], [6.5, 4800], [7.6, 4200], [8.8, 3800], [10, 3500], [11.5, 3200], [13, 3000], [15, 2700], [16.5, 2400], [19, 1800],
];

export function mainSequenceTeff(absMag: number): number {
  if (absMag <= MS_TABLE[0]![0]) return MS_TABLE[0]![1];
  for (let i = 1; i < MS_TABLE.length; i++) {
    const [m1, t1] = MS_TABLE[i]!;
    if (absMag <= m1) {
      const [m0, t0] = MS_TABLE[i - 1]!;
      return t0 + ((t1 - t0) * (absMag - m0)) / (m1 - m0);
    }
  }
  return MS_TABLE[MS_TABLE.length - 1]![1];
}

/** Bolometric correction as a function of temperature (Reed 1998 fit to Flower 1996). */
export function bolometricCorrection(teff: number): number {
  const x = dlog10(Math.max(2300, Math.min(60000, teff))) - 4;
  return -8.499 * x * x * x * x + 13.421 * x * x * x - 8.131 * x * x - 3.901 * x - 0.438;
}

/** Classify a catalogue star from its position in the colour–magnitude diagram. */
export function classifyByPhotometry(absMag: number, bpRp: number | null, whiteDwarfFlag: boolean): StarType {
  const c = bpRp ?? 0.8;
  if (whiteDwarfFlag || (absMag > 8 + 4 * Math.max(c, -0.5) && c < 2)) return 'whitedwarf';
  if (absMag < -3.5) return 'supergiant';
  if ((c > 0.85 && absMag < 3) || (c > 0.5 && absMag < -1)) return 'giant';
  if (c > 0.8 && absMag < 4 && bpRp !== null) return 'subgiant';
  if (absMag > 17.5) return 'browndwarf';
  return 'main';
}

/** Temperature for a catalogue star: from its colour if measured, else from the main sequence. */
export function teffFromPhotometry(absMag: number, bpRp: number | null): number {
  return bpRp === null ? mainSequenceTeff(absMag) : bpRpToTeff(bpRp);
}

/** Main-sequence mass (solar) from luminosity (solar), piecewise mass–luminosity relation. */
function massFromLuminosity(l: number): number {
  if (l < 0.033) return dpow(l / 0.23, 1 / 2.3);
  if (l < 16) return dpow(l, 0.25);
  if (l < 1.7e5) return dpow(l / 1.4, 1 / 3.5);
  return l / 32000;
}

const LUM_CLASS: Record<StarType, string> = { main: 'V', subgiant: 'IV', giant: 'III', supergiant: 'I', whitedwarf: '', neutron: '', pulsar: '', blackhole: '', browndwarf: '' };

/**
 * Derive full stellar properties.
 * @param estimated true when absMag/teff come from a catalogue (derived values are then labelled as estimates)
 */
export function makeStar(absMag: number, teff: number, type: StarType, seed: number, estimated = false): StarProps {
  const rng = new Rng(seed ^ 0x51a7);
  const base = { magneticField: 0, schwarzschildRadius: 0, accretion: 0, estimated };

  if (type === 'blackhole') {
    const massSun = dexp(rng.range(dlog(4), dlog(45)));
    const mass = massSun * M_SUN;
    const rs = (2 * G * mass) / (C * C);
    const accretion = rng.chance(0.55) ? rng.range(0.3, 1) : rng.range(0.02, 0.2);
    return { ...base, type, spectral: 'Black hole', teff: 0, mass, radius: rs, luminosity: accretion * 1e3 * L_SUN, absMag, color: [1, 0.72, 0.45], ageGyr: rng.range(0.01, 10), rotationPeriod: 0.01, schwarzschildRadius: rs, accretion };
  }
  if (type === 'neutron' || type === 'pulsar') {
    const mass = rng.range(1.15, 2.1) * M_SUN;
    // Pulsar spin: mostly 0.1–3 s, with a tail of recycled millisecond pulsars.
    const period = type === 'pulsar' ? (rng.chance(0.15) ? rng.range(0.0015, 0.02) : dexp(rng.range(dlog(0.08), dlog(4)))) : rng.range(2, 12);
    return {
      ...base, type, spectral: type === 'pulsar' ? 'Pulsar' : 'Neutron star', teff: rng.range(4e5, 1.2e6), mass, radius: rng.range(10_500, 13_000),
      luminosity: 0.05 * L_SUN, absMag, color: [0.62, 0.78, 1], ageGyr: rng.range(0.0001, 2), rotationPeriod: period,
      magneticField: dexp(rng.range(dlog(1e7), dlog(1e10))), accretion: 0,
    };
  }
  if (type === 'whitedwarf') {
    const massSun = Math.max(0.35, Math.min(1.3, rng.normal(0.62, 0.12)));
    // Mass–radius relation of a degenerate star (Nauenberg 1972).
    const x = dpow(massSun / 1.44, 2 / 3);
    const radius = 0.0112 * R_SUN * Math.sqrt(Math.max(0.02, 1 / x - x));
    const t = Math.max(3500, teff);
    const lum = dpow(radius / R_SUN, 2) * dpow(t / T_SUN, 4);
    return { ...base, type, spectral: t > 12000 ? 'DA (white dwarf)' : 'DC (white dwarf)', teff: t, mass: massSun * M_SUN, radius, luminosity: lum * L_SUN, absMag, color: blackbodyLinear(t, 1.1), ageGyr: rng.range(0.5, 11), rotationPeriod: rng.range(0.2, 3) * DAY };
  }
  if (type === 'browndwarf') {
    const t = Math.max(450, Math.min(2400, teff));
    const radius = R_JUP * rng.range(0.85, 1.15);
    return { ...base, type, spectral: `${spectralClass(t)} (brown dwarf)`, teff: t, mass: rng.range(15, 75) * M_JUP, radius, luminosity: dpow(radius / R_SUN, 2) * dpow(t / T_SUN, 4) * L_SUN, absMag, color: [1, 0.35, 0.18], ageGyr: rng.range(0.5, 10), rotationPeriod: rng.range(0.1, 1) * DAY };
  }

  const t = Math.max(2300, teff);
  const mBol = absMag + bolometricCorrection(t);
  const lum = dpow(10, -0.4 * (mBol - 4.74));
  const radius = Math.sqrt(lum) * (T_SUN / t) * (T_SUN / t);
  let massSun: number;
  let ageGyr: number;
  if (type === 'main' || type === 'subgiant') {
    massSun = massFromLuminosity(lum) * (type === 'subgiant' ? 0.85 : 1);
    const life = 10 * dpow(Math.max(massSun, 0.08), -2.5);
    ageGyr = type === 'subgiant' ? Math.min(13, life) : Math.min(13, life) * rng.range(0.05, 0.95);
  } else if (type === 'giant') {
    massSun = Math.max(0.8, Math.min(6, rng.normal(1.6, 0.7)));
    ageGyr = Math.min(13, 10 * dpow(massSun, -2.5));
  } else {
    massSun = Math.max(8, Math.min(60, dpow(lum / 1.4, 1 / 3.5) * rng.range(0.5, 0.9)));
    ageGyr = Math.min(0.05, 10 * dpow(massSun, -2.5));
  }
  const rot = t > 7000 ? rng.range(0.4, 3) : t > 5000 ? rng.range(8, 40) : rng.range(1, 90);
  return {
    ...base, type, spectral: `${spectralClass(t)}${LUM_CLASS[type]}`, teff: t, mass: massSun * M_SUN, radius: radius * R_SUN, luminosity: lum * L_SUN, absMag,
    color: blackbodyLinear(t), ageGyr, rotationPeriod: rot * DAY * (type === 'giant' || type === 'supergiant' ? 12 : 1),
  };
}

/** Absolute magnitude of a main-sequence/giant star from luminosity and temperature (inverse of the above). */
export function absMagFromLuminosity(lumSun: number, teff: number): number {
  return 4.74 - 2.5 * dlog10(Math.max(lumSun, 1e-12)) - bolometricCorrection(teff);
}

/** Friendly one-line description of a star type. */
export function describeStar(p: StarProps): string {
  switch (p.type) {
    case 'blackhole':
      return 'A collapsed star so dense that not even light can escape it.';
    case 'pulsar':
      return 'A spinning neutron star sweeping beams of radiation through space like a lighthouse.';
    case 'neutron':
      return 'The city-sized, ultra-dense core left behind by a supernova.';
    case 'whitedwarf':
      return 'The cooling, Earth-sized ember of a star like the Sun.';
    case 'browndwarf':
      return 'A “failed star” — too small to shine by fusing hydrogen.';
    case 'supergiant':
      return p.teff < 4500 ? 'A red supergiant — one of the largest stars there are, nearing the end of its life.' : 'A blazing supergiant thousands of times brighter than the Sun.';
    case 'giant':
      return p.teff < 5200 ? 'A red giant: an ageing star that has swollen to many times its original size.' : 'A giant star, far larger and brighter than the Sun.';
    case 'subgiant':
      return 'A star just starting to swell as it runs out of hydrogen in its core.';
    default:
      if (p.teff >= 30000) return 'A rare, ferociously hot blue star.';
      if (p.teff >= 10000) return 'A hot blue-white star, much brighter than the Sun.';
      if (p.teff >= 7500) return 'A white star, hotter and brighter than the Sun.';
      if (p.teff >= 6000) return 'A yellow-white star, a little hotter than the Sun.';
      if (p.teff >= 5200) return 'A yellow star much like our Sun.';
      if (p.teff >= 3700) return 'An orange dwarf: cooler, dimmer and longer-lived than the Sun.';
      return 'A red dwarf — small, cool and the most common kind of star.';
  }
}
