import type { NBodyBodies } from '../sim/NBody';
import { isWorldKind, type Kind, MADE_FIRST_ID, MADE_MOST, WORLD_KINDS } from './WhatIf';

/**
 * The changed universe, as a link or a save keeps it (the `w` of src/app/SceneLink.ts): live
 * physics at a moment (src/app/LivePhysics.ts: `world`, `adoptWorld`). Everything is kept by number
 * (a body's NAIF id, or a made world's), never by reference, so that it can be written down, sent
 * to a stranger and made again from the same catalogue there.
 *
 * What it holds, and why that much: the simulation settled at that moment (NBody.bodies: every
 * simulated body's mass, size, place and motion, to the last bit), the moons each simulated planet
 * stands for, the worlds that were made (enough to make them again: kind, name, what for, mass and
 * size), the bodies taken away, the masses and sizes that are no longer the catalogue's, the date
 * the real universe was left (for Back to reality) and the last lines of what happened. What rides
 * on the simulation (the light moons, the belt) follows from the catalogue at the date; the plan
 * of the steps is made again from the bodies, on the sender's device as on the receiver's (the
 * sender's simulation is started again from what the link holds when it shares: App.share).
 *
 * Bytes (all little-endian): a structure of small numbers (LEB128, zigzag where signed), and after
 * it every float64, kept apart and stored byte plane by byte plane (all first bytes, then all
 * second bytes...): the signs and exponents of the doubles then sit together and pack well. The
 * whole is packed with deflate and written in base64url (SceneLink.ts measures and says why: see
 * HANDOFF.md "Save & share").
 *
 * Reading never trusts it: every count and length is capped before anything is made for it, every
 * double must be finite and in range, every name is plain text of bounded length, and anything
 * else is an error (`decodeWorld` throws WorldError, with a few plain words).
 */

export const WORLD_FORMAT = 1;

/** A world the explorer made, as it is made again: what it was made as, its name, what it was made for, its mass and size then, and a sun's colour and light. */
export interface MadeRecord {
  id: number;
  kind: Kind;
  name: string;
  /** what it was given to (its catalogue's parent): a body's number */
  home: number;
  /** a moon of ice and rock, made beyond the frost line */
  icy: boolean;
  /** the mass it was made with (kg), and G times it and its mean radius (m) as it was made (before any later change) */
  kg: number;
  gm: number;
  radius: number;
  /** a sun's temperature (K) and absolute magnitude now (0 for a world that is not a sun) */
  teff: number;
  absMag: number;
  /** the seed of the generated look of a world of one (WorldKind: its type is its kind); none for the others (the simulation does not carry it: App.sceneView sets it) */
  seed?: number;
  /** a world of a generated look with rings (none, or false: without); kept as the seed is */
  rings?: boolean;
}

export interface LiveWorld {
  /** the date the real universe was left (TDB Julian): Back to reality goes there */
  jd0: number;
  sim: NBodyBodies;
  /** for each simulated body that stands for moons besides itself, those moons */
  carried: [number, number[]][];
  /** the worlds made, oldest first */
  made: MadeRecord[];
  /** the bodies taken away (or made one with another) */
  gone: number[];
  /** the bodies whose mass or size is not what they had: number, G times the mass (m³/s²), mean radius (m) */
  changed: [number, number, number][];
  /** what happened, oldest first (the last few) */
  log: { jd: number; text: string }[];
  /**
   * For each simulated body (in the order of `sim.ids`): 1 if its G x mass in the simulation is
   * the body's own (Body.gm, once the made worlds and `changed` are applied), 2 if its radius is,
   * 3 both. Those are not written: both ends have the catalogue, and its numbers are the same
   * bits on both. `decodeWorld` gives 0 for them in `sim`, and `adoptWorld` fills them in.
   */
  asBody: number[];
}

/** what a reading may hold at most: bodies, families and their moons, worlds made, lines of the log and their length, a made world's name */
export const WORLD_LIMITS = { bodies: 1024, families: 64, family: 256, made: MADE_MOST, gone: 1024, changed: 1024, log: 12, line: 400, name: 40 } as const;
/** a link's changed universe unpacks to at most this many bytes */
export const WORLD_BYTES_MOST = 256 * 1024;

