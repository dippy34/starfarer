import { jdToCalendar, tdbToUtc } from '../core/time';
import { AU, formatDistance } from '../core/units';
import { fmtDuration, G, M_EARTH, M_JUPITER, M_SUN, mainSequence } from '../sim/physics';

/**
 * The powers: what the explorer can do to a world (src/app/LivePhysics.ts does it; the card of
 * src/ui/Hud.ts offers it). This file is the arithmetic and the wording, kept clear of the page
 * and of the simulation so that it can be tested by itself: where a slider puts a mass and how a
 * mass is said, what the textbook predicts of a body of that mass, the orbit a body is on from
 * where it is and how it moves, and how that is said.
 */

const M_MOON = 7.346e22;

// ---------------------------------------------------------------- a mass, changed and said

/** the slider runs this many powers of ten either side of the real mass */
export const MASS_DECADES = 3;
/** this near the middle (in powers of ten) the slider means the real mass exactly */
const MASS_SNAP = 0.03;

/** The factor on a body's real mass for a place on the slider (-MASS_DECADES to MASS_DECADES, even in the logarithm). */
export function massFactor(slider: number): number {
  const s = Math.max(-MASS_DECADES, Math.min(MASS_DECADES, slider));
  return Math.abs(s) < MASS_SNAP ? 1 : Math.pow(10, s);
}

/** Where on the slider a factor is. */
export function massSlider(factor: number): number {
  return Math.max(-MASS_DECADES, Math.min(MASS_DECADES, Math.log10(factor)));
}

