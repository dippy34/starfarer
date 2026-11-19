/**
 * Procedural names. Deterministic from a seed, pronounceable, and friendly —
 * the stable id (shown in the data overlay) is what guarantees uniqueness.
 */
import { Rng } from '../core/rng';

const ONSETS = ['', '', 'b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'th', 'sh', 'ch', 'br', 'dr', 'kr', 'tr', 'vr', 'zh', 'el', 'al', 'or', 'ar', 'st', 'sk', 'ph', 'qu', 'x', 'y'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ia', 'ae', 'ei', 'ou', 'io', 'y'];
const CODAS = ['', '', '', 'n', 'r', 's', 'l', 'x', 'th', 'm', 'k', 'nd', 'rn', 'ss', 'sh'];
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Sigma', 'Tau', 'Omega'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];

function word(rng: Rng, minSyl: number, maxSyl: number): string {
  const n = rng.int(minSyl, maxSyl);
  let w = '';
  for (let i = 0; i < n; i++) {
    w += rng.pick(ONSETS) + rng.pick(VOWELS);
    if (i === n - 1 || rng.chance(0.25)) w += rng.pick(CODAS);
  }
  // Avoid awkward triple letters and make sure there is something to pronounce.
  w = w.replace(/(.)\1\1+/g, '$1$1');
  if (w.length < 3) w += rng.pick(VOWELS) + rng.pick(['n', 'r', 's']);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** e.g. "Velora Galaxy" handled by the caller; this returns just "Velora". */
export function galaxyName(seed: number): string {
  const rng = new Rng(seed ^ 0x9a1a7);
  return word(rng, 2, 3);
}

/** e.g. "Thessa", "Kor Ulan", "Zeta Miriel". */
export function starName(seed: number): string {
  const rng = new Rng(seed ^ 0x57a2);
  const u = rng.next();
  if (u < 0.12) return `${rng.pick(GREEK)} ${word(rng, 2, 3)}`;
  if (u < 0.3) return `${word(rng, 1, 2)} ${word(rng, 2, 2)}`;
  return word(rng, 2, 3);
}

/** Planets follow the exoplanet convention: host name + letter (b is the innermost known). */
export function planetName(starNameText: string, index: number): string {
  return `${starNameText} ${String.fromCharCode(98 + (index % 24))}`;
}

/** Moons use roman numerals after the planet name. */
export function moonName(planetNameText: string, index: number): string {
  return `${planetNameText} ${ROMAN[index % ROMAN.length]}`;
}

/** Multiple-star components: A, B, C… */
export function componentName(systemName: string, index: number): string {
  return `${systemName} ${String.fromCharCode(65 + (index % 26))}`;
}

export function nebulaName(seed: number): string {
  const rng = new Rng(seed ^ 0x4eb);
  return `${word(rng, 2, 3)} Nebula`;
}