export class WorldError extends Error {}
const bad = (why: string): never => { throw new WorldError(why); };

/** (the first four are the first format's: a link written before the worlds of a generated look is read as ever) */
const KINDS: readonly Kind[] = ['moon', 'earth', 'jupiter', 'sun', ...WORLD_KINDS];
/** a look's seed is a whole number below this */
export const SEED_MOST = 1_000_000;

/**
 * A made world's name, as a link may give it: letters, digits, spaces and a few marks (apostrophes,
 * hyphens, points), at most WORLD_LIMITS.name characters. It is shown as text wherever it is shown;
 * this keeps it plain text besides (no markup, no control characters, nothing that turns text round).
 */
export function plainName(s: string): boolean {
  return s.length > 0 && s.length <= WORLD_LIMITS.name && /^[\p{L}\p{N}][\p{L}\p{N} '’.\-]*$/u.test(s) && s.trim() === s;
}

/** A line of the log, as a link may give it: printable text, without control characters, of bounded length. */
function plainLine(s: string): boolean {
  return s.length > 0 && s.length <= WORLD_LIMITS.line && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029‪-‮⁦-⁩<>]/.test(s);
}

// ---------------------------------------------------------------- writing

class Writer {
  bytes: number[] = [];
  doubles: number[] = [];
  u8(x: number): void { this.bytes.push(x & 255); }
  /** an unsigned whole number (LEB128) */
  uint(x: number): void {
    if (!Number.isInteger(x) || x < 0 || x > Number.MAX_SAFE_INTEGER) throw new Error(`not a whole number: ${x}`);
    do {
      const low = x % 128;
      x = Math.floor(x / 128);
      this.bytes.push(x > 0 ? low | 128 : low);
    } while (x > 0);
  }
  /** a signed whole number (zigzag, then LEB128) */
  int(x: number): void { this.uint(x < 0 ? -2 * x - 1 : 2 * x); }
  f64(x: number): void { this.doubles.push(x); }
  text(s: string): void {
    const b = new TextEncoder().encode(s);
    this.uint(b.length);
    for (const c of b) this.bytes.push(c);
  }
  /** the structure, then every double byte plane by byte plane */
  done(): Uint8Array {
    const n = this.doubles.length, head = this.bytes.length;
    const out = new Uint8Array(head + 8 * n);
    out.set(this.bytes, 0);
    const d = new DataView(new ArrayBuffer(8));
    for (let i = 0; i < n; i++) {
      d.setFloat64(0, this.doubles[i], true);
      for (let k = 0; k < 8; k++) out[head + k * n + i] = d.getUint8(k);
    }
    return out;
  }
}

