import { isOpen } from '../astro/kepler';
import { jdToCalendar, tdbToUtc } from '../core/time';
import { bindingEnergy, G, L_SUN, M_EARTH, M_JUPITER, M_SUN, mainSequence } from '../sim/physics';
import { plainDistance } from './plainWords';

/**
 * The powers: what the explorer can do to a world (src/app/LivePhysics.ts does it; the card of
 * src/ui/Hud.ts offers it). This file is the arithmetic and the wording, kept clear of the page
 * and of the simulation so that it can be tested by itself: where a slider puts a mass and how a
 * mass is said, what the textbook predicts of a body of that mass, the orbit a body is on from
 * where it is and how it moves, and how that is said.
 */

/** the Moon's mass (kg) */
export const M_MOON = 7.346e22;

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

/** A star's mass: in Suns, and below a tenth of the Sun in Jupiters as well ("0.08 Suns (83.8 Jupiters)"). */
export function starMassWords(kg: number): string {
  return kg >= 0.1 * M_SUN ? massWords(kg) : `${count(kg / M_SUN, 'Sun')} (${massWords(kg)})`;
}

/** A factor on a body's real mass, in words (to the two figures its mass is said in). */
export function timesWords(factor: number): string {
  if (factor === 1) return 'its real mass';
  if (factor > 1) return `${round(factor)} times its real mass`;
  if (factor >= 0.095) return `${round(factor)} of its real mass`;
  return `1/${Number((1 / factor).toPrecision(2)).toLocaleString('en-US')} of its real mass`;
}

// ---------------------------------------------------------------- a size, changed and said

/** the size slider runs this many powers of ten either side of the real size (a thousand times the volume either way, as the mass) */
export const SIZE_DECADES = 1;
/**
 * this near (in powers of ten) a whole or half factor, or one over a whole one (1, 1.5, 2, 2.5 ... 10; 1/2, 1/3 ... 1/10),
 * the size slider means it exactly: its steps are 1.2 % apart and land on none of them but 1 (three times was 2.985:
 * "19,020 km, 3 times its real size", where three times the Earth's radius is 19,113 km)
 */
const SIZE_SNAP = 0.006;

/** The factor on a body's real radius for a place on the size slider (-SIZE_DECADES to SIZE_DECADES, even in the logarithm). */
export function sizeFactor(slider: number): number {
  const s = Math.max(-SIZE_DECADES, Math.min(SIZE_DECADES, slider)), f = Math.pow(10, s);
  const near = f >= 1 ? Math.round(2 * f) / 2 : 1 / Math.round(1 / f);
  return Math.abs(Math.log10(f / near)) < SIZE_SNAP ? near : f;
}

/**
 * A factor on a body's real size, in words: plainly where it is one the slider snaps to ("3 times
 * its real size", "2.5 times", "1/3 of"), else to three figures ("2.73 times", "2.00 times",
 * "0.794 of"), so that the radius said beside it, to the kilometre, agrees with it.
 */
export function sizeTimesWords(f: number): string {
  if (f === 1) return 'its real size';
  if (f > 1) return `${Number.isInteger(2 * f) ? String(f) : f.toPrecision(3)} times its real size`;
  const n = Math.round(1 / f);
  return Math.abs(n * f - 1) < 1e-12 ? `1/${n} of its real size` : `${f.toPrecision(3)} of its real size`;
}

/** Where on the size slider a factor on the radius is. */
export function sizeSlider(factor: number): number {
  return Math.max(-SIZE_DECADES, Math.min(SIZE_DECADES, Math.log10(factor)));
}

/**
 * The radius a body has at the same density with another mass (`factor` times its real mass):
 * R = R₀ (M / M₀)^⅓, as a ball of rock would. (A real giant planet stops growing above about a
 * Jupiter's mass, its insides squeezed by its own weight: said where this simplification is.)
 */
export function sameDensity(radius: number, factor: number): number {
  return radius * Math.cbrt(factor);
}

/** A radius in words: "6,371 km", "0.13 km". */
export function radiusWords(m: number): string {
  return m >= 10e3 ? `${Math.round(m / 1e3).toLocaleString('en-US')} km` : `${Number((m / 1e3).toPrecision(2))} km`;
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
  // (a body thrown at exactly the speed of escape is on the edge: it does not come back)
  if (isOpen(energy, mu, d)) return { bound: false, e, peri, apo: Infinity, period: Infinity };
  const a = -mu / (2 * energy);
  return { bound: true, e, peri, apo: 2 * a - peri, period: 2 * Math.PI * Math.sqrt((a * a * a) / mu) };
}

/** A distance within the system in words anyone reads, as the chips at the top say it (plainDistance): kilometres, millions or billions of them, light years far out; never AU. */
export function farWords(m: number): string {
  return plainDistance(m);
}