/** A number as a person says it: two figures below ten, three above, thousands apart. */
function round(x: number): string {
  const v = Number(x.toPrecision(x < 9.95 ? 2 : 3));
  return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

const count = (x: number, one: string) => { const n = round(x); return `${n} ${one}${n === '1' ? '' : 's'}`; };

/**
 * A mass in the worlds a person has a feel for: "0.5 Suns", "1.3 Jupiters", "12 Earths",
 * "4.5 Moons", and below a hundredth of the Moon a share of it.
 */
export function massWords(kg: number): string {
  if (kg >= 0.1 * M_SUN) return count(kg / M_SUN, 'Sun');
  if (kg >= 0.5 * M_JUPITER) return count(kg / M_JUPITER, 'Jupiter');
  if (kg >= 0.1 * M_EARTH) return count(kg / M_EARTH, 'Earth');
  if (kg >= 0.01 * M_MOON) return count(kg / M_MOON, 'Moon');
  return `1/${Number((M_MOON / kg).toPrecision(2)).toLocaleString('en-US')} of the Moon`;
}

/** A factor on a body's real mass, in words. */
export function timesWords(factor: number): string {
  if (factor === 1) return 'its real mass';
  if (factor > 1) return `${round(factor)} times its real mass`;
  if (factor >= 0.095) return `${round(factor)} of its real mass`;
  return `1/${Number((1 / factor).toPrecision(2)).toLocaleString('en-US')} of its real mass`;
}

/** hydrogen fuses above about this (a star), deuterium above this (a brown dwarf), in Jupiters */
const STAR_FROM = 80, BROWN_DWARF_FROM = 13;

/**
 * What the textbook says a body of this mass would be, where it says anything: a prediction, for
 * whoever shows it to label as one. The app does not act on it: a Jupiter made a hundred times
 * heavier keeps its look and its size, and only its pull changes. `star`: the body is one now.
 */
export function massTheory(kg: number, star: boolean): string | null {
  const suns = kg / M_SUN, jupiters = kg / M_JUPITER;
  if (star) {
    if (jupiters < STAR_FROM) return `Below about ${STAR_FROM} Jupiters (0.08 Suns) hydrogen cannot fuse: this would not shine as a star.`;
    if (Math.abs(suns - 1) < 0.02) return null;
    const ms = mainSequence(suns);
    const light = ms.lum.value >= 1 ? `${round(ms.lum.value)} times as bright as the Sun` : `${round(100 * ms.lum.value)} % as bright as the Sun`;
    return `A star of ${count(suns, 'Sun')} would shine ${light}, ${ms.teff.value < 5772 ? 'cooler and redder' : 'hotter and bluer'} (about ${round(ms.teff.value)} K), and last about ${years(ms.life.value)}.`;
  }
  if (jupiters >= STAR_FROM) return `Above about ${STAR_FROM} Jupiters hydrogen fuses in the core: this would be a small star, shining by its own light.`;
  if (jupiters >= BROWN_DWARF_FROM) return `Above about ${BROWN_DWARF_FROM} Jupiters deuterium fuses: this would be a brown dwarf, glowing a dull red.`;
  return null;
}

function years(y: number): string {
  if (y >= 1e9) return `${round(y / 1e9)} billion years`;
  if (y >= 1e6) return `${round(y / 1e6)} million years`;
  return `${round(y)} years`;
}

// ---------------------------------------------------------------- the orbit a body is on now

export interface Orbit {
  /** closed: it comes round again */
  bound: boolean;
  /** how far from a circle: 0 a circle, towards 1 a long oval, 1 and over open */
  e: number;
  /** nearest and farthest from what it goes round (m); farthest is Infinity on an open orbit */
  peri: number;
  apo: number;
  /** once round (s); Infinity on an open orbit */
  period: number;
}

/**
 * The two-body orbit of a body at `r` (m) from what it goes round, moving at `v` (m/s) against it,
 * where the two together have `mu` = G times their masses (m³/s²): what it is on now, were nothing
 * else to pull.
 */
export function orbitOf(r: ArrayLike<number>, v: ArrayLike<number>, mu: number): Orbit {
  const d = Math.hypot(r[0], r[1], r[2]), v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const energy = v2 / 2 - mu / d;
  const hx = r[1] * v[2] - r[2] * v[1], hy = r[2] * v[0] - r[0] * v[2], hz = r[0] * v[1] - r[1] * v[0];
  const h2 = hx * hx + hy * hy + hz * hz;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
  const peri = h2 / (mu * (1 + e));
  if (!(energy < 0)) return { bound: false, e, peri, apo: Infinity, period: Infinity };
  const a = -mu / (2 * energy);
  return { bound: true, e, peri, apo: 2 * a - peri, period: 2 * Math.PI * Math.sqrt((a * a * a) / mu) };
}

/** An orbit's shape in words (the number is its eccentricity). */
export function shapeWords(o: Orbit): string {
  const e = o.e < 0.0005 ? '0' : o.e.toFixed(o.e < 0.1 ? 3 : 2);
  if (!o.bound) return `open (${e}): it will not come back`;
  return `${o.e < 0.02 ? 'nearly a circle' : o.e < 0.2 ? 'a slightly stretched circle' : o.e < 0.6 ? 'an oval' : 'a long oval'} (${e})`;
}

/** An orbit's nearest and farthest, and how long once round takes, in words. */
export function reachWords(o: Orbit): string {
  const far = (m: number) => (m >= 0.01 * AU ? `${Number((m / AU).toPrecision(3))} AU` : formatDistance(m));
  return o.bound ? `${far(o.peri)} to ${far(o.apo)} · ${fmtDuration(o.period)}` : `passes at ${far(o.peri)}, then leaves`;
}

// ---------------------------------------------------------------- saying things

/** A body's name as it stands in a sentence: "the Sun", "the Moon", "Jupiter". */
export function the(name: string): string {
  return name === 'Sun' || name === 'Moon' ? `the ${name}` : name;
}

/** Several names as a list: "Mars", "Mars and Venus", "Mars, Venus and 6 others". */
export function listed(names: readonly string[], most = 2): string {
  if (names.length <= most + 1) return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, most).join(', ')} and ${names.length - most} others`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A date (TDB Julian) as a day in words: "21 November 2026". */
export function dayWords(jd: number): string {
  const c = jdToCalendar(tdbToUtc(jd));
  return `${c.day} ${MONTHS[c.month - 1]} ${c.year}`;
}

/** A rate of time (simulated seconds a second) in words: "3 days a second", "1,200 years a second". */
export function rateWords(rate: number): string {
  const r = Math.abs(rate), DAY = 86_400, YEAR = 365.25 * DAY;
  if (r >= YEAR) return `${count(r / YEAR, 'year')} a second`;
  if (r >= DAY) return `${count(r / DAY, 'day')} a second`;
  if (r >= 3600) return `${count(r / 3600, 'hour')} a second`;
  if (r >= 60) return `${count(r / 60, 'minute')} a second`;
  return r === 1 ? 'real time' : `${round(r)} times real time`;
}

/** A speed in words for an event: "12 km/s", "340 m/s". */
export function speedWords(mps: number): string {
  return mps >= 1000 ? `${round(mps / 1000)} km/s` : `${round(mps)} m/s`;
}

/** G times a mass (m³/s²) as the mass (kg). */
export const massOf = (gm: number) => gm / G;