/** The changed universe as bytes (before packing). */
export function encodeWorld(w: LiveWorld): Uint8Array {
  const o = new Writer(), s = w.sim, n = s.ids.length;
  o.u8(WORLD_FORMAT);
  o.f64(w.jd0);
  o.f64(s.time);
  o.uint(s.nextId);
  o.f64(s.railsBelow); o.f64(s.lightRailsBelow); o.f64(s.railsCross); o.uint(s.steps); o.f64(s.edge);
  o.uint(n);
  for (let i = 0; i < n; i++) {
    const zon = s.zon[i] > 0, rs = s.rs[i] > 0;
    const as = w.asBody[i];
    o.uint(s.ids[i]);
    o.u8(s.free[i] | (s.pin[i] << 2) | (zon ? 8 : 0) | (rs ? 16 : 0) | (as << 5));
    o.int(s.around[i]);
    if (!(as & 1)) o.f64(s.gm[i]);
    if (!(as & 2)) o.f64(s.radius[i]);
    if (rs) o.f64(s.rs[i]);
    if (zon) { o.f64(s.zon[i]); for (let c = 0; c < 3; c++) o.f64(s.pole[3 * i + c]); }
    for (let c = 0; c < 3; c++) o.f64(s.x[3 * i + c]);
    for (let c = 0; c < 3; c++) o.f64(s.v[3 * i + c]);
  }
  o.uint(w.carried.length);
  for (const [id, moons] of w.carried) { o.uint(id); o.uint(moons.length); for (const m of moons) o.uint(m); }
  o.uint(w.made.length);
  for (const m of w.made) {
    // (the byte after its home: 1 an icy moon; for a world of a generated look, 2 with rings: a link written before rings reads as ever)
    o.uint(m.id - MADE_FIRST_ID); o.u8(KINDS.indexOf(m.kind)); o.text(m.name); o.uint(m.home); o.u8((m.icy ? 1 : 0) | (isWorldKind(m.kind) && m.rings ? 2 : 0));
    if (isWorldKind(m.kind)) {
      if (m.seed === undefined) throw new Error('a world of a generated look has no seed');
      o.uint(m.seed);
    }
    o.f64(m.kg); o.f64(m.gm); o.f64(m.radius);
    if (m.kind === 'sun') { o.f64(m.teff); o.f64(m.absMag); }
  }
  o.uint(w.gone.length);
  for (const id of w.gone) o.uint(id);
  o.uint(w.changed.length);
  for (const [id, gm, r] of w.changed) { o.uint(id); o.f64(gm); o.f64(r); }
  o.uint(w.log.length);
  for (const e of w.log) { o.f64(e.jd); o.text(e.text); }
  return o.done();
}

// ---------------------------------------------------------------- reading

class Reader {
  private at = 0;
  private d = 0;
  private readonly view: DataView;
  private head = 0;
  private count = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  /** where the doubles begin, and how many there are: what is left after the structure, which must be whole doubles */
  doublesFrom(): void {
    this.head = this.at;
    const left = this.bytes.length - this.head;
    if (left % 8 !== 0) bad('its numbers do not come out whole');
    this.count = left / 8;
  }
  u8(): number {
    if (this.at >= this.bytes.length) bad('it ends too soon');
    return this.bytes[this.at++];
  }
  uint(most = Number.MAX_SAFE_INTEGER): number {
    let x = 0, scale = 1;
    for (let k = 0; ; k++) {
      if (k > 7) bad('a number in it is too long');
      const b = this.u8();
      x += (b & 127) * scale;
      scale *= 128;
      if (!(b & 128)) break;
    }
    if (x > most) bad('a count in it is out of range');
    return x;
  }
  int(): number {
    const z = this.uint(2 ** 33);
    return z % 2 ? -(z + 1) / 2 : z / 2;
  }
  text(most: number): string {
    const len = this.uint(4 * most);
    if (this.at + len > this.bytes.length) bad('it ends too soon');
    let s: string;
    try {
      s = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(this.at, this.at + len));
    } catch {
      return bad('some of its text could not be read');
    }
    this.at += len;
    return s;
  }
  /** the next double of the planes (in the order written), which must be finite */
  f64(): number {
    if (this.d >= this.count) bad('it ends too soon');
    const tmp = new DataView(new ArrayBuffer(8));
    for (let k = 0; k < 8; k++) tmp.setUint8(k, this.view.getUint8(this.head + k * this.count + this.d));
    this.d++;
    const x = tmp.getFloat64(0, true);
    if (!Number.isFinite(x)) bad('a number in it is not finite');
    return x;
  }
  get offset(): number { return this.at; }
  get doublesLeft(): number { return this.count - this.d; }
  seek(at: number): void { this.at = at; }
}

/** a finite number in [lo, hi], else the reading fails with `what` */
function within(x: number, lo: number, hi: number, what: string): number {
  if (!(x >= lo && x <= hi)) bad(`${what} is out of range`);
  return x;
}