/**
 * An orbit in words: its shape, how near and how far, and how long once round ("a slightly
 * stretched circle, 365,709 to 382,840 km, once round in 26.2 days"); a circle where its two ends
 * come out the same ("a circle 369,335 km out, once round in 25.7 days"); on an open path, how near
 * it passes. Distances as `farWords` says them, the time as `periodWords` does: no AU, no "d" or "h".
 * How stretched it is, as a number, is for the details (`stretchWords`).
 */
export function orbitWords(o: Orbit): string {
  if (!o.bound) return `an open path: it passes at ${farWords(o.peri)}, then leaves`;
  const near = farWords(o.peri), far = farWords(o.apo), round = `once round in ${periodWords(o.period)}`;
  if (near === far) return `a circle ${near} out, ${round}`;
  // (a circle too where the details already say 0, `stretchWords`: a world left on a circle is pulled a little
  // off it as soon as time runs, and two ends a kilometre apart at the Moon's twice-distance made the card
  // read "a circle" or "nearly a circle, 738,670 to 738,671 km" by which side of a rounding they fell on)
  if (o.e < CIRCLE_E) return `a circle ${farWords((o.peri + o.apo) / 2)} out, ${round}`;
  const shape = o.e < 0.02 ? 'nearly a circle' : o.e < 0.2 ? 'a slightly stretched circle' : o.e < 0.6 ? 'an oval' : 'a long oval';
  // (the unit once, where both ends have the same: "365,709 to 382,840 km")
  const unit = (w: string) => w.replace(/^[\d.,]+ /, '');
  return `${shape}, ${unit(near) === unit(far) ? `${near.slice(0, near.length - unit(near).length - 1)} to ${far}` : `${near} to ${far}`}, ${round}`;
}

/**
 * What the toast says of a world just made: "New rocky world is new: 181 million km from the Sun, once round in 486 days."
 * `where`: how far, already in words (`farWords`) with what from; `periodS`: once round (s).
 */
export function addedWords(name: string, where: string, periodS: number): string {
  return `${name} is new: ${where}, once round in ${periodWords(periodS)}.`;
}

/** Below this stretch an orbit is a circle in words, and its stretch reads 0. */
const CIRCLE_E = 0.0005;

/** How stretched an orbit is, its eccentricity, with what the number means. */
export function stretchWords(o: Orbit): string {
  const e = o.e < CIRCLE_E ? '0' : o.e.toFixed(o.e < 0.1 ? 3 : 2);
  return `${e} (0 is a circle, 1 and more an open path)`;
}

// ---------------------------------------------------------------- a body moved by a finger

type Vec = ArrayLike<number>;
type Triple = [number, number, number];

/** seen from within this angle of its orbit's plane (its sine), a body is dragged across the view instead */
const EDGE_ON = 0.2;

/**
 * The plane a body is dragged in, by its normal (a unit vector). The plane of its orbit, so that a
 * finger moves it along and across the path it is on: `r` is the body from what it goes round,
 * `v` how it moves against that. Where the eye is too near that plane for a finger to mean a
 * place in it (`sight`: the direction the eye looks along, a unit vector), or the body goes round
 * nothing, the plane that faces the eye. `orbit`: which of the two it is.
 */
export function dragPlane(r: Vec | null, v: Vec | null, sight: Vec): { normal: Triple; orbit: boolean } {
  if (r && v) {
    const h: Triple = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    const len = Math.hypot(h[0], h[1], h[2]);
    if (len > 0 && Math.abs(h[0] * sight[0] + h[1] * sight[1] + h[2] * sight[2]) > EDGE_ON * len) return { normal: [h[0] / len, h[1] / len, h[2] / len], orbit: true };
  }
  return { normal: [-sight[0], -sight[1], -sight[2]], orbit: false };
}

/**
 * Where the sight line from the eye (at the origin) along `dir` meets the plane through `on` with
 * the normal `n`; null where it does not (it runs along the plane, or the plane is behind the eye).
 */
export function onPlane(dir: Vec, on: Vec, n: Vec): Triple | null {
  const along = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2];
  if (Math.abs(along) < 1e-6) return null;
  const t = (on[0] * n[0] + on[1] * n[1] + on[2] * n[2]) / along;
  return t > 0 ? [t * dir[0], t * dir[1], t * dir[2]] : null;
}

/**
 * The velocity that keeps a body on a circle at `r` from what it goes round, the two together
 * having `mu` (G times their masses, m³/s²): √(μ/r) across `r`, in the plane whose normal is `n`,
 * turning the way a right hand's fingers curl about `n`.
 */
