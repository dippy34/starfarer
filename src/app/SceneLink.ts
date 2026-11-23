import { tdbToUtc, utcToTdb } from '../core/time';

/**
 * A link that opens someone's exact scene: what is selected, where the camera is from what it is
 * at and which way it looks, the date, the rate of time and whether it is paused (and, once live
 * physics is on, the changed universe: `world`, src/app/SceneWorld.ts). Nothing here knows of the
 * page: the app gives it numbers and names and gets numbers and names back (src/app/App.ts), the
 * browser's address and share sheet are src/platform/share.ts's.
 *
 * The form (version 1), after the '#' of the app's address, keys in this order:
 *
 *     #v=1&o=Moon&oi=301&a=Earth&ai=399&c=-1.84e7,3.1e6,2.2e6&q=0.1,-0.2,0.3,0.92&f=40
 *        &t=2026-10-01T20:00:00.000Z&r=3600&p=1&w=<base64url>
 *
 *   v   the form's version: a link of a version this app does not know is not opened
 *   o   the name of what is selected (left out: nothing is); oi its number, for a body of the
 *       Solar System (the catalogue's NAIF id, or a made world's)
 *   a   the name of what the camera is at, and moves with, where that is not what is selected
 *       (ai its number as oi); a=- for open space, where the camera is nowhere in particular
 *   c   where the camera is, from what it is at (m; from the Solar System's barycentre in open space)
 *   q   which way it looks: the rotation of the camera (a quaternion x,y,z,w)
 *   f   its field of view (degrees), where it is not the usual 50
 *   t   the date, UTC, to the millisecond (ISO 8601)
 *   r   the rate of time (simulated seconds a second; negative backwards)
 *   p   1: time paused
 *   w   live physics: the changed universe, packed (SceneWorld.ts); left out: the real universe
 *
 * Readable on purpose: someone looking at a link that went wrong can see what it asked for. Numbers
 * carry 10 significant figures (the camera to a millimetre at the Earth's distance from it) and
 * the rotation 7 decimals (a hundredth of a pixel on a phone).
 *
 * A link is written by a stranger: every field is checked (finite numbers in sane ranges, names
 * of bounded length without control characters, known keys and versions) and a link that fails
 * any check is not opened at all; `decodeLink` never throws.
 */

export const LINK_VERSION = 1;
/** a link longer than this (characters after the '#') is not read */
export const LINK_MOST = 64 * 1024;
/** names longer than this are not read */
export const NAME_MOST = 80;
/** the camera is never farther than this from anything (m): the observable universe is 8.8e26 m across */
const FARTHEST = 1e27;
/** the field of view's limits (degrees) */
const FOV_RANGE: readonly [number, number] = [0.1, 170];
/** time runs at most this fast (simulated seconds a second): live physics' thousand years a second */
export const RATE_MOST = 365250 * 86_400;
/** the dates a link can hold: those JavaScript's Date can (±275,760 years) */
const DAY_MS = 86_400_000, UNIX_JD = 2_440_587.5;

/** Something in the universe, as a link names it: its name, and its number where it is a body of the Solar System. */
export interface Named { name: string; id: number | null }

export interface SceneView {
  /** what is selected (null: nothing) */
  selected: Named | null;
  /** what the camera is at and moves with (null: open space) */
  at: Named | null;
  /** the camera from `at` (m), or from the barycentre in open space */
  camera: [number, number, number];
  /** its rotation (a unit quaternion x, y, z, w) */
  turn: [number, number, number, number];
  /** its field of view (degrees) */
  fov: number;
  /** the date (TDB Julian) */
  jd: number;
  /** the rate of time (simulated seconds a second) */
  rate: number;
  paused: boolean;
  /** the changed universe (SceneWorld.ts, packed and in base64url), or null: the real one */
  world: string | null;
}

export type Decoded = { ok: true; view: SceneView } | { ok: false; why: string };

// ---------------------------------------------------------------- writing

/** A number in as few characters as `figures` significant figures allow ("1.5e7", not "15000000.000"; never "e+"). */
export function short(x: number, figures = 10): string {
  if (x === 0) return '0';
  const s = String(Number(x.toPrecision(figures)));
  return s.replace('e+', 'e');
}

const ref = (n: Named | null, key: string): string[] => (n ? [`${key}=${encodeURIComponent(n.name)}`, ...(n.id !== null ? [`${key}i=${n.id}`] : [])] : []);
const same = (a: Named | null, b: Named | null) => !!a && !!b && a.name === b.name && a.id === b.id;

/** The part of the link after the '#'. */
export function encodeLink(v: SceneView): string {
  const parts = [`v=${LINK_VERSION}`, ...ref(v.selected, 'o')];
  if (!v.at) parts.push('a=-');
  else if (!same(v.at, v.selected)) parts.push(...ref(v.at, 'a'));
  parts.push(`c=${v.camera.map((x) => short(x)).join(',')}`);
  parts.push(`q=${v.turn.map((x) => short(Math.round(x * 1e7) / 1e7, 8)).join(',')}`);
  if (v.fov !== 50) parts.push(`f=${short(v.fov, 6)}`);
  parts.push(`t=${isoOf(v.jd)}`, `r=${short(v.rate, 12)}`, `p=${v.paused ? 1 : 0}`);
  if (v.world) parts.push(`w=${v.world}`);
  return parts.join('&');
}