/** the ranges of what a body may be: G x mass up to that of 10⁴ Suns (m³/s²), radius up to 70 AU (m), a place within 10⁵ light years (m), a speed below light's (m/s), J₂R² (m²) */
const GM_MOST = 1.33e24, RADIUS_MOST = 1e13, PLACE_MOST = 1e21, SPEED_MOST = 299_792_458, ZON_MOST = 1e18;
/** dates: within a hundred million years of J2000 (TDB Julian), and a simulation's time within that (s) */
const JD_RANGE: readonly [number, number] = [2451545 - 3.7e10, 2451545 + 3.7e10];
const TIME_MOST = 3.2e15;

/**
 * Read the changed universe from bytes (unpacked). Throws WorldError, with a few plain words, if it
 * is not one, is damaged, or holds anything out of range. The structure is read in two passes over
 * the same bytes: once to find where the doubles begin, once for real.
 */
export function decodeWorld(bytes: Uint8Array): LiveWorld {
  if (bytes.length > WORLD_BYTES_MOST) bad('it is too large');
  // the first pass walks the structure alone (no doubles are read), to find where the doubles begin
  const first = new Reader(bytes);
  walk(first, true);
  // (the doubles, byte plane by byte plane, from where the structure ends; then the structure again, taking them in turn)
  const doubles = new Reader(bytes);
  doubles.seek(first.offset);
  doubles.doublesFrom();
  return walk(new Reader(bytes), false, doubles);
}

/**
 * The walk over the structure. `dry`: the doubles are not read (the first pass: they are after the
 * structure, and how many there are follows from it); otherwise each is taken from `doubles`.
 */