export function circularVelocity(r: Vec, mu: number, n: Vec): Triple {
  const t: Triple = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]];
  const k = Math.sqrt(mu / Math.hypot(r[0], r[1], r[2])) / Math.hypot(t[0], t[1], t[2]);
  return [k * t[0], k * t[1], k * t[2]];
}

// ---------------------------------------------------------------- a world thrown

/*
 * A throw's speed is told in speeds of a circle: f times √(μ/r), the speed that would keep the
 * world going round in a circle where it is, about what holds sway there (r: the distance
 * between the two, μ: G times their masses). At f = 1 a world thrown square to that line goes
 * round in a circle; at f = √2 any world escapes, whichever way it is thrown.
 */

/** a finger lifting slower than this (CSS px a second) is not flicking */
export const FLICK_SLOWEST = 250;
/**
 * a flick this fast (CSS px a second) throws at the speed of a circle. A starting value, reasoned
 * from how fast a quick flick on a phone is (1,500 to 3,000 px a second: one at 1,700 escapes), not
 * yet tried by a hand on an iPhone
 */
export const FLICK_PER_CIRCLE = 1200;
/** a finger's speed as it lifts is taken over this much of its last movement (ms), not from its last two places */
export const FLICK_WINDOW = 90;
/** a finger that has been on the move for longer than this when it lifts (ms) was aiming, not flicking */
export const FLICK_LONGEST = 300;
/** a finger that has come no farther than this from where it came down (CSS px) has not moved */
export const FINGER_SLOP = 10;
/** a slingshot's arrow this long (CSS px) throws at the speed of a circle */
export const AIM_PER_CIRCLE = 110;
/** an arrow shorter than this (CSS px) throws nothing: the finger has come back to where it took hold */
export const AIM_SHORTEST = 16;
/** the fastest throw, in speeds of a circle (escape is √2) */
export const THROW_MOST = 3;
/** within this share of the speed of a circle, or of escape, a throw is exactly that */
export const THROW_SNAP = 0.03;
/** within this angle (rad) of square to the line from what holds sway, a throw is square to it */
export const THROW_SQUARE = (3 * Math.PI) / 180;

/** A throw's speed in speeds of a circle, made exactly 1 (a circle) or √2 (escape) within THROW_SNAP of either, and no more than THROW_MOST. */
export function snapThrow(f: number): number {
  const g = Math.max(0, Math.min(THROW_MOST, f));
  for (const at of [1, Math.SQRT2]) if (Math.abs(g / at - 1) < THROW_SNAP) return at;
  return g;
}

/** A flick of `pxPerSecond` as a throw, in speeds of a circle; null if it is too slow to be one. */
export function flickFactor(pxPerSecond: number): number | null {
  return pxPerSecond < FLICK_SLOWEST ? null : snapThrow(pxPerSecond / FLICK_PER_CIRCLE);
}

/** A slingshot's arrow `px` long as a throw, in speeds of a circle. */
export function aimFactor(px: number): number {
  return snapThrow(px / AIM_PER_CIRCLE);
}

/** Where a finger was and when: `t` in ms, `x` and `y` in CSS px. */
export interface FingerAt { t: number; x: number; y: number }

/**
 * How fast and which way a finger was moving as it lifted (CSS px a second), from its places, the
 * last where it lifted: from where it was `window` ms before that (between the two places either
 * side of that moment), so that neither one late place nor a hand that slows in its last few
 * milliseconds decides it, and a finger that rested before it lifted was not moving. A finger down
 * for less than `window` is taken from where it came down.
 */
export function fingerVelocity(places: readonly FingerAt[], window = FLICK_WINDOW): { speed: number; dx: number; dy: number } {
  const n = places.length, last = places[n - 1];
  if (n < 2) return { speed: 0, dx: 0, dy: 0 };
  const from = last.t - window;
  let k = n - 1;
  while (k > 0 && places[k - 1].t > from) k--;
  let x = places[0].x, y = places[0].y, t = places[0].t;
  if (k > 0) {
    const a = places[k - 1], b = places[k], s = b.t > a.t ? (from - a.t) / (b.t - a.t) : 1;
    x = a.x + s * (b.x - a.x);
    y = a.y + s * (b.y - a.y);
    t = from;
  }
  const dt = (last.t - t) / 1000;
  if (!(dt > 0)) return { speed: 0, dx: 0, dy: 0 };
  const dx = (last.x - x) / dt, dy = (last.y - y) / dt;
  return { speed: Math.hypot(dx, dy), dx, dy };
}

/**
 * Was a finger that took hold of a world, and has lifted, flicking it? From its places (the first
 * where it came down, the last where it lifted): it set off no more than FLICK_LONGEST before it
 * lifted (longer, and it was pulling an arrow back to aim) and was going at FLICK_SLOWEST or more
 * as it lifted. If so the throw: `f` speeds of a circle, along (`dx`, `dy`) on the screen (a unit
 * vector, the way the finger went); null otherwise.
 */