/** A date (TDB Julian) as UTC to the millisecond: "2026-10-01T20:00:00.000Z". */
export function isoOf(jd: number): string {
  return new Date(Math.round((tdbToUtc(jd) - UNIX_JD) * DAY_MS)).toISOString();
}

// ---------------------------------------------------------------- reading

/** Is this fragment (what follows the '#') meant as a scene at all? (Empty: no.) */
export function isSceneFragment(fragment: string): boolean {
  return fragment.length > 0;
}

class Bad extends Error {}
const fail = (why: string): never => { throw new Bad(why); };

/** The fields of the fragment, each once: an unknown key is passed over (a later form may add some), a key twice is not read. */
function fields(fragment: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of fragment.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    // (a part of no form this app knows: passed over, as an unknown key is)
    if (!/^[a-z]{1,4}$/.test(key)) continue;
    if (out.has(key)) fail(`it says "${key}" twice`);
    let value: string;
    try {
      value = decodeURIComponent(eq < 0 ? '' : part.slice(eq + 1));
    } catch {
      return fail('it has a part that could not be read');
    }
    out.set(key, value);
  }
  return out;
}

/** A name from a link: printable, at most NAME_MOST characters. */
function nameOf(s: string, what: string): string {
  const name = s.trim();
  if (!name || name.length > NAME_MOST) fail(`the name of ${what} is ${name ? 'too long' : 'missing'}`);
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(name)) fail(`the name of ${what} has characters that are not text`);
  return name;
}

function idOf(s: string | undefined, what: string): number | null {
  if (s === undefined) return null;
  if (!/^\d{1,10}$/.test(s) || Number(s) > 2 ** 31 - 1) fail(`the number of ${what} is not one`);
  return Number(s);
}

/** A number as a link writes it: digits, a point, a sign and an exponent, finite. */
function numberOf(s: string, what: string): number {
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d{1,3})?$/i.test(s)) fail(`${what} is not a number`);
  const x = Number(s);
  if (!Number.isFinite(x)) fail(`${what} is not a finite number`);
  return x;
}

function numbersOf(s: string | undefined, n: number, what: string): number[] {
  if (s === undefined) return fail(`it does not say ${what}`);
  const parts = s.split(',');
  if (parts.length !== n) fail(`${what} is not ${n} numbers`);
  return parts.map((p) => numberOf(p, what));
}

/**
 * Read the part of a link after the '#'. Never throws: a link that is not one, is damaged, or
 * asks for something out of range gives `ok: false` and why, in a few plain words.
 */
export function decodeLink(fragment: string): Decoded {
  try {
    return { ok: true, view: read(fragment) };
  } catch (e) {
    return { ok: false, why: e instanceof Bad ? e.message : 'it could not be read' };
  }
}

function read(fragment: string): SceneView {
  if (fragment.length > LINK_MOST) fail('it is too long');
  const f = fields(fragment);
  const version = f.get('v');
  if (version === undefined) fail('it is not a link to a scene');
  if (!/^\d{1,6}$/.test(version!)) fail('its version could not be read');
  if (Number(version) > LINK_VERSION) fail(`it was made by a newer version of the app (form ${Number(version)})`);
  if (Number(version) < 1) fail('its version could not be read');

  const o = f.get('o'), a = f.get('a');
  const selected = o === undefined ? null : { name: nameOf(o, 'what was selected'), id: idOf(f.get('oi'), 'what was selected') };
  if (o === undefined && f.has('oi')) fail('it gives a number without a name');
  let at: Named | null;
  if (a === '-') at = null;
  else if (a !== undefined) at = { name: nameOf(a, 'where the camera is'), id: idOf(f.get('ai'), 'where the camera is') };
  else if (selected) at = selected;
  else return fail('it does not say where the camera is');
  if (a === undefined && f.has('ai')) fail('it gives a number without a name');

  const camera = numbersOf(f.get('c'), 3, "the camera's place");
  if (Math.hypot(camera[0], camera[1], camera[2]) > FARTHEST) fail('the camera is farther away than the universe is wide');
  const q = numbersOf(f.get('q'), 4, "the camera's direction");
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(len > 0.5 && len < 2)) fail("the camera's direction is not a rotation");
  const turn = q.map((x) => x / len) as [number, number, number, number];

  const fs = f.get('f');
  const fov = fs === undefined ? 50 : numberOf(fs, 'the field of view');
  if (!(fov >= FOV_RANGE[0] && fov <= FOV_RANGE[1])) fail('the field of view is out of range');

  const t = f.get('t');
  if (t === undefined) fail('it does not say the date');
  if (!/^[+-]?\d{4,6}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/.test(t!)) fail('its date could not be read');
  const ms = Date.parse(t!);
  if (!Number.isFinite(ms)) fail('its date could not be read');
  const jd = utcToTdb(ms / DAY_MS + UNIX_JD);
  if (!Number.isFinite(jd)) fail('its date could not be read');

  const rs = f.get('r');
  const rate = rs === undefined ? 1 : numberOf(rs, 'the rate of time');
  if (Math.abs(rate) > RATE_MOST) fail('time runs faster than the app allows');
  const p = f.get('p');
  if (p !== undefined && p !== '0' && p !== '1') fail('whether time is paused could not be read');

  const w = f.get('w');
  if (w !== undefined && !/^[A-Za-z0-9_-]+$/.test(w)) fail('its changed universe could not be read');

  return { selected, at, camera: camera as [number, number, number], turn, fov, jd, rate, paused: p === '1', world: w ?? null };
}