function walk(r: Reader, dry: boolean, doubles?: Reader): LiveWorld {
  const f = (lo: number, hi: number, what: string) => (dry ? 0 : within(doubles!.f64(), lo, hi, what));
  if (r.u8() !== WORLD_FORMAT) bad('its changed universe is of a form this app does not know');
  const jd0 = f(JD_RANGE[0], JD_RANGE[1], 'the date it left the real universe');
  const time = f(-TIME_MOST, TIME_MOST, 'the time of its simulation');
  const nextId = r.uint(2 ** 31);
  const railsBelow = f(0, 1e15, 'a setting of its simulation'), lightRailsBelow = f(0, 1e15, 'a setting of its simulation'), railsCross = f(0, 1, 'a setting of its simulation');
  const steps = r.uint(1024);
  const edge = f(1, Infinity, 'a setting of its simulation');
  if (steps < 1) bad('a setting of its simulation is out of range');
  const n = r.uint(WORLD_LIMITS.bodies), asBody: number[] = [];
  const sim: NBodyBodies = { time, nextId, ids: [], gm: [], radius: [], rs: [], zon: [], pole: [], free: [], pin: [], around: [], x: [], v: [], railsBelow, lightRailsBelow, railsCross, steps, edge };
  for (let i = 0; i < n; i++) {
    sim.ids.push(r.uint(2 ** 31 - 1));
    const flags = r.u8();
    if (flags > 127 || (flags & 3) === 3) bad('the state of a body in it could not be read');
    sim.free.push(flags & 3);
    sim.pin.push((flags >> 2) & 1);
    asBody.push(flags >> 5);
    sim.around.push(r.int());
    sim.gm.push(flags & 32 ? 0 : f(0, GM_MOST, 'a mass in it'));
    sim.radius.push(flags & 64 ? 0 : f(0, RADIUS_MOST, 'a size in it'));
    sim.rs.push(flags & 16 ? f(0, RADIUS_MOST, 'a size in it') : 0);
    if (flags & 8) {
      sim.zon.push(f(0, ZON_MOST, 'a bulge in it'));
      const pole = [f(-1.01, 1.01, 'a pole in it'), f(-1.01, 1.01, 'a pole in it'), f(-1.01, 1.01, 'a pole in it')];
      if (!dry && Math.abs(Math.hypot(pole[0], pole[1], pole[2]) - 1) > 1e-6) bad('a pole in it is not a direction');
      sim.pole.push(...pole);
    } else sim.pole.push(0, 0, 0), sim.zon.push(0);
    for (let c = 0; c < 3; c++) sim.x.push(f(-PLACE_MOST, PLACE_MOST, 'a place in it'));
    for (let c = 0; c < 3; c++) sim.v.push(f(-SPEED_MOST, SPEED_MOST, 'a speed in it'));
  }
  const families = r.uint(WORLD_LIMITS.families), carried: [number, number[]][] = [];
  for (let k = 0; k < families; k++) {
    const id = r.uint(2 ** 31 - 1), m = r.uint(WORLD_LIMITS.family), moons: number[] = [];
    for (let j = 0; j < m; j++) moons.push(r.uint(2 ** 31 - 1));
    carried.push([id, moons]);
  }
  const nm = r.uint(WORLD_LIMITS.made), made: MadeRecord[] = [];
  for (let k = 0; k < nm; k++) {
    const id = MADE_FIRST_ID + r.uint(100_000), kindAt = r.u8();
    if (kindAt >= KINDS.length) bad('a world made in it is of no kind this app makes');
    const kind = KINDS[kindAt], name = r.text(WORLD_LIMITS.name);
    if (!plainName(name)) bad('the name of a world made in it is not plain text');
    const home = r.uint(2 ** 31 - 1), icyAt = r.u8();
    // (a world of a generated look is never an icy moon: 0, or 2 with rings; any other world 0, or 1 an icy moon)
    if (isWorldKind(kind) ? icyAt !== 0 && icyAt !== 2 : icyAt > 1) bad('a world made in it could not be read');
    const rings = (icyAt & 2) === 2;
    const seed = isWorldKind(kind) ? r.uint(SEED_MOST - 1) : 0;
    const kg = f(1, GM_MOST / 6.674e-11, 'the mass of a world made in it'), gm = f(0, GM_MOST, 'the mass of a world made in it'), radius = f(1, RADIUS_MOST, 'the size of a world made in it');
    const teff = kind === 'sun' ? f(100, 1e6, 'the colour of a sun made in it') : 0, absMag = kind === 'sun' ? f(-30, 40, 'the light of a sun made in it') : 0;
    made.push({ id, kind, name, home, icy: (icyAt & 1) === 1, kg, gm, radius, teff, absMag, ...(isWorldKind(kind) ? { seed } : {}), ...(rings ? { rings: true } : {}) });
  }
  const ng = r.uint(WORLD_LIMITS.gone), gone: number[] = [];
  for (let k = 0; k < ng; k++) gone.push(r.uint(2 ** 31 - 1));
  const nc = r.uint(WORLD_LIMITS.changed), changed: [number, number, number][] = [];
  for (let k = 0; k < nc; k++) changed.push([r.uint(2 ** 31 - 1), f(0, GM_MOST, 'a mass in it'), f(1, RADIUS_MOST, 'a size in it')]);
  const nl = r.uint(WORLD_LIMITS.log), log: { jd: number; text: string }[] = [];
  for (let k = 0; k < nl; k++) {
    const jd = f(JD_RANGE[0], JD_RANGE[1], 'a date in it'), text = r.text(WORLD_LIMITS.line);
    if (!plainLine(text)) bad('a line of what happened in it is not plain text');
    log.push({ jd, text });
  }
  if (!dry && doubles!.doublesLeft !== 0) bad('it has numbers left over');
  return { jd0, sim, carried, made, gone, changed, log, asBody };
}

// ---------------------------------------------------------------- base64url

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Bytes in base64url, without padding (RFC 4648 §5): letters, digits, '-' and '_', safe in a link as they are. */
export function toBase64Url(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const x = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(x >> 18) & 63] + B64[(x >> 12) & 63];
    if (i + 1 < b.length) out += B64[(x >> 6) & 63];
    if (i + 2 < b.length) out += B64[x & 63];
  }
  return out;
}

/** base64url back to bytes; null if it is not (a character outside the alphabet, a length that cannot be). */
export function fromBase64Url(s: string): Uint8Array | null {
  if (s.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : 0));
    const x = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out[o++] = (x >> 16) & 255;
    if (i + 2 < s.length) out[o++] = (x >> 8) & 255;
    if (i + 3 < s.length) out[o++] = x & 255;
  }
  return out.subarray(0, o);
}