export function flickOf(places: readonly FingerAt[]): { f: number; dx: number; dy: number } | null {
  const first = places[0], last = places[places.length - 1];
  const off = first && places.find((p) => Math.hypot(p.x - first.x, p.y - first.y) > FINGER_SLOP);
  if (!off || last.t - off.t > FLICK_LONGEST) return null;
  const v = fingerVelocity(places), f = flickFactor(v.speed);
  return f === null ? null : { f, dx: v.dx / v.speed, dy: v.dy / v.speed };
}

/**
 * The velocity, against what holds sway, of a world thrown along `dir` (a unit vector) at `f`
 * speeds of a circle from `r` (m) from it, the two of them having `mu` (G times their masses).
 */
export function throwVelocity(r: Vec, mu: number, dir: Vec, f: number): Triple {
  const v = f * Math.sqrt(mu / Math.hypot(r[0], r[1], r[2]));
  return [v * dir[0], v * dir[1], v * dir[2]];
}

/**
 * The way a world is thrown (`dir`, a unit vector in the plane whose normal is `n`): square to the
 * line `r` from what holds sway, going the nearer way round, if it is within `within` of that
 * (so that a throw at the speed of a circle goes round in a circle); otherwise as it is.
 */
export function squareThrow(dir: Vec, r: Vec, n: Vec, within = THROW_SQUARE): Triple {
  const t: Triple = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]];
  const len = Math.hypot(t[0], t[1], t[2]), along = (dir[0] * t[0] + dir[1] * t[1] + dir[2] * t[2]) / len;
  if (!(len > 0) || Math.abs(along) < Math.cos(within)) return [dir[0], dir[1], dir[2]];
  const k = Math.sign(along) / len;
  return [k * t[0], k * t[1], k * t[2]];
}

// ---------------------------------------------------------------- watching what a change does

/** A body as a change is weighed against: its number, G times its mass (m³/s²) and where it is (m). */
export interface Weighed { id: number; gm: number; pos: Vec }

/** a change matters to a body whose acceleration it changes by this share of what it was, or more */
export const MATTERS = 0.01;

/** The pull of every other body of `bodies` on the one at `k` (m/s²), into `out`. */
function pullOn(bodies: readonly Weighed[], k: number, out: Triple): Triple {
  const p = bodies[k].pos;
  out[0] = out[1] = out[2] = 0;
  for (let j = 0; j < bodies.length; j++) {
    const q = bodies[j];
    if (j === k || !(q.gm > 0)) continue;
    const dx = q.pos[0] - p[0], dy = q.pos[1] - p[1], dz = q.pos[2] - p[2], r2 = dx * dx + dy * dy + dz * dz;
    if (!(r2 > 0)) continue;
    const f = q.gm / (r2 * Math.sqrt(r2));
    out[0] += f * dx; out[1] += f * dy; out[2] += f * dz;
  }
  return out;
}

/**
 * The bodies a change matters to (their numbers): those whose acceleration, the pull of everything
 * else on them, it changes by MATTERS of what it was or more. `before` and `after` are the bodies
 * as they were and as they are, at one moment: one only in `after` was made (it counts), one only
 * in `before` was taken away; one in both pulls with its mass as it is from where it is. So a mass
 * changed by Δm pulls every other body GΔm/r² harder, one taken away no longer pulls by Gm/r², one
 * made pulls by Gm/r², and one moved pulls from its new place instead of its old one.
 */
export function affected(before: readonly Weighed[], after: readonly Weighed[], share = MATTERS): number[] {
  const was = new Map(before.map((b, k) => [b.id, k]));
  const now: Triple = [0, 0, 0], then: Triple = [0, 0, 0], out: number[] = [];
  after.forEach((b, k) => {
    const j = was.get(b.id);
    if (j === undefined) { out.push(b.id); return; }
    pullOn(after, k, now);
    pullOn(before, j, then);
    const change = Math.hypot(now[0] - then[0], now[1] - then[1], now[2] - then[2]);
    if (change > 0 && change >= share * Math.hypot(then[0], then[1], then[2])) out.push(b.id);
  });
  return out;
}

/** a watch goes at the pace at which the quickest orbit among the worlds a change matters to goes round once in this many seconds */
export const WATCH_TURN = 8;
/** a watch lasts this many seconds */
export const WATCH_SECONDS = 15;
/** and never runs time slower than a minute a second */
export const WATCH_SLOWEST = 60;

/**
 * How fast time runs while a change is watched (simulated seconds a second): the quickest of
 * `periods` (s) in WATCH_TURN seconds, no faster than `most` and no slower than a minute a second.
 * Null where there is no period to go by.
 */
export function watchRate(periods: Iterable<number>, most: number): number | null {
  let quickest = Infinity;
  for (const p of periods) if (p > 0 && p < quickest) quickest = p;
  if (!Number.isFinite(quickest)) return null;
  return Math.max(WATCH_SLOWEST, Math.min(most, quickest / WATCH_TURN));
}

/** the frame reaches this many times as far as the farthest of the worlds it frames gets */
export const FRAME_MARGIN = 1.5;
/** the worlds framed are those that go round in at most this many times the quickest's period */
export const FRAME_PERIODS = 20;

/** A world in a watch's frame: how long once round takes it (s), and how far from the frame's centre it gets while it is watched (m). */
export interface Framed { period: number; reach: number }

/**
 * How far from its centre a watch's frame reaches (m): FRAME_MARGIN times as far as the farthest
 * reach of the worlds whose period is at most FRAME_PERIODS times the quickest (by default the
 * quickest of theirs). (A world 30 AU out does not shrink the inner planets to dots when the Sun
 * is taken away.) 0: nothing to frame.
 */
export function frameRadius(worlds: readonly Framed[], quickest = Math.min(...worlds.map((w) => (w.period > 0 ? w.period : Infinity)))): number {
  let far = 0;
  for (const w of worlds) if (w.period <= FRAME_PERIODS * quickest && Number.isFinite(w.reach)) far = Math.max(far, w.reach);
  return FRAME_MARGIN * far;
}

/** A world a change matters to, as its watch is planned from it. */
export interface Watched {
  /** G times its mass (m³/s²), where it is (m) and how it moves (m/s) */
  gm: number; pos: Vec; vel: Vec;
  /** how long once round takes it on the orbit it is on now about what it goes round, and took it on the one it was on before the change (s; Infinity: an open path, or round nothing) */
  period: number; was: number;
}

/** What a watch does: how fast time runs (simulated seconds a second), and how far from the frame's centre the frame reaches (m; 0: the camera stays where it is). */
export interface WatchPlan { rate: number; radius: number }

/**
 * The watch of a change, from the worlds it matters to and the centre of the frame: where that is,
 * how it moves and G times its mass (null: there is nothing to frame round). A world's period is
 * that of its orbit about the centre where it is bound to it (a moon round the planet made
 * heavier, the planets round a sun); else of the orbit it is on about what it goes round; else of
 * the one it was on before the change (a moon thrown off by a planet made lighter keeps the pace
 * of its month). The frame holds the worlds bound to the centre, as far as the far end of each
 * one's orbit about it, and those that go round nothing now, as far as each gets in the watch;
 * a world that goes round something else (a moon of Saturn when the Sun is taken away) sets the
 * pace with the others but goes where what it goes round goes. Null where none of the worlds has
 * a period to go by: nothing is to be seen going round.
 */
export function watchPlan(worlds: readonly Watched[], centre: { gm: number; pos: Vec; vel: Vec } | null, most: number): WatchPlan | null {
  const about = worlds.map((w) => {
    if (!centre) return null;
    const r: Triple = [w.pos[0] - centre.pos[0], w.pos[1] - centre.pos[1], w.pos[2] - centre.pos[2]];
    const v: Triple = [w.vel[0] - centre.vel[0], w.vel[1] - centre.vel[1], w.vel[2] - centre.vel[2]];
    const d = Math.hypot(r[0], r[1], r[2]);
    return d > 0 ? { d, speed: Math.hypot(v[0], v[1], v[2]), o: orbitOf(r, v, w.gm + centre.gm) } : null;
  });
  const periods = worlds.map((w, k) => {
    const a = about[k];
    if (a?.o.bound) return a.o.period;
    return Number.isFinite(w.period) ? w.period : w.was;
  });
  const rate = watchRate(periods, most);
  if (rate === null) return null;
  if (!centre) return { rate, radius: 0 };
  const T = rate * WATCH_SECONDS, framed: Framed[] = [];
  worlds.forEach((w, k) => {
    const a = about[k];
    if (a?.o.bound) framed.push({ period: periods[k], reach: a.o.apo });
    else if (a && !Number.isFinite(w.period)) framed.push({ period: periods[k], reach: a.d + a.speed * T });
  });
  return { rate, radius: frameRadius(framed, Math.min(...periods.map((p) => (p > 0 ? p : Infinity)))) };
}

/** A part of the view, in CSS px from its top-left corner. */
export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Where in a view of `width` by `height` CSS px, with the vertical field `fovY` (deg), a subject is
 * framed when only `free` is clear of the interface: the direction of the middle of that part in
 * the camera's own axes (x to the right, y up, -z ahead: as CameraRig.ray has them), and the
 * angles (rad) from there to the nearer of its sides and to the nearer of its top and bottom.
 * `cx`, `cy`: where the optical centre is from the middle of the view (CSS px, y down), if it is
 * not the middle (the camera then looks along the direction that puts the subject at the free
 * part's middle all the same: App's `centre`).
 */
export function viewFrame(free: Rect, width: number, height: number, fovY: number, cx = 0, cy = 0): { dir: Triple; halfX: number; halfY: number } {
  const t = Math.tan((fovY * Math.PI) / 360), k = (2 * t) / height;
  const ray = (x: number, y: number): Triple => {
    const v: Triple = [(x - width / 2 - cx) * k, (height / 2 + cy - y) * k, -1], l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const angle = (p: Triple, q: Triple) => Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  const x = (free.left + free.right) / 2, y = (free.top + free.bottom) / 2, dir = ray(x, y);
  return {
    dir,
    halfX: Math.min(angle(dir, ray(free.left, y)), angle(dir, ray(free.right, y))),
    halfY: Math.min(angle(dir, ray(x, free.top)), angle(dir, ray(x, free.bottom))),
  };
}

/**
 * How far from the centre of a frame of `radius` (m) the eye stands for the frame to fill the clear
 * part of the view, `halfX` and `halfY` (rad) either way of its middle: radius / tan(the smaller).
 */
export function frameDistance(radius: number, halfX: number, halfY: number): number {
  return radius / Math.tan(Math.min(halfX, halfY));
}

// ---------------------------------------------------------------- two worlds that meet

/**
 * How long until `x` (m) apart, on the way in, for two bodies `d` (m) apart and closing as `rv` (r·v:
 * negative while they near), with `energy` (J/kg), `h2` (the square of r × v) and `e` about `mu`
 * (G times both masses), on the two-body orbit of one about the other: from where it is to `x`
 * (at least its nearest, `x` >= q), through the far end first if it is going out (NaN where it never
 * comes in again). From the energy's sign: an ellipse, a parabola or a hyperbola, straight ones (e = 1,
 * h = 0: one falling straight at the other) among them.
 */
function inbound(d: number, rv: number, mu: number, energy: number, h2: number, e: number, x: number): number {
  // (nearer nothing than 10⁻¹² of μ/d the formulas of the ellipse and the hyperbola lose their digits)
  if (Math.abs(energy) < 1e-12 * (mu / d)) {
    // a parabola (Barker): from where it would be at its nearest, t = √(p³/μ)/2 (D + D³/3), D = tan(ν/2); a straight one falls
    // in as r^(3/2)
    if (rv >= 0) return NaN;
    const p = h2 / mu;
    if (!(p > 1e-12 * d)) return Math.sqrt(2 / (9 * mu)) * (d ** 1.5 - x ** 1.5);
    const at = (r: number) => { const D = -Math.tan(Math.acos(Math.max(-1, Math.min(1, p / r - 1))) / 2); return 0.5 * Math.sqrt((p * p * p) / mu) * (D + (D * D * D) / 3); };
    return at(x) - at(d);
  }
  if (energy < 0) {
    // an ellipse: the eccentric anomaly from where it is and how it moves (no division by e: a straight fall is one too)
    const a = -mu / (2 * energy), n = Math.sqrt(mu / (a * a * a)), k = Math.min(1, e);
    const E0 = Math.atan2(rv / Math.sqrt(mu * a), 1 - d / a), Ex = -Math.acos(Math.max(-1, Math.min(1, (1 - x / a) / Math.max(k, 1e-300))));
    const turn = 2 * Math.PI;
    return ((((Ex - k * Math.sin(Ex)) - (E0 - k * Math.sin(E0))) % turn) + turn) % turn / n;
  }
  if (rv >= 0) return NaN;
  const a = mu / (2 * energy), n = Math.sqrt(mu / (a * a * a)), k = Math.max(1, e);
  const F0 = Math.asinh(rv / (k * Math.sqrt(mu * a))), Fx = -Math.acosh(Math.max(1, (1 + x / a) / k));
  return ((k * Math.sinh(Fx) - Fx) - (k * Math.sinh(F0) - F0)) / n;
}

/**
 * When two bodies, `r` (m) and `v` (m/s) one from the other, with `mu` = G times both masses, touch
 * (`touch`, m: their radii added) and when they first come within `zone` (m) of each other, from now
 * (s; 0 for already within), on the two-body orbit of one about the other; null if they never touch
 * going on: its nearest is farther than `touch`, or they are parting on an open path. Near the end
 * of a fall the two-body orbit is what happens: what else pulls, pulls on both nearly alike.
 */
export function contactTimes(r: Vec, v: Vec, mu: number, touch: number, zone: number): { contact: number; zone: number } | null {
  const d = Math.hypot(r[0], r[1], r[2]);
  if (d <= touch) return { contact: 0, zone: 0 };
  const rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2], v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const energy = v2 / 2 - mu / d;
  const hx = r[1] * v[2] - r[2] * v[1], hy = r[2] * v[0] - r[0] * v[2], hz = r[0] * v[1] - r[1] * v[0], h2 = hx * hx + hy * hy + hz * hz;
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
  if (!(h2 / (mu * (1 + e)) < touch)) return null;
  const contact = inbound(d, rv, mu, energy, h2, e, touch);
  if (!(contact >= 0)) return null;
  return { contact, zone: d <= zone ? 0 : Math.min(contact, inbound(d, rv, mu, energy, h2, e, zone)) };
}

/**
 * A world as the look for a hit has it: G times its mass (m³/s²), its radius (m), where it is (m)
 * and how it moves (m/s), and how far its own pull holds sway (`reach`, m: its Hill sphere about
 * what it goes round; none given, everywhere).
 */
export interface Meeting<T> { body: T; gm: number; radius: number; pos: Vec; vel: Vec; reach?: number }
/** Two worlds that will hit: when they touch and when they come within `zone` of each other (s from now). */
export interface Approach<T> { a: T; b: T; contact: number; zone: number }

/**
 * The first hit ahead among `worlds`, if one comes within `within` seconds of their coming `zone`
 * times their radii added apart (contactTimes), the two-body orbit of each pair being what is
 * looked at. Pairs that cannot come that near so soon, at the most speed falling together could
 * give them, are passed over unworked; so are two farther apart than either's pull holds sway
 * (`reach`) and than their zone, where what they go round steers them, not each other: two moons
 * of Saturn hundreds of thousands of kilometres apart, whose two-body orbit about each other is
 * nearly a straight line that may run through both (with frames long on a loaded machine, and so
 * far ahead looked, it did, and their "hit" took the frame of a watch elsewhere).
 */
export function soonestContact<T>(worlds: readonly Meeting<T>[], within: number, zone: number): Approach<T> | null {
  let best: Approach<T> | null = null;
  const r: Triple = [0, 0, 0], v: Triple = [0, 0, 0];
  for (let i = 0; i < worlds.length; i++) {
    const p = worlds[i];
    for (let j = i + 1; j < worlds.length; j++) {
      const q = worlds[j], mu = p.gm + q.gm, touch = p.radius + q.radius, near = zone * touch;
      for (let c = 0; c < 3; c++) { r[c] = q.pos[c] - p.pos[c]; v[c] = q.vel[c] - p.vel[c]; }
      const d = Math.hypot(r[0], r[1], r[2]);
      if (d > Math.max(p.reach ?? Infinity, q.reach ?? Infinity, near)) continue;
      if (d - near > Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + (2 * mu) / near) * within) continue;
      const t = contactTimes(r, v, mu, touch, near);
      if (t && t.zone <= within && (!best || t.contact < best.contact)) best = { a: p.body, b: q.body, contact: t.contact, zone: t.zone };
    }
  }
  return best;
}

/** A number in powers of ten, as read: "4.9×10³¹". */
export function powerWords(x: number): string {
  const [m, p] = x.toExponential(1).split('e');
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return `${m.replace(/\.0$/, '')}×10${String(Number(p)).replace('-', '⁻').replace(/\d/g, (k) => SUP[Number(k)])}`;
}

/** One of two worlds that met: its name, G times its mass (m³/s²) and its radius (m), as they were. */
export interface Met { name: string; gm: number; radius: number }

/**
 * Two worlds that met, in words: who hit whom and how fast; the energy of the hit (½μv², μ the
 * two masses' product over their sum: the energy of their motion against each other) against the
 * light the Sun gives off, and against what holds the lighter together (physics.bindingEnergy,
 * as a ball of even density); and what a rule of thumb says that would do, labelled so, as it is
 * not simulated. `small` is the lighter, which became part of `big`.
 */
export function impactWords(small: Met, big: Met, speed: number, energy: number): { head: string; energy: string; holds: string; foretold: string; simulated: string } {
  const sun = energy / L_SUN;
  const ofSun = sun >= 1 ? spanWords(sun) : `1/${round(1 / sun)} of a second`;
  const hold = (m: Met) => bindingEnergy(m.gm / G, m.radius);
  const k = energy / hold(small), name = the(small.name);
  const verdict = energy >= hold(big) ? 'both would break apart' : k >= 1 ? `${name} would break apart, ${the(big.name)} would not` : 'neither would break apart';
  return {
    head: `${capital(name)} hit ${the(big.name)} at ${speedWords(speed)}`,
    energy: `Energy ${powerWords(energy)} J: as much as the Sun gives off in ${ofSun}.`,
    holds: `${k >= 1 ? `${round(k)} times` : `1/${round(1 / k)} of`} the energy that holds ${name} together.`,
    foretold: `Prediction, by a rule of thumb (the energy against what holds each together): ${verdict}.`,
    simulated: 'Breaking apart is not simulated yet: the two become one.',
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

/** A date (TDB Julian) as a day in words: "21 November 2026" (`short`: "21 Nov 2026", where room is scarce). */
export function dayWords(jd: number, short = false): string {
  const c = jdToCalendar(tdbToUtc(jd)), month = MONTHS[c.month - 1];
  return `${c.day} ${short ? month.slice(0, 3) : month} ${c.year}`;
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

/** The speed of time as the clock at the top says it, short: "real time", "3 hours a second", "◀ 2 days a second" (backwards). */
export function clockChipWords(rate: number): string {
  return `${rate < 0 ? '◀ ' : ''}${rateWords(rate)}`;
}

/** The speed of time as the Time sheet says it: "Real time", "3 hours a second", "2 days a second, backwards". */
export function clockSpeedWords(rate: number): string {
  return `${capital(rateWords(rate))}${rate < 0 ? ', backwards' : ''}`;
}

/** A stretch of time in words: "51 days", "6.6 hours", "1,200 years". */
export function spanWords(seconds: number): string {
  const s = Math.abs(seconds), DAY = 86_400, YEAR = 365.25 * DAY;
  if (s >= YEAR) return count(s / YEAR, 'year');
  if (s >= DAY) return count(s / DAY, 'day');
  if (s >= 3600) return count(s / 3600, 'hour');
  if (s >= 60) return count(s / 60, 'minute');
  return count(s, 'second');
}

/**
 * How long once round takes, in words, in the unit an orbit is best told in: seconds under two minutes,
 * minutes under two hours, hours under two days, days under two years, then years ("486 days", "26.2 days",
 * "6.6 hours", "11.9 years"). The figures are `spanWords`'s (three at most); `spanWords` itself moves to the
 * next unit at one (a year of 365 days, "1 year"), which would read 486 days as "1.3 years".
 */
export function periodWords(seconds: number): string {
  const s = Math.abs(seconds), DAY = 86_400, YEAR = 365.25 * DAY;
  if (s >= 2 * YEAR) return count(s / YEAR, 'year');
  if (s >= 2 * DAY) return count(s / DAY, 'day');
  if (s >= 2 * 3600) return count(s / 3600, 'hour');
  if (s >= 120) return count(s / 60, 'minute');
  return count(s, 'second');
}

/** When something will happen, `seconds` from now, on `jd` (TDB): "in 43 days" within a year, "in 2031" beyond. */
export function whenWords(seconds: number, jd: number): string {
  return seconds < 365.25 * 86_400 ? `in ${spanWords(seconds)}` : `in ${jdToCalendar(tdbToUtc(jd)).year}`;
}

/** What ends the path ahead of a world (src/app/Foresight.ts), by name: it hits `other`, leaves `from` (null: nothing) for good, or `around` takes it over; `when` in words (whenWords). */
export type AheadEnd =
  | { kind: 'hit'; other: string; when: string }
  | { kind: 'leaves'; from: string | null }
  | { kind: 'round'; around: string; when: string };

/**
 * What ends the path ahead, in words: where the path ends (`there`: "hits Earth in 1.6 days",
 * "leaves the Sun for good", "in 3.2 days it is the Sun's") and on the card (`line`: "With every
 * pull counted, it hits Earth in 1.6 days."). One taken over by another is that one's from then on:
 * "it goes round the Sun in 3.2 days" read as a year of 3.2 days.
 */
export function aheadWords(end: AheadEnd): { there: string; line: string } {
  if (end.kind === 'round') {
    const owner = the(end.around);
    return { there: `${end.when} it is ${owner}'s`, line: `With every pull counted, ${end.when} it is ${owner}'s: from then on it goes round ${owner}.` };
  }
  const there = end.kind === 'hit' ? `hits ${the(end.other)} ${end.when}` : end.from ? `leaves ${the(end.from)} for good` : 'flies off for good';
  return { there, line: `With every pull counted, it ${there}.` };
}

/** A speed in words for an event: "12 km/s", "340 m/s". */
export function speedWords(mps: number): string {
  return mps >= 1000 ? `${round(mps / 1000)} km/s` : `${round(mps)} m/s`;
}

/** G times a mass (m³/s²) as the mass (kg). */
export const massOf = (gm: number) => gm / G;
