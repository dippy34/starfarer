import { keplerDrift } from './KeplerDrift';
import { G } from './physics';

/**
 * Gravity for real: a system of bodies, each pulling on every other, stepped through time. Plain
 * numbers and typed arrays in SI units, nothing allocated per step, so the whole of it can run in
 * a Web Worker and be saved and restored exactly. Not tied to the Solar System: a star's planets,
 * two suns, a black hole and its companion are all the same to it. (SystemSim.ts starts it from
 * the app's bodies; docs/notes/gravity-engine.md has the measurements and the reasons.)
 *
 * The scheme. The bodies are arranged in a hierarchy of pairs: a moon and its planet, that pair
 * and the next moon out, a planet's whole family and the Sun's inner worlds, and so on to the one
 * pair that is the whole system (generalised Jacobi coordinates). The energy of the system is then
 * exactly the sum of one two-body orbit per pair, each cluster moving as if it were a point at its
 * centre of mass, plus a remainder: everything the pairs do not account for. A step is half the
 * motion of every pair along its exact two-body orbit (KeplerDrift.ts), a kick by the remainder,
 * and the other half: the mapping of Wisdom and Holman (1991) on the hierarchy of Beust (2003),
 * with the corrector of Wisdom, Holman and Touma (1996). It is symplectic and reversible; its
 * error is the remainder times the step to the fourth power plus the remainder squared times the
 * step squared, so a month inside a year inside thousands of years costs nothing extra: each is
 * one exact orbit, and only what disturbs it is approximated.
 *
 * The hierarchy is found, not given: clusters are joined by the measure of Laplace's sphere of
 * influence (see `measure`), whatever the bodies are. It is looked at again every few hundred
 * steps, whenever two bodies come near, and whenever a pair grows looser than the pair holding
 * it, and changes when another pairing is better by a clear margin: a close encounter turns into
 * one exact hyperbola, a capture into one exact ellipse. The step follows the quickest orbit, and
 * shortens in an encounter as the remainder starts to change fast (VARY): energy crosses a change
 * of hierarchy without a jump.
 *
 * What is approximate is in LEFT_OUT, and what is approximated now in `report()`.
 */

export interface BodyInit {
  /** a number of its own (the app's Body.id); one is given if left out */
  id?: number;
  /** G times its mass (m³/s²); 0 for a body that is pulled but does not pull */
  gm: number;
  /** radius (m): two bodies whose spheres meet merge */
  radius: number;
  /** Schwarzschild radius (m) of a black hole, whose pull is then Paczyński–Wiita's; left out: Newton's */
  rs?: number;
  /** a flattened body's equatorial bulge: J₂ at the reference radius (m), about the pole (a unit vector, in the frame of `pos`) */
  zonal?: { j2: number; radius: number; pole: ArrayLike<number> };
  /**
   * What goes round this body is always stepped, never carried on rails (see `railsBelow`). For a
   * star: what its planets do to one another over thousands of turns is what a long run is for.
   */
  stepped?: boolean;
  /** position (m) and velocity (m/s) in any one inertial frame */
  pos: ArrayLike<number>;
  vel: ArrayLike<number>;
}

export type SimEvent =
  /**
   * two bodies met and are one: `survivor` (a black hole, else the heavier) now has their mass,
   * momentum and volume. `speed`: of the impact (m/s); `heat`: its energy, ½μv² (J); `distance`:
   * between their centres (m). All three as the two touched, whenever in its step the simulation
   * made them one: the speed is the one their fall gives at that distance (for a black hole, whose
   * pull so near is not Newton's, they are as the two were when made one). The pull between
   * them, −Gm₁m₂/distance, leaves the simulation's account with the heat: it is the merged body's
   * own binding now.
   */
  | { kind: 'collision'; time: number; survivor: number; absorbed: number; speed: number; heat: number; distance: number }
  /** two bodies (or families, named by their heaviest member) passed each other on an open orbit */
  | { kind: 'encounter'; time: number; a: number; b: number; distance: number; speed: number }
  /** these bodies (a family, `primary` its heaviest) are no longer bound to the rest and are leaving */
  | { kind: 'unbound'; time: number; primary: number; ids: number[] }
  /** an unbound family has passed the edge (`edge`): it is gone for good */
  | { kind: 'escape'; time: number; primary: number; ids: number[] }
  /** the body `id` goes round `around` now (a capture, or a moon lost to its star), where it went round `was` (-1: nothing) */
  | { kind: 'orbit'; time: number; id: number; around: number; was: number };

/**
 * What the simulation leaves out or does in a simpler way, always: in plain words, for the app to
 * show as they are. (The same, with the numbers: docs/notes/gravity-engine.md.)
 */
export const LEFT_OUT: readonly string[] = [
  'Every body pulls as if all its mass were at its centre. The giant planets\' bulging equators are counted, but nothing has tides, and nothing spins up or slows down.',
  'Gravity is Newton\'s. Einstein\'s corrections are left out (Mercury\'s orbit turns a little more slowly here than it really does), except close to a black hole.',
  'A world whose mass nobody has measured is pulled by everything and pulls on nothing.',
  'Two bodies that touch become one at once, with their mass and their motion added up. Nothing breaks apart, melts or throws out debris.',
  'When time runs fast, close families (a planet and its moons) are carried on rails: each moon keeps the oval it was on, nothing else pulls on it until something comes near, and moons whose paths cross pass each other untouched.',
];

export interface SimReport {
  time: number;
  /** the step in use (s); Infinity when nothing needs stepping */
  step: number;
  /** what sets it: an orbit's pace (`pacedBy` goes round on it), an encounter under way (how fast the pulls change), bodies about to touch */
  setBy: 'orbit' | 'encounter' | 'contact' | 'nothing';
  /** the body whose orbit is the quickest stepped, or -1 */
  pacedBy: number;
  /** families carried as one mass, their members on fixed orbits inside (see `railsBelow`) */
  rails: { primary: number; members: number[] }[];
  /** bodies whose step follows them in and out (eccentric or open orbits) */
  following: number[];
  /** how many bodies have no mass (see `LEFT_OUT`) */
  light: number;
  /** two-body solutions that did not settle (stays 0) */
  misses: number;
}

const TWO_PI = 2 * Math.PI;
/** the third-order corrector of Wisdom, Holman and Touma (1996): its drift and its kick, in steps */
const CORRECT_A = Math.sqrt(7 / 40), CORRECT_B = Math.sqrt(5 / 14) / 24;

/** a new step is chosen this much shorter than asked for, and kept while what is asked for stays within SLACK of it */
const MARGIN = 1.15, SLACK = 1.6;
/**
 * A kick gives the remainder as it is where the kick is given, for the whole step; meanwhile it
 * changes. The step is kept so short that in one it changes by no more than VARY / `steps` of
 * the pull the orbit is made of (a light body's own step likewise). In a quiet system the orbits'
 * pace sets the step and this never does (the Moon's remainder, the largest in the Solar System,
 * changes by about half of it); in an encounter it does, from well before the bodies are close.
 */
const VARY = 0.04;
/** beyond this eccentricity, and on open orbits, the step follows the body in and out */
const E_FOLLOW = 0.5;
/**
 * The hierarchy changes only for a pairing nearer than this part of the distance at which the one
 * in use would give way (on the pairing measure, below, its fifth power)
 */
const STICK = 0.85, STICK5 = STICK ** 5;
/** a pair that has been looked at is looked at again when it has come this much closer */
const RELAX = 0.8;
/** within this many times the sum of two radii the step follows the pair */
const CONTACT = 4;
/** on rails, the orbits of members lighter than this part of their family may cross, unless told otherwise (`railsCross`; Pluto's small moons are 1 to 3 millionths of it) */
const CROSS = 1e-5;
/** a family goes on rails only if it reaches less than this part of its Hill sphere... */
const HILL_SHARE = 0.5;
/** ...and comes off them when a body comes within this many times its size, or takes it into its own Hill sphere */
const GUARD = 3;
/** the hierarchy and the step are looked at again every so many steps (a power of two) */
const REVIEW = 256;
/** who has left and who goes round whom is looked at every so many steps (a power of two) */
const CENSUS = 32;
/** light bodies step at most 2^this times the common step */
const LEVELS = 20;

// what a place in the hierarchy is: a pair being stepped, a body, a family on rails, or inside one
const ACTIVE = 0, UNIT = 1, FROZEN = 2, INSIDE = 3;
// a light body: stepped, or carried on its orbit
const LIVE = 0, RAILS = 1;
// what a stepped pair is watched for: touching, an open orbit's closest pass, its pace, parting
const TOUCH = 1, OPEN = 2, FOLLOW = 4, FAR = 8;

/** Everything that persists: a copy of it is a snapshot. */
interface State {
  n: number; nextId: number; layout: number;
  id: Int32Array; gm: Float64Array; radius: Float64Array; rs: Float64Array;
  /** J₂ times the reference radius squared (m²), and the pole it is about (three numbers a body) */
  zon: Float64Array; pole: Float64Array;
  /** 0 bound, 1 unbound (announced), 2 past the edge (announced) */
  free: Uint8Array;
  /** 1: no family of which this body is the heaviest goes on rails (`BodyInit.stepped`) */
  pin: Uint8Array;
  /** the body each goes round, as last told (-1 nothing, -2 not yet known) */
  around: Int32Array;
  /** where a body is kept: its leaf of the hierarchy (>= 0), or -1 - its number among the light bodies */
  slot: Int32Array;
  /** the bodies' positions and velocities at `at`: what a plan is made from (valid while `dirty`) */
  x: Float64Array; v: Float64Array;
  dirty: boolean; planned: boolean;
  /** the time shown, the time the hierarchy's state is at, and the grid of steps: at = t0 + tick h */
  time: number; at: number; t0: number; tick: number; h: number;
  /**
   * how fast the remainders change (the part of an orbit's own pull, a second; see VARY): `rate`
   * as the step was last chosen from it, `seen` the most since the last review, in `span` steps
   */
  rate: number; seen: number; span: number;
  /** the centre of mass of what pulls, at `cmT`, and its velocity */
  cm: Float64Array; cmT: number;
  // the hierarchy: leaves 0..nm-1 (bodies that pull), then pairs in the order they were joined
  nm: number; nn: number;
  leaf: Int32Array;
  cA: Int32Array; cB: Int32Array; par: Int32Array; top: Int32Array;
  ngm: Float64Array; fa: Float64Array; fb: Float64Array;
  /** the pairing measure (see `measure`) at which a pair was joined; 0 for a leaf */
  tie: Float64Array;
  /** a pair's separation and relative velocity (B - A), its acceleration beyond two-body, and when that state is of */
  jr: Float64Array; jv: Float64Array; ja: Float64Array; jt: Float64Array;
  /** centres of mass about the system's: position, velocity, acceleration */
  cx: Float64Array; cv: Float64Array; ca: Float64Array;
  /** what a pair is watched for, the distance at which its two touch, and at which they would rather be apart */
  kind: Uint8Array; watch: Uint8Array; touch: Float64Array; far: Float64Array;
  // what is stepped: pairs (bottom up) and units (bodies and families on rails), in the order of the tree
  na: number; an: Int32Array;
  nu: number; un: Int32Array; unitOf: Int32Array; lo: Int32Array; hi: Int32Array;
  ux: Float64Array; uxp: Float64Array; ua: Float64Array; ud: Float64Array;
  ugm: Float64Array; urad: Float64Array; urs: Float64Array; uzon: Float64Array; upole: Float64Array;
  near: Float64Array;
  // light bodies: state about the centre of the cluster they go round
  np: number;
  pbody: Int32Array; phost: Int32Array;
  pr: Float64Array; pv: Float64Array; pa: Float64Array; pt: Float64Array;
  plevel: Uint8Array; pmode: Uint8Array; pflag: Uint8Array;
  /** how fast a light body's remainder changed over its last step (as `rate`) */
  prate: Float64Array;
}

// the last pull worked out by `bulge`
let bx = 0, by = 0, bz = 0;

/**
 * The pull of a flattened body's equatorial bulge at offset d from it, per unit of its GM (into
 * bx, by, bz): −∇ of J₂R² P₂(u) / r³, that is −(3/2) J₂R² / r⁵ ((1 − 5u²) d + 2 (d·p) p), where
 * p is its pole (at offset `o` of `pole`) and u = d·p / r the sine of the latitude.
 */
function bulge(zon: number, pole: Float64Array, o: number, dx: number, dy: number, dz: number, r2: number): void {
  const px = pole[o], py = pole[o + 1], pz = pole[o + 2];
  const z = dx * px + dy * py + dz * pz, k = (-1.5 * zon) / (r2 * r2 * Math.sqrt(r2)), f = 1 - (5 * z * z) / r2;
  bx = k * (f * dx + 2 * z * px); by = k * (f * dy + 2 * z * py); bz = k * (f * dz + 2 * z * pz);
}

/** J₂R² P₂(u) of a bulge seen at offset d (either way: P₂ is even), u the sine of the latitude; 0 for no bulge */
function level(zon: number, pole: Float64Array, o: number, dx: number, dy: number, dz: number, r: number): number {
  if (!(zon > 0)) return 0;
  const u = (dx * pole[o] + dy * pole[o + 1] + dz * pole[o + 2]) / r;
  return zon * (1.5 * u * u - 0.5);
}

// the last orbit worked out by `conic`
let oBound = false, oOut = false, oFollow = false;
let oPeriod = 0, oPeri = 0, oApo = 0, oPace = 0, oSpeed = 0;

/**
 * The two-body orbit of the state at offset `o` about `mu`: closed or open, its period, nearest
 * and farthest distance, the speed at the nearest, and its pace: the time one turn would take at
 * the rate the body is turning (at periapsis for a mildly eccentric closed orbit: a constant; else
 * where it is now, and never slower than falling from rest would be).
 */
function conic(r: Float64Array, v: Float64Array, o: number, mu: number): void {
  const x = r[o], y = r[o + 1], z = r[o + 2], vx = v[o], vy = v[o + 1], vz = v[o + 2];
  const r2 = x * x + y * y + z * z, v2 = vx * vx + vy * vy + vz * vz;
  const rr = Math.sqrt(r2);
  if (!(mu > 0) || !(rr > 0)) {
    oBound = false; oOut = true; oFollow = true; oPeriod = oApo = oPace = Infinity; oPeri = rr; oSpeed = Math.sqrt(v2);
    return;
  }
  const en = 0.5 * v2 - mu / rr;
  const hx = y * vz - z * vy, hy = z * vx - x * vz, hz = x * vy - y * vx;
  const h2 = hx * hx + hy * hy + hz * hz;
  const e = Math.sqrt(Math.max(0, 1 + (2 * en * h2) / (mu * mu)));
  oPeri = h2 / (mu * (1 + e));
  oSpeed = oPeri > 0 ? Math.sqrt((mu * (1 + e)) / oPeri) : Infinity;
  oBound = en < 0;
  oOut = x * vx + y * vy + z * vz > 0;
  if (oBound) {
    const a = -mu / (2 * en);
    oPeriod = TWO_PI * Math.sqrt((a * a * a) / mu);
    oApo = 2 * a - oPeri;
  } else oPeriod = oApo = Infinity;
  oFollow = !oBound || e > E_FOLLOW;
  oPace = oFollow ? TWO_PI * Math.min(Math.sqrt(r2 / v2), Math.sqrt((r2 * rr) / mu)) : TWO_PI * oPeri / oSpeed;
}

function copyState(s: State): State {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(s)) out[k] = ArrayBuffer.isView(val) ? (val as Float64Array).slice() : val;
  return out as unknown as State;
}

export type NBodySnapshot = Readonly<Record<string, unknown>>;

/**
 * The simulation as its bodies are, settled at `time` (see `settle`): what a new simulation needs
 * to go on exactly as this one does after a change, and no more (the hierarchy, the step and the
 * rest are planned again from it, as after any change). Plain numbers, per body in the order of
 * `ids`: what a link carries (src/app/SceneWorld.ts), where `snapshot` is for this machine alone.
 */
export interface NBodyBodies {
  time: number;
  nextId: number;
  ids: number[];
  /** G x mass (m³/s²), radius and Schwarzschild radius (m), J₂R² (m²) and the pole it is about (three numbers a body) */
  gm: number[]; radius: number[]; rs: number[]; zon: number[]; pole: number[];
  /** 0 bound, 1 told unbound, 2 told past the edge; 1: what goes round it is always stepped; what it goes round, as last told (-1 nothing, -2 not yet known) */
  free: number[]; pin: number[]; around: number[];
  /** positions (m) and velocities (m/s), three numbers a body */
  x: number[]; v: number[];
  railsBelow: number; lightRailsBelow: number; railsCross: number; steps: number; edge: number;
}

export class NBody {
  /** positions (m) and velocities (m/s) of the bodies at `time`, three numbers each: filled by `read()` */
  pos = new Float64Array(0);
  vel = new Float64Array(0);
  /** what has happened since they were last taken (`takeEvents`) */
  events: SimEvent[] = [];
  /**
   * Steps to a turn: the step is this part of the time the fastest stepped orbit takes round its
   * periapsis. More is slower and more exact, as the fourth power of the step where the remainder
   * is small (the corrector takes the square away). A change is taken up at the next look.
   */
  get steps(): number { return this.perTurn; }
  set steps(n: number) {
    if (n === this.perTurn) return;
    this.perTurn = n;
    this.review = true;
  }
  /** an unbound body farther than this (m) from what it left is gone for good; its leaving is an event */
  edge = Infinity;
  /** the clock the budget of `advance` is measured on (ms) */
  now: () => number = () => performance.now();
  /** two-body solutions that did not settle */
  misses = 0;

  private s: State = {
    n: 0, nextId: 1, layout: 0,
    id: new Int32Array(0), gm: new Float64Array(0), radius: new Float64Array(0), rs: new Float64Array(0),
    zon: new Float64Array(0), pole: new Float64Array(0), free: new Uint8Array(0), pin: new Uint8Array(0), around: new Int32Array(0),
    slot: new Int32Array(0), x: new Float64Array(0), v: new Float64Array(0),
    dirty: true, planned: false,
    time: 0, at: 0, t0: 0, tick: 0, h: Infinity, rate: 0, seen: 0, span: 0,
    cm: new Float64Array(6), cmT: 0,
    nm: 0, nn: 0,
    leaf: new Int32Array(0), cA: new Int32Array(0), cB: new Int32Array(0), par: new Int32Array(0), top: new Int32Array(0),
    ngm: new Float64Array(0), fa: new Float64Array(0), fb: new Float64Array(0), tie: new Float64Array(0),
    jr: new Float64Array(0), jv: new Float64Array(0), ja: new Float64Array(0), jt: new Float64Array(0),
    cx: new Float64Array(0), cv: new Float64Array(0), ca: new Float64Array(0),
    kind: new Uint8Array(0), watch: new Uint8Array(0), touch: new Float64Array(0), far: new Float64Array(0),
    na: 0, an: new Int32Array(0),
    nu: 0, un: new Int32Array(0), unitOf: new Int32Array(0), lo: new Int32Array(0), hi: new Int32Array(0),
    ux: new Float64Array(0), uxp: new Float64Array(0), ua: new Float64Array(0), ud: new Float64Array(0),
    ugm: new Float64Array(0), urad: new Float64Array(0), urs: new Float64Array(0),
    uzon: new Float64Array(0), upole: new Float64Array(0), near: new Float64Array(0),
    np: 0,
    pbody: new Int32Array(0), phost: new Int32Array(0),
    pr: new Float64Array(0), pv: new Float64Array(0), pa: new Float64Array(0), pt: new Float64Array(0),
    plevel: new Uint8Array(0), pmode: new Uint8Array(0), pflag: new Uint8Array(0), prate: new Float64Array(0),
  };

  // working room, of no lasting meaning: for pairing
  private wD = new Float64Array(0);
  private wNb = new Int32Array(0);
  private wNode = new Int32Array(0);
  private wAlive = new Uint8Array(0);
  private wA = new Int32Array(0);
  private wB = new Int32Array(0);
  private wOld = new Int32Array(0);
  private wTie = new Float64Array(0);
  private wX = new Float64Array(0);
  private wGm = new Float64Array(0);
  // for deciding what is stepped
  private wExt = new Float64Array(0);
  private wReach = new Float64Array(0);
  private wPeri = new Float64Array(0);
  private wPace = new Float64Array(0);
  private wOk = new Uint8Array(0);
  private wKind = new Uint8Array(0);
  private wStack = new Int32Array(0);
  private wFree = new Uint8Array(0);
  private wMode = new Uint8Array(0);
  private wPPace = new Float64Array(0);
  private wJa = new Float64Array(0);
  private wR = new Float64Array(0);
  private wV = new Float64Array(0);
  private wRl = new Float64Array(0);
  private wVl = new Float64Array(0);
  // pairs that came near in the last step, and bodies that met
  private flag = new Int32Array(0);
  private met: number[] = [];
  private review = false;
  // for reading out between steps: the arrays a read-out changes, and room to keep them meanwhile
  private live: Float64Array[] = [];
  private spare: Float64Array[] = [];
  private tmpR = new Float64Array(3);
  private tmpV = new Float64Array(3);
  private outAt = NaN;
  /** milliseconds a step has cost lately (for `fit`) */
  private cost = 0;
  private limit = 0;
  private lightLimit = 0;
  private cross = CROSS;
  private perTurn = 16;

  // ------------------------------------------------------------------ the bodies

  /**
   * Fidelity. Closed orbits with a period shorter than this (s) are carried on rails where nothing
   * disturbs them: the family moves as one mass and its members keep their two-body orbits inside
   * it, feeling nothing else. 0 (the default): everything pulls on everything.
   */
  get railsBelow(): number { return this.limit; }
  set railsBelow(seconds: number) {
    if (seconds === this.limit) return;
    this.limit = seconds;
    this.review = true;
  }
  /**
   * The same for the bodies without a mass, where it is more than `railsBelow`: they disturb
   * nothing, so they are the first to be carried when time must run faster than everything can
   * be stepped.
   */
  get lightRailsBelow(): number { return this.lightLimit; }
  set lightRailsBelow(seconds: number) {
    if (seconds === this.lightLimit) return;
    this.lightLimit = seconds;
    this.review = true;
  }
  /**
   * On rails, the orbits of members lighter than this share of their family may cross one another
   * (they neither pull on nor hit each other there); a heavier member must stay clear of the rest
   * for its family to be carried. A hundred-thousandth unless set; 1: any member's may, and a
   * family whose moons have been thrown onto crossing orbits can be carried all the same, each
   * passing the others untouched. Every member must still clear the body it goes round.
   */
  get railsCross(): number { return this.cross; }
  set railsCross(share: number) {
    if (share === this.cross) return;
    this.cross = share;
    this.review = true;
  }

  get count(): number { return this.s.n; }
  /** goes up whenever the list of bodies changes (one added, removed or absorbed): what is kept by a body's place in the arrays is then stale */
  get layout(): number { return this.s.layout; }
  /** seconds since the simulation's own zero */
  get time(): number { return this.s.time; }
  /** numbers, G x masses (m³/s²), radii and Schwarzschild radii (m) of the bodies, in the order of `pos` */
  get ids(): Int32Array { return this.s.id.subarray(0, this.s.n); }
  /**
   * The number of the body each goes round, in the order of `pos`, as last looked at (at the
   * start, and every few steps: see the `orbit` event): -1 for nothing (it is the heaviest of what
   * it is bound to, or bound to nothing), -2 for a body added since.
   */
  get primaries(): Int32Array { return this.s.around.subarray(0, this.s.n); }
  get gm(): Float64Array { return this.s.gm.subarray(0, this.s.n); }
  get radius(): Float64Array { return this.s.radius.subarray(0, this.s.n); }
  get rs(): Float64Array { return this.s.rs.subarray(0, this.s.n); }

  /** Where the body numbered `id` is in the arrays, or -1. */
  indexOf(id: number): number {
    const s = this.s;
    for (let i = 0; i < s.n; i++) if (s.id[i] === id) return i;
    return -1;
  }

  /** A new body, from now on: returns its number. */
  add(b: BodyInit): number {
    this.settle();
    const s = this.s;
    const id = b.id ?? s.nextId;
    if (this.indexOf(id) >= 0) throw new Error(`a body ${id} is there already`);
    if (!(b.gm >= 0) || !(b.radius >= 0)) throw new Error(`body ${id}: mass and radius cannot be negative`);
    if (s.n === s.id.length) this.room(Math.max(8, 2 * s.n));
    const i = s.n++;
    s.nextId = Math.max(s.nextId, id + 1);
    s.id[i] = id; s.gm[i] = b.gm; s.radius[i] = b.radius; s.rs[i] = b.rs ?? 0; s.free[i] = 0; s.pin[i] = b.stepped ? 1 : 0; s.around[i] = -2;
    for (let c = 0; c < 3; c++) { s.x[3 * i + c] = b.pos[c]; s.v[3 * i + c] = b.vel[c]; }
    const z = b.zonal;
    s.zon[i] = z ? z.j2 * z.radius * z.radius : 0;
    const len = z ? Math.hypot(z.pole[0], z.pole[1], z.pole[2]) : 1;
    for (let c = 0; c < 3; c++) s.pole[3 * i + c] = z ? z.pole[c] / len : 0;
    s.planned = false;
    s.layout++;
    return id;
  }

  /** Take a body out, from now on. */
  remove(id: number): void {
    this.settle();
    const i = this.indexOf(id);
    if (i < 0) throw new Error(`no body ${id}`);
    this.drop(i);
  }

  /** Change a body's mass (G x mass, m³/s²), and its radius if given, from now on. */
  setMass(id: number, gm: number, radius?: number): void {
    this.settle();
    const s = this.s, i = this.indexOf(id);
    if (i < 0) throw new Error(`no body ${id}`);
    if (!(gm >= 0)) throw new Error(`body ${id}: mass cannot be negative`);
    if ((gm > 0) !== (s.gm[i] > 0)) s.planned = false;
    s.gm[i] = gm;
    if (radius !== undefined) s.radius[i] = radius;
  }

  /** Put a body somewhere else, moving otherwise, from now on. */
  setState(id: number, pos: ArrayLike<number>, vel: ArrayLike<number>): void {
    this.settle();
    const s = this.s, i = this.indexOf(id);
    if (i < 0) throw new Error(`no body ${id}`);
    for (let c = 0; c < 3; c++) { s.x[3 * i + c] = pos[c]; s.v[3 * i + c] = vel[c]; }
    s.free[i] = 0;
  }

  /** The events since the last call, oldest first. */
  takeEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private room(cap: number): void {
    const s = this.s;
    const grow = <T extends Int32Array | Float64Array | Uint8Array>(a: T, len: number): T => {
      const b = new (a.constructor as new (n: number) => T)(len);
      b.set(a);
      return b;
    };
    s.id = grow(s.id, cap); s.gm = grow(s.gm, cap); s.radius = grow(s.radius, cap); s.rs = grow(s.rs, cap);
    s.zon = grow(s.zon, cap); s.pole = grow(s.pole, 3 * cap);
    s.free = grow(s.free, cap); s.pin = grow(s.pin, cap); s.around = grow(s.around, cap); s.slot = grow(s.slot, cap); s.x = grow(s.x, 3 * cap); s.v = grow(s.v, 3 * cap);
  }

  private drop(i: number): void {
    const s = this.s;
    for (let j = i + 1; j < s.n; j++) {
      s.id[j - 1] = s.id[j]; s.gm[j - 1] = s.gm[j]; s.radius[j - 1] = s.radius[j]; s.rs[j - 1] = s.rs[j]; s.zon[j - 1] = s.zon[j]; s.free[j - 1] = s.free[j]; s.pin[j - 1] = s.pin[j]; s.around[j - 1] = s.around[j];
      for (let c = 0; c < 3; c++) s.pole[3 * j - 3 + c] = s.pole[3 * j + c];
      for (let c = 0; c < 3; c++) { s.x[3 * j - 3 + c] = s.x[3 * j + c]; s.v[3 * j - 3 + c] = s.v[3 * j + c]; }
    }
    s.n--;
    s.planned = false;
    s.layout++;
  }

  // ------------------------------------------------------------------ time

  /**
   * Move on by `dt` seconds (either sign), or by as much of it as fits in `budgetMs` milliseconds
   * of work (always at least one step). Returns the seconds moved: `time` has grown by exactly
   * that, so a caller that adds up what comes back never loses or repeats time. Where the bodies
   * are at `time` depends only on the changes made and when, not on how the way there was cut up.
   */
  advance(dt: number, budgetMs = Infinity): number {
    const s = this.s;
    const from = s.time, target = from + dt;
    const start = budgetMs < Infinity ? this.now() : 0;
    let steps = 0, over = false;
    for (;;) {
      this.ready();
      if (this.met.length) continue;
      // the state is kept at the kick nearest the time shown: within half a step either way
      const half = 0.5 * s.h;
      const way = s.h === Infinity ? 0 : target < s.at - half ? -1 : target >= s.at + half ? 1 : 0;
      if (way === 0) break;
      if (steps > 0 && budgetMs < Infinity && this.now() - start >= budgetMs) { over = true; break; }
      this.step(way);
      steps++;
      if ((s.tick & (REVIEW - 1)) === 0) this.review = true;
      else if ((s.tick & (CENSUS - 1)) === 0) this.census();
      // (the count of steps is kept small: light bodies' turns are read from its low bits)
      if (s.tick >= 1 << 24 || s.tick <= -(1 << 24)) { s.t0 = s.at; s.tick = 0; }
    }
    s.time = over ? s.at : target;
    if (steps > 0 && budgetMs < Infinity) {
      const each = (this.now() - start) / steps;
      this.cost = this.cost > 0 ? 0.8 * this.cost + 0.2 * each : each;
    }
    return s.time - from;
  }

  /**
   * Choose the fidelity for a rate of time: `rate` simulated seconds a second, of which the
   * stepping may cost `msPerSecond` milliseconds. Sets `railsBelow` to the shortest period that
   * can then still be stepped in full, from what a step has cost lately (so it depends on the
   * machine: a run that must repeat exactly sets `railsBelow` itself). Returns it.
   */
  fit(rate: number, msPerSecond: number): number {
    if (!(this.cost > 0)) return this.limit;
    const need = (Math.abs(rate) * this.cost * this.steps * MARGIN) / msPerSecond;
    // (not for every small change: each change of what is on rails is a small jolt)
    if (need > 1.5 * this.limit || need < this.limit / 1.5) this.railsBelow = need;
    return this.limit;
  }

  /**
   * Make `pos` and `vel` the bodies' state at exactly `time` (what `read()` gives) and make it the
   * one the simulation goes on from: before any change. It ends the run of equal steps (the next
   * `advance` starts a new one), so for showing the bodies use `read()`, which disturbs nothing.
   */
  settle(): void {
    const s = this.s;
    for (;;) {
      if (this.met.length) this.merge();
      if (s.dirty) {
        if (s.time === s.at) break;
        this.plan();
      } else this.cartesian(s.time);
    }
    this.out(s.x, s.v);
  }

  /** Bodies that met made one, the plan looked at if it was asked for, and a new one made if needed. */
  private ready(): void {
    if (this.met.length) this.merge();
    else if (this.review && !this.s.dirty) this.look();
    if (this.s.dirty) this.plan();
  }

  /** Look at the plan again, and have a new one made if it no longer fits. */
  private look(): void {
    this.review = false;
    if (this.stale()) this.cartesian(NaN);
  }

  /**
   * Fill `pos` and `vel` with the bodies' state at `time`, disturbing nothing: for showing them,
   * every frame (see `unmap`; worked on a copy).
   */
  read(): void {
    const s = this.s;
    if (s.dirty) { this.out(s.x, s.v); return; }
    if (this.outAt === s.time) return;
    const at = s.at;
    for (let i = 0; i < this.live.length; i++) this.spare[i].set(this.live[i]);
    this.unmap(s.time);
    this.compose(s.jr, s.jv, s.cx, s.cv);
    if (this.pos.length !== 3 * s.n) { this.pos = new Float64Array(3 * s.n); this.vel = new Float64Array(3 * s.n); }
    const pos = this.pos, vel = this.vel, cm = s.cm, lag = s.time - s.cmT;
    const tr = this.tmpR, tv = this.tmpV;
    for (let i = 0; i < s.n; i++) {
      const sl = s.slot[i];
      let host = sl;
      tr[0] = tr[1] = tr[2] = tv[0] = tv[1] = tv[2] = 0;
      if (sl < 0) {
        const p = -1 - sl;
        host = s.phost[p];
        this.lightAt(p, s.time, tr, tv, 0);
      }
      for (let c = 0; c < 3; c++) {
        pos[3 * i + c] = cm[c] + cm[3 + c] * lag + (host >= 0 ? s.cx[3 * host + c] : 0) + tr[c];
        vel[3 * i + c] = cm[3 + c] + (host >= 0 ? s.cv[3 * host + c] : 0) + tv[c];
      }
    }
    for (let i = 0; i < this.live.length; i++) this.live[i].set(this.spare[i]);
    s.at = at;
    this.outAt = s.time;
  }

  /**
   * The pairs' true state at `to` (within half a step of the kick the state is kept at), and the
   * pairs on rails along their orbits to it. At the middles either side of the kick the mapping's
   * variables are taken out by the corrector, which is exact there; anywhere else the stepped
   * pairs are put between those two true states: each along its two-body orbit from the earlier,
   * plus the departure from that orbit that the later one shows, as a cubic in time that starts
   * from none (Hermite's, from the departure's place and velocity at the end). That is exact for
   * a remainder that holds through the step, as smooth through the kick as anywhere else, and
   * meets the true states at both ends, so nothing jumps from one step to the next. (The
   * corrector's inverse at a time between the middles would be off by its own size, which for
   * the Moon is ten kilometres.)
   */
  private unmap(to: number): void {
    const s = this.s;
    if (s.na > 0 && s.h < Infinity) {
      const h = s.h, half = 0.5 * h, tau = to - s.at + half, an = s.an;
      const jr = s.jr, jv = s.jv;
      if (tau > 0) {
        // the later true state, kept aside; then the earlier, from where the state was
        this.wR.set(jr); this.wV.set(jv); this.wJa.set(s.ja);
        this.kick(h);
        this.drift(half, false);
        this.leave();
        this.wRl.set(jr); this.wVl.set(jv);
        jr.set(this.wR); jv.set(this.wV); s.ja.set(this.wJa);
      }
      this.drift(-half, false);
      this.leave();
      if (tau > 0) {
        const r = jr, v = jv, later = this.wRl, laterV = this.wVl, t = this.tmpR, tv = this.tmpV;
        const u = tau / h, h01 = u * u * (3 - 2 * u), h11 = u * u * (u - 1);
        const d01 = (6 * u * (1 - u)) / h, d11 = u * (3 * u - 2);
        for (let idx = 0; idx < s.na; idx++) {
          const k = an[idx], o = 3 * k;
          // the departure at the end: the later state less the earlier carried along its orbit
          keplerDrift(r, v, o, s.ngm[k], h, t, tv, 0);
          const px = later[o] - t[0], py = later[o + 1] - t[1], pz = later[o + 2] - t[2];
          const qx = h * (laterV[o] - tv[0]), qy = h * (laterV[o + 1] - tv[1]), qz = h * (laterV[o + 2] - tv[2]);
          if (!keplerDrift(r, v, o, s.ngm[k], tau)) this.misses++;
          r[o] += h01 * px + h11 * qx; r[o + 1] += h01 * py + h11 * qy; r[o + 2] += h01 * pz + h11 * qz;
          v[o] += d01 * px + (d11 * qx) / h; v[o + 1] += d01 * py + (d11 * qy) / h; v[o + 2] += d01 * pz + (d11 * qz) / h;
        }
      }
    }
    for (let k = s.nm; k < s.nn; k++) {
      if (s.kind[k] === ACTIVE || s.jt[k] === to) continue;
      if (!keplerDrift(s.jr, s.jv, 3 * k, s.ngm[k], to - s.jt[k])) this.misses++;
      s.jt[k] = to;
    }
    s.at = to;
  }

  /**
   * Light body `p` at time `t`, about the centre of what it goes round, written at offset `oo` of
   * `ro` and `vo`: one step of its own from where it was last stepped to, its pull held (on rails,
   * along its orbit).
   */
  private lightAt(p: number, t: number, ro: Float64Array, vo: Float64Array, oo: number): void {
    const s = this.s, o = 3 * p, dt = t - s.pt[p], host = s.phost[p];
    const mu = host >= 0 ? s.ngm[host] : 0;
    const live = s.pmode[p] === LIVE;
    const kx = live ? 0.5 * dt * s.pa[o] : 0, ky = live ? 0.5 * dt * s.pa[o + 1] : 0, kz = live ? 0.5 * dt * s.pa[o + 2] : 0;
    ro[oo] = s.pr[o]; ro[oo + 1] = s.pr[o + 1]; ro[oo + 2] = s.pr[o + 2];
    vo[oo] = s.pv[o] + kx; vo[oo + 1] = s.pv[o + 1] + ky; vo[oo + 2] = s.pv[o + 2] + kz;
    if (!keplerDrift(ro, vo, oo, mu, dt)) this.misses++;
    vo[oo] += kx; vo[oo + 1] += ky; vo[oo + 2] += kz;
  }

  private out(x: Float64Array, v: Float64Array): void {
    const n3 = 3 * this.s.n;
    if (this.pos.length !== n3) { this.pos = new Float64Array(n3); this.vel = new Float64Array(n3); }
    this.pos.set(x.subarray(0, n3));
    this.vel.set(v.subarray(0, n3));
    this.outAt = this.s.time;
  }

  // ------------------------------------------------------------------ the plan

  /** From the bodies' positions and velocities: the hierarchy, what is stepped and how, the first accelerations. */
  private plan(): void {
    const s = this.s;
    let nm = 0;
    for (let i = 0; i < s.n; i++) if (s.gm[i] > 0) nm++;
    const np = s.n - nm;
    const keep = s.planned && nm === s.nm && np === s.np;
    if (!keep) this.size(nm, np);
    // the centre of mass of what pulls, and the bodies about it
    const cm = s.cm;
    cm.fill(0);
    let total = 0;
    for (let i = 0, l = 0, p = 0; i < s.n; i++) {
      const g = s.gm[i];
      if (g > 0) { s.leaf[l] = i; s.slot[i] = l++; } else { s.pbody[p] = i; s.slot[i] = -1 - p++; }
      total += g;
      for (let c = 0; c < 3; c++) { cm[c] += g * s.x[3 * i + c]; cm[3 + c] += g * s.v[3 * i + c]; }
    }
    if (total > 0) for (let c = 0; c < 6; c++) cm[c] /= total;
    s.cmT = s.at;
    for (let l = 0; l < nm; l++) {
      const i = s.leaf[l];
      s.ngm[l] = s.gm[i];
      for (let c = 0; c < 3; c++) { s.cx[3 * l + c] = s.x[3 * i + c] - cm[c]; s.cv[3 * l + c] = s.v[3 * i + c] - cm[3 + c]; }
    }
    // the hierarchy: the one in use, if pairing the bodies afresh gives it again
    const same = !this.pair(keep) && keep;
    if (same) for (let k = nm; k < s.nn; k++) s.tie[this.wOld[k]] = this.wTie[k];
    else {
      for (let k = nm; k < s.nn; k++) { s.cA[k] = this.wA[k]; s.cB[k] = this.wB[k]; s.tie[k] = this.wTie[k]; }
      s.kind.fill(ACTIVE);
    }
    s.par.fill(-1);
    for (let l = 0; l < nm; l++) s.top[l] = l;
    for (let k = nm; k < s.nn; k++) {
      const A = s.cA[k], B = s.cB[k];
      s.par[A] = s.par[B] = k;
      s.ngm[k] = s.ngm[A] + s.ngm[B];
      s.fa[k] = s.ngm[A] / s.ngm[k]; s.fb[k] = s.ngm[B] / s.ngm[k];
      s.top[k] = s.top[s.ngm[A] >= s.ngm[B] ? A : B];
    }
    // each pair's separation and relative velocity, each cluster's centre, from the leaves up
    for (let k = nm; k < s.nn; k++) {
      const A = 3 * s.cA[k], B = 3 * s.cB[k], o = 3 * k, fa = s.fa[k], fb = s.fb[k];
      for (let c = 0; c < 3; c++) {
        s.jr[o + c] = s.cx[B + c] - s.cx[A + c]; s.jv[o + c] = s.cv[B + c] - s.cv[A + c];
        s.cx[o + c] = fa * s.cx[A + c] + fb * s.cx[B + c]; s.cv[o + c] = fa * s.cv[A + c] + fb * s.cv[B + c];
      }
      s.jt[k] = s.at;
    }
    // each light body about the cluster it goes round
    for (let p = 0; p < np; p++) {
      const i = s.pbody[p], o = 3 * p;
      const px = s.x[3 * i] - cm[0], py = s.x[3 * i + 1] - cm[1], pz = s.x[3 * i + 2] - cm[2];
      const host = this.host(px, py, pz, same ? s.phost[p] : -1);
      s.phost[p] = host;
      for (let c = 0; c < 3; c++) {
        s.pr[o + c] = s.x[3 * i + c] - cm[c] - (host >= 0 ? s.cx[3 * host + c] : 0);
        s.pv[o + c] = s.v[3 * i + c] - cm[3 + c] - (host >= 0 ? s.cv[3 * host + c] : 0);
      }
      s.pt[p] = s.at;
      s.pflag[p] = 0;
    }
    this.rails();
    s.kind.set(this.wKind.subarray(0, s.nn));
    s.pmode.set(this.wMode.subarray(0, np));
    this.arrange();
    // the pulls where the bodies are (and a look at who touches already), and from them the step
    this.forces(true);
    for (let p = 0; p < np; p++) if (s.pmode[p] === LIVE) this.pull(p);
    this.prior();
    const want = this.want();
    if (!(want >= s.h && want <= SLACK * s.h)) s.h = want / MARGIN;
    for (let p = 0; p < np; p++) s.plevel[p] = Math.max(0, this.level(this.wPPace[p], s.prate[p]));
    s.dirty = false; s.planned = true;
    this.review = false;
    // the pairs go into the mapping's own variables and on to their first kick, half a step from
    // here; the light bodies come along
    if (s.na > 0 && s.h < Infinity) {
      this.enter();
      this.drift(0.5 * s.h, false);
      s.at += 0.5 * s.h;
    }
    s.t0 = s.at; s.tick = 0;
    this.forces(false);
    s.uxp.set(s.ux);
    this.light(true);
    this.census();
    this.outAt = NaN;
  }

  private size(nm: number, np: number): void {
    const s = this.s;
    const nn = nm > 0 ? 2 * nm - 1 : 0;
    s.nm = nm; s.nn = nn; s.np = np;
    s.leaf = new Int32Array(nm);
    s.cA = new Int32Array(nn).fill(-1); s.cB = new Int32Array(nn).fill(-1); s.par = new Int32Array(nn).fill(-1); s.top = new Int32Array(nn);
    s.ngm = new Float64Array(nn); s.fa = new Float64Array(nn); s.fb = new Float64Array(nn); s.tie = new Float64Array(nn);
    s.jr = new Float64Array(3 * nn); s.jv = new Float64Array(3 * nn); s.ja = new Float64Array(3 * nn); s.jt = new Float64Array(nn);
    s.cx = new Float64Array(3 * nn); s.cv = new Float64Array(3 * nn); s.ca = new Float64Array(3 * nn);
    s.kind = new Uint8Array(nn); s.watch = new Uint8Array(nn); s.touch = new Float64Array(nn); s.far = new Float64Array(nn);
    s.an = new Int32Array(nn); s.un = new Int32Array(nm); s.unitOf = new Int32Array(nn); s.lo = new Int32Array(nn); s.hi = new Int32Array(nn);
    s.ux = new Float64Array(3 * nm); s.uxp = new Float64Array(3 * nm); s.ua = new Float64Array(3 * nm); s.ud = new Float64Array(nm);
    s.ugm = new Float64Array(nm); s.urad = new Float64Array(nm); s.urs = new Float64Array(nm); s.near = new Float64Array(nm * nm);
    s.uzon = new Float64Array(nm); s.upole = new Float64Array(3 * nm);
    s.pbody = new Int32Array(np); s.phost = new Int32Array(np);
    s.pr = new Float64Array(3 * np); s.pv = new Float64Array(3 * np); s.pa = new Float64Array(3 * np); s.pt = new Float64Array(np);
    s.plevel = new Uint8Array(np); s.pmode = new Uint8Array(np); s.pflag = new Uint8Array(np); s.prate = new Float64Array(np);
    this.workroom();
  }

  /** Working arrays for the hierarchy and the light bodies there are. */
  private workroom(): void {
    const s = this.s, nm = s.nm, nn = s.nn, np = s.np;
    this.wD = new Float64Array(nm * nm); this.wNb = new Int32Array(nm); this.wNode = new Int32Array(nm); this.wAlive = new Uint8Array(nm);
    this.wA = new Int32Array(nn); this.wB = new Int32Array(nn); this.wOld = new Int32Array(nn);
    this.wTie = new Float64Array(nn); this.wX = new Float64Array(3 * nn); this.wGm = new Float64Array(nn);
    this.wExt = new Float64Array(nn); this.wReach = new Float64Array(nn); this.wPeri = new Float64Array(nn); this.wPace = new Float64Array(nn);
    this.wOk = new Uint8Array(nn); this.wKind = new Uint8Array(nn); this.wStack = new Int32Array(2 * nn + 2);
    this.wMode = new Uint8Array(np); this.wPPace = new Float64Array(np); this.wJa = new Float64Array(3 * nn);
    this.wR = new Float64Array(3 * nn); this.wV = new Float64Array(3 * nn); this.wRl = new Float64Array(3 * nn); this.wVl = new Float64Array(3 * nn);
    this.flag = new Int32Array(8 * nm + 8);
    this.live = [s.jr, s.jv, s.ja, s.jt, s.cx, s.cv, s.ca, s.ux, s.uxp, s.ua, s.ud];
    this.spare = this.live.map((a) => new Float64Array(a.length));
  }

  /**
   * The pairing measure of two clusters r apart, r⁵ / (G(m₁ + m₂))²: less if they are a pair
   * already. Of two ways to describe a body, going round a mass m at distance r or going round a
   * mass M at distance d with m as a disturbance, the first leaves the smaller disturbance (the
   * tide of M against the pull of m) inside m's sphere of influence, r < d (m/M)^⅖ (Laplace), and
   * that is where this measure for the pair (body, m) falls below the one for (m, M). (By
   * dynamical time, r³ / Gm, the change would come at the Hill sphere going in and far beyond
   * the sphere of influence coming out, the disturbance kept up to many times the pull it is a
   * disturbance of.)
   */
  private measure(i: number, j: number, sticky: boolean): number {
    const a = this.wNode[i], b = this.wNode[j], X = this.wX;
    const dx = X[3 * b] - X[3 * a], dy = X[3 * b + 1] - X[3 * a + 1], dz = X[3 * b + 2] - X[3 * a + 2];
    const d2 = dx * dx + dy * dy + dz * dz, g = this.wGm[a] + this.wGm[b];
    const t = (d2 * d2 * Math.sqrt(d2)) / (g * g);
    return sticky && this.siblings(a, b) ? t * STICK5 : t;
  }

  /** Are the new clusters `a` and `b` the two halves of a pair of the hierarchy in use? */
  private siblings(a: number, b: number): boolean {
    const oa = this.wOld[a], ob = this.wOld[b];
    return oa >= 0 && ob >= 0 && this.s.par[oa] >= 0 && this.s.par[oa] === this.s.par[ob];
  }

  private nearest(i: number): void {
    const nm = this.s.nm, D = this.wD, alive = this.wAlive;
    let best = -1;
    for (let j = 0; j < nm; j++) if (j !== i && alive[j] && (best < 0 || D[i * nm + j] < D[i * nm + best])) best = j;
    this.wNb[i] = best;
  }

  /**
   * The hierarchy for where the bodies are (their leaves' `cx`): the two clusters of least pairing
   * measure are joined, until one is left. With `sticky`, pairs of the hierarchy in use count as
   * nearer by STICK, so it changes only for a clearly better one.
   * Writes the new pairs to the working arrays; returns whether they differ from those in use.
   */
  private pair(sticky: boolean): boolean {
    const s = this.s, nm = s.nm;
    const D = this.wD, nb = this.wNb, node = this.wNode, alive = this.wAlive, X = this.wX, gmOf = this.wGm, old = this.wOld;
    for (let i = 0; i < nm; i++) {
      node[i] = i; alive[i] = 1; gmOf[i] = s.ngm[i]; old[i] = sticky ? i : -1;
      X[3 * i] = s.cx[3 * i]; X[3 * i + 1] = s.cx[3 * i + 1]; X[3 * i + 2] = s.cx[3 * i + 2];
    }
    for (let i = 0; i < nm; i++) for (let j = 0; j < i; j++) D[i * nm + j] = D[j * nm + i] = this.measure(i, j, sticky);
    for (let i = 0; i < nm; i++) this.nearest(i);
    let changed = false;
    for (let k = nm; k < s.nn; k++) {
      let a = -1;
      for (let i = 0; i < nm; i++) if (alive[i] && (a < 0 || D[i * nm + nb[i]] < D[a * nm + nb[a]])) a = i;
      const b = nb[a];
      // the heavier half first: the separation points from it to the lighter
      let A = node[a], B = node[b];
      if (gmOf[B] > gmOf[A]) { const t = A; A = B; B = t; }
      const was = sticky && this.siblings(A, B);
      this.wTie[k] = D[a * nm + b] / (was ? STICK5 : 1);
      this.wA[k] = A; this.wB[k] = B;
      const g = gmOf[A] + gmOf[B];
      for (let c = 0; c < 3; c++) X[3 * k + c] = (gmOf[A] * X[3 * A + c] + gmOf[B] * X[3 * B + c]) / g;
      gmOf[k] = g;
      old[k] = was ? s.par[old[A]] : -1;
      if (!was) changed = true;
      node[a] = k; alive[b] = 0;
      for (let i = 0; i < nm; i++) if (alive[i] && i !== a) D[a * nm + i] = D[i * nm + a] = this.measure(a, i, sticky);
      this.nearest(a);
      for (let i = 0; i < nm; i++) {
        if (!alive[i] || i === a) continue;
        if (nb[i] === a || nb[i] === b) this.nearest(i);
        else if (D[i * nm + a] < D[i * nm + nb[i]]) nb[i] = a;
      }
    }
    return changed;
  }

  /**
   * The cluster a light body at (x, y, z) goes round: the one it would be joined to if it were
   * given a place in the pairing (the least measure among the clusters that exist by then: the
   * smallest whose sphere of influence it is in). `current`: where it is now, kept unless another
   * is clearly better.
   */
  private host(x: number, y: number, z: number, current: number): number {
    const s = this.s;
    let best = -1, bestT = Infinity;
    for (let k = 0; k < s.nn; k++) {
      const dx = x - s.cx[3 * k], dy = y - s.cx[3 * k + 1], dz = z - s.cx[3 * k + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const keep = k === current ? STICK5 : 1;
      const t = Math.max((d2 * d2 * Math.sqrt(d2)) / (s.ngm[k] * s.ngm[k]), s.tie[k]) * keep;
      const until = s.par[k] >= 0 ? s.tie[s.par[k]] : Infinity;
      if (t < until && t < bestT) { bestT = t; best = k; }
    }
    return best;
  }

  /** Is leaf or pair `j` inside the cluster `k`? */
  private within(j: number, k: number): boolean {
    const par = this.s.par;
    while (j >= 0 && j < k) j = par[j];
    return j === k;
  }

  /**
   * What is stepped and what is carried, for the orbits as they are: writes each place's kind to
   * `wKind`, each light body's mode to `wMode`, and their paces.
   */
  private rails(): void {
    const s = this.s, nm = s.nm, nn = s.nn, limit = this.limit, lightLimit = Math.max(limit, this.lightLimit);
    const ext = this.wExt, peri = this.wPeri, pace = this.wPace, ok = this.wOk, kind = this.wKind;
    // from the tightest pair up: how far each cluster reaches from its centre, and whether it could
    // go on rails: a closed orbit, shorter than the limit, of clusters themselves on rails, that
    // stays clear of them, about a body that allows it. (Members of less than `cross` of the pair's
    // mass, as Saturn's small co-orbitals and trojans are, may cross each other: `reach` leaves
    // them out, and rails leave out their trading of orbits.)
    const reach = this.wReach;
    for (let l = 0; l < nm; l++) { ext[l] = reach[l] = s.radius[s.leaf[l]]; ok[l] = 1; }
    for (let k = nm; k < nn; k++) {
      conic(s.jr, s.jv, 3 * k, this.seen(k, s.jr, 3 * k));
      const A = s.cA[k], B = s.cB[k];
      ext[k] = Math.max(s.fb[k] * oApo + ext[A], s.fa[k] * oApo + ext[B]);
      const light = s.ngm[B] < this.cross * s.ngm[k];
      reach[k] = light ? reach[A] : Math.max(s.fb[k] * oApo + reach[A], s.fa[k] * oApo + reach[B]);
      peri[k] = oBound ? oPeri : Math.sqrt(s.jr[3 * k] ** 2 + s.jr[3 * k + 1] ** 2 + s.jr[3 * k + 2] ** 2);
      pace[k] = oPace;
      ok[k] = oBound && oPeriod < limit && ok[A] && ok[B] && !s.pin[s.leaf[s.top[k]]] && oPeri > reach[A] + reach[B] ? 1 : 0;
    }
    for (let again = true; again;) {
      again = false;
      // from the top down: a cluster that could, and is alone enough, goes on rails whole
      for (let k = nn - 1; k >= 0; k--) {
        const p = s.par[k];
        if (p >= 0 && kind[p] >= FROZEN) kind[k] = INSIDE;
        else if (k < nm) kind[k] = UNIT;
        else kind[k] = ok[k] && this.alone(k) ? FROZEN : ACTIVE;
      }
      // a light body rides the rails of the family it is inside; elsewhere it goes on rails of its
      // own if its orbit is short, closed and clear of what it goes round (of the members it may
      // not cross: `reach`). One passing through a family on rails takes the family off them.
      for (let p = 0; p < s.np; p++) {
        const host = s.phost[p];
        conic(s.pr, s.pv, 3 * p, host >= 0 ? this.seen(host, s.pr, 3 * p) : 0);
        this.wPPace[p] = oPace;
        let mode = LIVE;
        if (host >= 0 && oBound) {
          if (kind[host] === INSIDE) mode = RAILS;
          else if (oPeriod < lightLimit && oPeri > reach[host] + s.radius[s.pbody[p]] && oApo < HILL_SHARE * this.hill(host)) mode = RAILS;
        } else if (host >= 0 && kind[host] === INSIDE) {
          let root = host;
          while (kind[root] !== FROZEN) root = s.par[root];
          ok[root] = 0;
          again = true;
        }
        this.wMode[p] = mode;
      }
    }
  }

  /**
   * The pull of cluster `k` as an orbit at offset `o` of `r` about it feels it: its mass, and the
   * bulge of its heaviest body, GM (1 + 3/2 J₂ (R/r)²) in the equator. (By the mass alone the
   * moons a giant's bulge keeps near it would seem to go out farther than they do, and cross.)
   */
  private seen(k: number, r: Float64Array, o: number): number {
    const zon = this.s.zon[this.s.leaf[this.s.top[k]]];
    return zon > 0 ? this.s.ngm[k] * (1 + (1.5 * zon) / (r[o] * r[o] + r[o + 1] * r[o + 1] + r[o + 2] * r[o + 2])) : this.s.ngm[k];
  }

  /** The Hill sphere of cluster `k` on its orbit (Infinity for the whole system). */
  private hill(k: number): number {
    const s = this.s;
    // (the heavier of a pair holds sway over its partner's orbit and beyond: its sphere is the pair's)
    for (let p = s.par[k]; p >= 0; k = p, p = s.par[p]) {
      const other = s.cA[p] === k ? s.cB[p] : s.cA[p];
      if (s.ngm[k] <= s.ngm[other]) return this.wPeri[p] * Math.cbrt(s.ngm[k] / (3 * s.ngm[p]));
    }
    return Infinity;
  }

  /**
   * May the cluster `k` be carried as one mass? If it is small inside its Hill sphere, and no body
   * outside it is within GUARD times its size, or so near and heavy that the cluster is inside
   * that body's own Hill sphere (as its parent's orbit would give it). (A cluster not on rails now
   * must be clear by a quarter more: no flickering.)
   */
  private alone(k: number): boolean {
    const s = this.s, p = s.par[k];
    if (p < 0) return true;
    const ext = this.wExt[k];
    if (!(ext < HILL_SHARE * this.hill(k))) return false;
    const clear = s.kind[k] === FROZEN ? 1 : 1.25;
    const hill3 = this.wPeri[p] ** 3 / (3 * s.ngm[p]);
    for (let l = 0; l < s.nm; l++) {
      if (this.within(l, k)) continue;
      const dx = s.cx[3 * l] - s.cx[3 * k], dy = s.cx[3 * l + 1] - s.cx[3 * k + 1], dz = s.cx[3 * l + 2] - s.cx[3 * k + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / clear;
      if (d < GUARD * ext + s.radius[s.leaf[l]] || d * d * d < s.ngm[l] * hill3) return false;
    }
    return true;
  }

  /**
   * How fast the remainders change, as far as can be told before a step has shown it: each as if
   * it turned with its orbit, as the Sun's pull on the Moon's orbit does (from the first look on,
   * what the steps showed is used).
   */
  private prior(): void {
    const s = this.s, jr = s.jr, jv = s.jv, ja = s.ja;
    for (let idx = 0; idx < s.na; idx++) {
      const k = s.an[idx], o = 3 * k;
      const r2 = jr[o] * jr[o] + jr[o + 1] * jr[o + 1] + jr[o + 2] * jr[o + 2];
      const own = s.ngm[k] / r2 + (jv[o] * jv[o] + jv[o + 1] * jv[o + 1] + jv[o + 2] * jv[o + 2]) / Math.sqrt(r2);
      const rate = (Math.hypot(ja[o], ja[o + 1], ja[o + 2]) / own) * (TWO_PI / this.wPace[k]);
      if (rate > s.rate) s.rate = rate;
    }
    const pr = s.pr, pv = s.pv, pa = s.pa;
    for (let p = 0; p < s.np; p++) {
      if (s.pmode[p] !== LIVE || s.phost[p] < 0) continue;
      const o = 3 * p;
      const r2 = pr[o] * pr[o] + pr[o + 1] * pr[o + 1] + pr[o + 2] * pr[o + 2];
      const own = s.ngm[s.phost[p]] / r2 + (pv[o] * pv[o] + pv[o + 1] * pv[o + 1] + pv[o + 2] * pv[o + 2]) / Math.sqrt(r2);
      const rate = (Math.hypot(pa[o], pa[o + 1], pa[o + 2]) / own) * (TWO_PI / this.wPPace[p]);
      if (rate > s.prate[p]) s.prate[p] = rate;
      // (a light body's steps are no shorter than the common step)
      if (rate > s.rate) s.rate = rate;
    }
  }

  /** The step wanted: the orbits' pace, bodies about to touch, how fast the remainders change. */
  private want(): number {
    const s = this.s;
    return Math.min(this.pace(), this.closePace(), s.rate > 0 ? VARY / (this.steps * s.rate) : Infinity);
  }

  /** The shortest step the stepped orbits ask for (after `rails`). */
  private pace(): number {
    const s = this.s;
    let want = Infinity;
    for (let k = s.nm; k < s.nn; k++) if (s.kind[k] === ACTIVE && this.wPace[k] < want) want = this.wPace[k];
    for (let p = 0; p < s.np; p++) if (s.pmode[p] === LIVE && this.wPPace[p] < want) want = this.wPPace[p];
    return want / this.steps;
  }

  /** The step that pairs of bodies about to touch ask for: their distance over their speed, as an orbit's pace. */
  private closePace(): number {
    const s = this.s, nu = s.nu;
    let want = Infinity;
    for (let i = 0; i < nu; i++) {
      const a = 3 * s.un[i];
      for (let j = i + 1; j < nu; j++) {
        const reach = CONTACT * (s.urad[i] + s.urad[j]);
        const b = 3 * s.un[j];
        const dx = s.cx[b] - s.cx[a], dy = s.cx[b + 1] - s.cx[a + 1], dz = s.cx[b + 2] - s.cx[a + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (!(r2 < reach * reach) || s.near[i * nu + j] === 0) continue;
        const wx = s.cv[b] - s.cv[a], wy = s.cv[b + 1] - s.cv[a + 1], wz = s.cv[b + 2] - s.cv[a + 2];
        want = Math.min(want, TWO_PI * Math.sqrt(r2 / (wx * wx + wy * wy + wz * wz)));
      }
    }
    return want / this.steps;
  }

  /**
   * How many doublings of the common step a light body of this pace, and whose remainder changes
   * at this rate, can take: below 0 if even the common step is too long for it.
   */
  private level(pace: number, rate: number): number {
    const h = this.s.h;
    const ratio = Math.min(pace / (this.steps * h), rate > 0 ? VARY / (this.steps * rate * h) : Infinity);
    return ratio >= 1 ? Math.min(LEVELS, Math.floor(Math.log2(ratio))) : -1;
  }

  /**
   * Lay out what is stepped, from the kinds: the units in the order of the tree (so that each
   * pair's two sides are two runs of them), the pairs from the tightest up, what each is watched
   * for, and how near two units may come before they are looked at.
   */
  private arrange(): void {
    const s = this.s, nm = s.nm, nn = s.nn;
    s.nu = 0; s.na = 0;
    s.unitOf.fill(-1);
    if (nn === 0) return;
    const stack = this.wStack;
    let top = 0;
    stack[top++] = nn - 1;
    while (top > 0) {
      const k = stack[--top];
      if (k < 0) { s.hi[-1 - k] = s.nu; continue; }
      if (s.kind[k] === ACTIVE) {
        s.lo[k] = s.nu;
        stack[top++] = -1 - k; stack[top++] = s.cB[k]; stack[top++] = s.cA[k];
      } else {
        const i = s.nu++;
        s.un[i] = k; s.unitOf[k] = i;
        s.ugm[i] = s.ngm[k];
        const real = k < nm;
        s.urad[i] = real ? s.radius[s.leaf[k]] : 0;
        s.urs[i] = real ? s.rs[s.leaf[k]] : 0;
        // (a family on rails pulls as one point: its members' bulges with it)
        s.uzon[i] = real ? s.zon[s.leaf[k]] : 0;
        for (let c = 0; c < 3; c++) s.upole[3 * i + c] = real ? s.pole[3 * s.leaf[k] + c] : 0;
        for (let c = 0; c < 3; c++) s.ux[3 * i + c] = s.uxp[3 * i + c] = s.cx[3 * k + c];
        s.ud[i] = 0;
      }
    }
    // (pairs are numbered after the two they join: in the order of their numbers is bottom up)
    for (let k = nm; k < nn; k++) {
      if (s.kind[k] !== ACTIVE) { s.watch[k] = 0; continue; }
      s.an[s.na++] = k;
      const A = s.cA[k], B = s.cB[k];
      conic(s.jr, s.jv, 3 * k, s.ngm[k]);
      const touch = A < nm && B < nm ? Math.max(s.radius[s.leaf[A]], s.rs[s.leaf[A]]) + Math.max(s.radius[s.leaf[B]], s.rs[s.leaf[B]]) : 0;
      s.touch[k] = touch;
      // (looser than the pair that holds it, by STICK: the hierarchy no longer fits)
      const p = s.par[k];
      s.far[k] = p >= 0 ? Math.pow((s.tie[p] * s.ngm[k] * s.ngm[k]) / STICK5, 0.2) : Infinity;
      s.watch[k] = (touch > 0 ? TOUCH : 0) | (oBound ? 0 : OPEN) | (oFollow ? FOLLOW : 0) | (p >= 0 ? FAR : 0);
    }
    // how near: where the two would rather be a pair of their own (their measure down to the
    // pair's that holds them, less STICK), or about to touch, or, for a family on rails, where
    // the other would disturb it. Two bodies that are a pair themselves are watched on their orbit.
    const nu = s.nu, near = s.near;
    for (let idx = 0; idx < s.na; idx++) {
      const k = s.an[idx], A = s.cA[k], B = s.cB[k];
      const aLo = s.kind[A] === ACTIVE ? s.lo[A] : s.unitOf[A], aHi = s.kind[A] === ACTIVE ? s.hi[A] : aLo + 1;
      const bLo = s.kind[B] === ACTIVE ? s.lo[B] : s.unitOf[B], bHi = s.kind[B] === ACTIVE ? s.hi[B] : bLo + 1;
      const own = A < nm && B < nm;
      for (let i = aLo; i < aHi; i++) {
        for (let j = bLo; j < bHi; j++) {
          let d = 0;
          if (!own) {
            const g = s.ugm[i] + s.ugm[j];
            d = Math.max(Math.pow(STICK5 * s.tie[k] * g * g, 0.2), CONTACT * (s.urad[i] + s.urad[j]), this.guard(i, j), this.guard(j, i));
            const dx = s.ux[3 * j] - s.ux[3 * i], dy = s.ux[3 * j + 1] - s.ux[3 * i + 1], dz = s.ux[3 * j + 2] - s.ux[3 * i + 2];
            d = this.relaxed(d, Math.sqrt(dx * dx + dy * dy + dz * dz), i, j);
          }
          near[i * nu + j] = near[j * nu + i] = d;
        }
      }
    }
  }

  /** How near unit `j` may come to unit `i`, a family on rails, before the family must come off them (0 for a body). */
  private guard(i: number, j: number): number {
    const s = this.s, k = s.un[i];
    if (s.kind[k] !== FROZEN) return 0;
    const p = s.par[k];
    return Math.max(GUARD * this.wExt[k] + s.urad[j], p < 0 ? 0 : this.wPeri[p] * Math.cbrt(s.ugm[j] / (3 * s.ngm[p])));
  }

  /** A watching distance `d` for two units now `r` apart: if they are inside it already, somewhat less than where they are (but never less than about to touch). */
  private relaxed(d: number, r: number, i: number, j: number): number {
    return r < d ? Math.max(RELAX * r, CONTACT * (this.s.urad[i] + this.s.urad[j])) : d;
  }

  // ------------------------------------------------------------------ the step

  /**
   * One step, forward (`way` 1) or back (-1). The state is kept at a kick, before it: forward is
   * the kick, every pair along its two-body orbit to the next, and the pulls there; back is the
   * same undone. Then the light bodies whose turn it is.
   */
  private step(way: number): void {
    const s = this.s, dt = way * s.h;
    if (way > 0) this.kick(dt);
    // (what is seen on the way is told at the step's end)
    s.tick += way;
    s.at = s.t0 + s.tick * s.h;
    this.drift(dt, true);
    this.wJa.set(s.ja);
    this.forces(true);
    if (way < 0) this.kick(dt);
    this.vary();
    this.light(false);
    s.span++;
  }

  /** How much each stepped pair's remainder changed in the step just taken (see VARY). */
  private vary(): void {
    const s = this.s, jr = s.jr, jv = s.jv, ja = s.ja, was = this.wJa, an = s.an;
    let most = 0;
    for (let idx = 0; idx < s.na; idx++) {
      const o = 3 * an[idx];
      const r2 = jr[o] * jr[o] + jr[o + 1] * jr[o + 1] + jr[o + 2] * jr[o + 2];
      const v2 = jv[o] * jv[o] + jv[o + 1] * jv[o + 1] + jv[o + 2] * jv[o + 2];
      // (the pull the orbit is made of, or on an open orbit what would bend it: v²/r)
      const own = s.ngm[an[idx]] / r2 + v2 / Math.sqrt(r2);
      const d2 = (ja[o] - was[o]) ** 2 + (ja[o + 1] - was[o + 1]) ** 2 + (ja[o + 2] - was[o + 2]) ** 2;
      if (d2 > most * most * own * own) most = Math.sqrt(d2) / own;
    }
    const rate = most / s.h;
    if (rate > s.seen) s.seen = rate;
    if (most > (SLACK * VARY) / this.steps) this.review = true;
  }

  /** The pulls beyond two-body, for `dt`, on every stepped pair. */
  private kick(dt: number): void {
    const s = this.s, jv = s.jv, ja = s.ja, an = s.an;
    for (let idx = 0; idx < s.na; idx++) {
      const o = 3 * an[idx];
      jv[o] += ja[o] * dt; jv[o + 1] += ja[o + 1] * dt; jv[o + 2] += ja[o + 2] * dt;
    }
  }

  /** Every stepped pair along its two-body orbit by `dt`; `watching`: with what each is watched for. */
  private drift(dt: number, watching: boolean): void {
    const s = this.s, jr = s.jr, jv = s.jv, an = s.an, way = dt < 0 ? -1 : 1;
    for (let idx = 0; idx < s.na; idx++) {
      const k = an[idx], o = 3 * k;
      const watch = watching ? s.watch[k] : 0;
      const before = watch ? way * (jr[o] * jv[o] + jr[o + 1] * jv[o + 1] + jr[o + 2] * jv[o + 2]) : 0;
      if (!keplerDrift(jr, jv, o, s.ngm[k], dt)) this.misses++;
      if (watch) this.watched(k, watch, before < 0 && way * (jr[o] * jv[o] + jr[o + 1] * jv[o + 1] + jr[o + 2] * jv[o + 2]) >= 0);
    }
  }

  /**
   * Into the mapping's own variables, and back out. A run of equal steps follows, exactly, a
   * system slightly other than the real one; these two changes of variables (Wisdom, Holman and
   * Touma's corrector, third order) take the real state to the one whose mapped path stays beside
   * the real path, and back. With them the error left is the remainder squared times the step
   * squared, not the remainder times the step squared: where the remainder is large (the Sun's
   * pull on the Moon's orbit) that is a hundred times less, for nothing per step.
   */
  private enter(): void {
    const h = this.s.h;
    this.wobble(CORRECT_A * h, CORRECT_B * h);
    this.wobble(-CORRECT_A * h, -CORRECT_B * h);
  }

  private leave(): void {
    const h = this.s.h;
    this.wobble(CORRECT_A * h, -CORRECT_B * h);
    this.wobble(-CORRECT_A * h, CORRECT_B * h);
  }

  /** The corrector's building block: along the orbits by `a`, a kick back by `b`, twice `a` back, the kick again, `a` on. */
  private wobble(a: number, b: number): void {
    this.drift(a, false);
    this.forces(false);
    this.kick(-b);
    this.drift(-2 * a, false);
    this.forces(false);
    this.kick(b);
    this.drift(a, false);
  }

  /** A watched pair after its orbit's step; `passed`: it went through its periapsis in it. */
  private watched(k: number, watch: number, passed: boolean): void {
    const s = this.s, o = 3 * k;
    const r2 = s.jr[o] ** 2 + s.jr[o + 1] ** 2 + s.jr[o + 2] ** 2;
    if (watch & TOUCH) {
      const touch = s.touch[k];
      if (r2 < touch * touch) { this.met.push(s.id[s.leaf[s.cA[k]]], s.id[s.leaf[s.cB[k]]]); return; }
    }
    if (passed && watch & (TOUCH | OPEN)) {
      conic(s.jr, s.jv, o, s.ngm[k]);
      if (watch & TOUCH && oPeri < s.touch[k]) { this.met.push(s.id[s.leaf[s.cA[k]]], s.id[s.leaf[s.cB[k]]]); return; }
      if (watch & OPEN) this.events.push({ kind: 'encounter', time: s.at, a: s.id[s.leaf[s.top[s.cA[k]]]], b: s.id[s.leaf[s.top[s.cB[k]]]], distance: oPeri, speed: oSpeed });
    }
    if (watch & FOLLOW) {
      // its pace now against the step in use
      const v2 = s.jv[o] ** 2 + s.jv[o + 1] ** 2 + s.jv[o + 2] ** 2;
      const turn = this.steps * s.h / TWO_PI;
      if (Math.min(r2 / v2, (r2 * Math.sqrt(r2)) / s.ngm[k]) < turn * turn) this.review = true;
    }
    if (watch & FAR && r2 > s.far[k] * s.far[k]) this.review = true;
  }

  /**
   * The pulls, for where the pairs are: every unit's place from the top of the hierarchy down,
   * every pair of units pulling on each other, then back up: each cluster's acceleration, and each
   * pair's beyond its own two-body orbit (which the orbit's step has had already). `watching`:
   * note the pairs of units that have come near.
   */
  private forces(watching: boolean): void {
    const s = this.s, nu = s.nu, na = s.na, an = s.an;
    const cx = s.cx, ca = s.ca, jr = s.jr, ja = s.ja;
    if (s.nn > 0) cx[3 * s.nn - 3] = cx[3 * s.nn - 2] = cx[3 * s.nn - 1] = 0;
    for (let idx = na - 1; idx >= 0; idx--) {
      const k = an[idx], o = 3 * k, A = 3 * s.cA[k], B = 3 * s.cB[k], fa = s.fa[k], fb = s.fb[k];
      cx[A] = cx[o] - fb * jr[o]; cx[A + 1] = cx[o + 1] - fb * jr[o + 1]; cx[A + 2] = cx[o + 2] - fb * jr[o + 2];
      cx[B] = cx[o] + fa * jr[o]; cx[B + 1] = cx[o + 1] + fa * jr[o + 1]; cx[B + 2] = cx[o + 2] + fa * jr[o + 2];
    }
    const ux = s.ux, uxp = s.uxp, ua = s.ua, ud = s.ud, ugm = s.ugm, urs = s.urs, uzon = s.uzon, upole = s.upole, un = s.un, near = s.near;
    for (let i = 0; i < nu; i++) {
      const o = 3 * i, k = 3 * un[i];
      const dx = cx[k] - ux[o], dy = cx[k + 1] - ux[o + 1], dz = cx[k + 2] - ux[o + 2];
      ud[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      uxp[o] = ux[o]; uxp[o + 1] = ux[o + 1]; uxp[o + 2] = ux[o + 2];
      ux[o] = cx[k]; ux[o + 1] = cx[k + 1]; ux[o + 2] = cx[k + 2];
      ua[o] = ua[o + 1] = ua[o + 2] = 0;
    }
    const flag = this.flag, room = watching ? flag.length : 0;
    let nflag = 0;
    for (let i = 0; i < nu; i++) {
      const oi = 3 * i, xi = ux[oi], yi = ux[oi + 1], zi = ux[oi + 2], gi = ugm[i], hi = urs[i], di = ud[i], row = i * nu;
      let ax = 0, ay = 0, az = 0;
      for (let j = i + 1; j < nu; j++) {
        const oj = 3 * j;
        const dx = ux[oj] - xi, dy = ux[oj + 1] - yi, dz = ux[oj + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz;
        const r = Math.sqrt(r2);
        // (two bodies in one place do not pull: they are about to be one)
        let inv = r2 > 0 ? 1 / (r2 * r) : 0;
        // a black hole: Paczyński and Wiita's force, GM / (r - rs)², which has Schwarzschild's last stable orbit
        const hole = hi + urs[j];
        if (hole > 0) { const d = Math.max(r - hole, 1e-3 * hole); inv = 1 / (r * d * d); }
        const wi = ugm[j] * inv, wj = gi * inv;
        ax += wi * dx; ay += wi * dy; az += wi * dz;
        ua[oj] -= wj * dx; ua[oj + 1] -= wj * dy; ua[oj + 2] -= wj * dz;
        // a flattened body's bulge pulls the other, and is pulled back
        if (uzon[i] > 0 && r2 > 0) {
          bulge(uzon[i], upole, oi, dx, dy, dz, r2);
          ua[oj] += gi * bx; ua[oj + 1] += gi * by; ua[oj + 2] += gi * bz;
          ax -= ugm[j] * bx; ay -= ugm[j] * by; az -= ugm[j] * bz;
        }
        if (uzon[j] > 0 && r2 > 0) {
          bulge(uzon[j], upole, oj, -dx, -dy, -dz, r2);
          ax += ugm[j] * bx; ay += ugm[j] * by; az += ugm[j] * bz;
          ua[oj] -= gi * bx; ua[oj + 1] -= gi * by; ua[oj + 2] -= gi * bz;
        }
        // near enough to look at: within the watching distance, or possibly so during the step just taken
        const reach = near[row + j] + di + ud[j];
        if (r2 < reach * reach && nflag < room) { flag[nflag++] = i; flag[nflag++] = j; }
      }
      ua[oi] += ax; ua[oi + 1] += ay; ua[oi + 2] += az;
    }
    // (more near pairs than there is room to note: have everything looked at)
    if (nflag === flag.length) this.review = true;
    if (nflag > 0) this.close(nflag);
    for (let i = 0; i < nu; i++) {
      const o = 3 * i, k = 3 * un[i];
      ca[k] = ua[o]; ca[k + 1] = ua[o + 1]; ca[k + 2] = ua[o + 2];
    }
    for (let idx = 0; idx < na; idx++) {
      const k = an[idx], o = 3 * k, A = 3 * s.cA[k], B = 3 * s.cB[k], fa = s.fa[k], fb = s.fb[k];
      const x = jr[o], y = jr[o + 1], z = jr[o + 2];
      const r2 = x * x + y * y + z * z;
      const w = s.ngm[k] / (r2 * Math.sqrt(r2));
      ca[o] = fa * ca[A] + fb * ca[B]; ca[o + 1] = fa * ca[A + 1] + fb * ca[B + 1]; ca[o + 2] = fa * ca[A + 2] + fb * ca[B + 2];
      ja[o] = ca[B] - ca[A] + w * x; ja[o + 1] = ca[B + 1] - ca[A + 1] + w * y; ja[o + 2] = ca[B + 2] - ca[A + 2] + w * z;
    }
  }

  /**
   * The pairs of units that came near in the step just taken. How near: the least distance along
   * the straight lines between where they were and where they are, so a fast pair cannot step
   * over each other. Two bodies that met are noted; anything else near asks for a review.
   */
  private close(nflag: number): void {
    const s = this.s, nu = s.nu, ux = s.ux, uxp = s.uxp, flag = this.flag;
    for (let f = 0; f < nflag; f += 2) {
      const i = flag[f], j = flag[f + 1], a = 3 * i, b = 3 * j;
      const px = uxp[b] - uxp[a], py = uxp[b + 1] - uxp[a + 1], pz = uxp[b + 2] - uxp[a + 2];
      const ex = ux[b] - ux[a] - px, ey = ux[b + 1] - ux[a + 1] - py, ez = ux[b + 2] - ux[a + 2] - pz;
      const ee = ex * ex + ey * ey + ez * ez;
      const t = ee > 0 ? Math.min(1, Math.max(0, -(px * ex + py * ey + pz * ez) / ee)) : 1;
      const mx = px + t * ex, my = py + t * ey, mz = pz + t * ez;
      const least2 = mx * mx + my * my + mz * mz;
      const d = s.near[i * nu + j];
      if (!(least2 < d * d)) continue;
      const A = s.un[i], B = s.un[j];
      const touch = Math.max(s.urad[i], s.urs[i]) + Math.max(s.urad[j], s.urs[j]);
      if (A < s.nm && B < s.nm && least2 < touch * touch) this.met.push(s.id[s.leaf[A]], s.id[s.leaf[B]]);
      else this.review = true;
    }
  }

  /** The light bodies whose turn it is (all of them if `whole`): each a step of its own up to now. */
  private light(whole: boolean): void {
    const s = this.s, np = s.np;
    if (np === 0) return;
    const pr = s.pr, pv = s.pv, pa = s.pa, pt = s.pt, at = s.at, tick = s.tick;
    for (let p = 0; p < np; p++) {
      if (s.pmode[p] !== LIVE) continue;
      const level = s.plevel[p];
      if (!whole && (tick & ((1 << level) - 1)) !== 0) continue;
      const dt = at - pt[p];
      if (dt === 0) continue;
      const o = 3 * p, half = 0.5 * dt, host = s.phost[p];
      pv[o] += pa[o] * half; pv[o + 1] += pa[o + 1] * half; pv[o + 2] += pa[o + 2] * half;
      const way = dt < 0 ? -1 : 1;
      const before = way * (pr[o] * pv[o] + pr[o + 1] * pv[o + 1] + pr[o + 2] * pv[o + 2]);
      const mu = host >= 0 ? s.ngm[host] : 0;
      if (!keplerDrift(pr, pv, o, mu, dt)) this.misses++;
      pt[p] = at;
      const ax = pa[o], ay = pa[o + 1], az = pa[o + 2];
      this.pull(p);
      pv[o] += pa[o] * half; pv[o + 1] += pa[o + 1] * half; pv[o + 2] += pa[o + 2] * half;
      // how much its remainder changed, against the pull its orbit is made of (see `vary`)
      const r2 = pr[o] * pr[o] + pr[o + 1] * pr[o + 1] + pr[o + 2] * pr[o + 2];
      const own = mu / r2 + (pv[o] * pv[o] + pv[o + 1] * pv[o + 1] + pv[o + 2] * pv[o + 2]) / Math.sqrt(r2);
      s.prate[p] = Math.hypot(pa[o] - ax, pa[o + 1] - ay, pa[o + 2] - az) / (own * Math.abs(dt));
      // its orbit now: has it struck the body it goes round, does it belong elsewhere, what step next
      conic(pr, pv, o, mu);
      if (host >= 0 && host < s.nm) {
        const i = s.leaf[host];
        const touch = Math.max(s.radius[i], s.rs[i]) + s.radius[s.pbody[p]];
        const passed = before < 0 && way * (pr[o] * pv[o] + pr[o + 1] * pv[o + 1] + pr[o + 2] * pv[o + 2]) >= 0;
        if (pr[o] ** 2 + pr[o + 1] ** 2 + pr[o + 2] ** 2 < touch * touch || (passed && oPeri < touch)) this.met.push(s.id[i], s.id[s.pbody[p]]);
      }
      // even the common step too long for it: for its orbit (a new plan), or for how fast its
      // remainder changes (the common step is looked at with the others')
      if (oPace < this.steps * s.h) { this.review = true; continue; }
      const want = this.level(oPace, s.prate[p]);
      if (want < 0) {
        if (s.prate[p] > s.seen) s.seen = s.prate[p];
        if (s.prate[p] * s.h * this.steps > SLACK * VARY) this.review = true;
      }
      // (a longer step only where the grid of the longer one starts)
      const next = Math.max(0, want);
      if (next < level || (next > level && (tick & ((1 << (level + 1)) - 1)) === 0)) s.plevel[p] = next < level ? next : level + 1;
    }
  }

  /**
   * The acceleration of light body `p` beyond its two-body orbit, for where it and the units are
   * now. Notes it for another look where it has struck a body or come under another's sway.
   */
  private pull(p: number): void {
    const s = this.s, o = 3 * p, host = s.phost[p], nu = s.nu;
    const ux = s.ux, ugm = s.ugm, urs = s.urs, uzon = s.uzon, pr = s.pr;
    const h = host >= 0 ? 3 * host : -1;
    const x = pr[o] + (h >= 0 ? s.cx[h] : 0), y = pr[o + 1] + (h >= 0 ? s.cx[h + 1] : 0), z = pr[o + 2] + (h >= 0 ? s.cx[h + 2] : 0);
    const rp2 = pr[o] * pr[o] + pr[o + 1] * pr[o + 1] + pr[o + 2] * pr[o + 2];
    const mu = host >= 0 ? s.ngm[host] : 0;
    // its own orbit's pull per metre, GM/r³; its pairing measure with what it goes round, and the
    // measure another must come under to sway it
    const own = mu > 0 ? mu / (rp2 * Math.sqrt(rp2)) : 0;
    const mine = mu > 0 ? (rp2 * rp2 * Math.sqrt(rp2)) / (mu * mu) : Infinity;
    const sway = STICK5 * mine;
    const skip = host >= 0 ? s.unitOf[host] : -1;
    const size = s.radius[s.pbody[p]];
    let ax = 0, ay = 0, az = 0, look = false;
    for (let i = 0; i < nu; i++) {
      const oi = 3 * i;
      const dx = ux[oi] - x, dy = ux[oi + 1] - y, dz = ux[oi + 2] - z;
      const r2 = dx * dx + dy * dy + dz * dz;
      // (the bulge of what it goes round too: its two-body orbit is the pull of a point)
      if (uzon[i] > 0 && r2 > 0) {
        bulge(uzon[i], s.upole, oi, -dx, -dy, -dz, r2);
        ax += ugm[i] * bx; ay += ugm[i] * by; az += ugm[i] * bz;
      }
      if (i === skip) continue;
      const r = Math.sqrt(r2);
      let inv = r2 > 0 ? 1 / (r2 * r) : 0;
      if (urs[i] > 0) { const d = Math.max(r - urs[i], 1e-3 * urs[i]); inv = 1 / (r * d * d); }
      const w = ugm[i] * inv;
      ax += w * dx; ay += w * dy; az += w * dz;
      if (r2 * r2 * r < sway * ugm[i] * ugm[i]) look = true;
      const touch = Math.max(s.urad[i], urs[i]) + size;
      if (r2 < touch * touch && s.un[i] < s.nm) this.met.push(s.id[s.leaf[s.un[i]]], s.id[s.pbody[p]]);
    }
    if (host >= 0) {
      ax -= s.ca[h]; ay -= s.ca[h + 1]; az -= s.ca[h + 2];
      // (the body it goes round, left out above, is its two-body orbit, but for a black hole's pull
      // beyond Newton's; a cluster's members were not left out)
      if (skip < 0) { ax += own * pr[o]; ay += own * pr[o + 1]; az += own * pr[o + 2]; }
      else if (urs[skip] > 0) {
        const r = Math.sqrt(rp2), d = Math.max(r - urs[skip], 1e-3 * urs[skip]);
        const more = mu / (r * d * d) - own;
        ax -= more * pr[o]; ay -= more * pr[o + 1]; az -= more * pr[o + 2];
      }
      // nearer than the cluster it goes round is tight, or farther than the next one out reaches
      const par = s.par[host];
      if (mine < STICK5 * s.tie[host] || (par >= 0 && STICK5 * mine > s.tie[par])) look = true;
    }
    s.pa[o] = ax; s.pa[o + 1] = ay; s.pa[o + 2] = az;
    if (look) { s.pflag[p] = 1; this.review = true; }
  }

  // ------------------------------------------------------------------ looking again

  /**
   * Does the plan still fit the bodies? The hierarchy (with its bias for what is in use), what is
   * on rails, the step, and the light bodies that asked for a look. Changes nothing that matters
   * if it does (pairs on rails are brought up to now, which they are anyway when read).
   */
  private stale(): boolean {
    const s = this.s;
    this.syncRails();
    this.compose(s.jr, s.jv, s.cx, s.cv);
    if (this.pair(true)) return true;
    for (let k = s.nm; k < s.nn; k++) s.tie[this.wOld[k]] = this.wTie[k];
    this.rails();
    for (let k = 0; k < s.nn; k++) if (this.wKind[k] !== s.kind[k]) return true;
    for (let p = 0; p < s.np; p++) if (this.wMode[p] !== s.pmode[p]) return true;
    // (how fast the remainders change: from the steps since the last look, if any were taken)
    if (s.span > 0) s.rate = s.seen;
    s.seen = 0; s.span = 0;
    const want = this.want();
    if (!(want >= s.h && want <= SLACK * s.h)) return true;
    for (let p = 0; p < s.np; p++) {
      if (!s.pflag[p]) continue;
      s.pflag[p] = 0;
      const host = s.phost[p], h = host >= 0 ? 3 * host : -1, o = 3 * p;
      // (a light body on a longer step is looked at where it was last stepped to)
      if (s.pt[p] === s.at && this.host(s.pr[o] + (h >= 0 ? s.cx[h] : 0), s.pr[o + 1] + (h >= 0 ? s.cx[h + 1] : 0), s.pr[o + 2] + (h >= 0 ? s.cx[h + 2] : 0), host) !== host) return true;
    }
    // units that are inside their watching distance and stay as they are: watched from nearer
    const nu = s.nu;
    for (let i = 0; i < nu; i++) {
      for (let j = i + 1; j < nu; j++) {
        const d = s.near[i * nu + j];
        if (d === 0) continue;
        const dx = s.ux[3 * j] - s.ux[3 * i], dy = s.ux[3 * j + 1] - s.ux[3 * i + 1], dz = s.ux[3 * j + 2] - s.ux[3 * i + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < d * d) s.near[i * nu + j] = s.near[j * nu + i] = this.relaxed(d, Math.sqrt(r2), i, j);
      }
    }
    this.census();
    return false;
  }

  /** Bring the pairs on rails along their orbits to now. */
  private syncRails(): void {
    const s = this.s;
    for (let k = s.nm; k < s.nn; k++) {
      if (s.kind[k] === ACTIVE || s.jt[k] === s.at) continue;
      if (!keplerDrift(s.jr, s.jv, 3 * k, s.ngm[k], s.at - s.jt[k])) this.misses++;
      s.jt[k] = s.at;
    }
  }

  /** Centres of mass (and their velocities) of every cluster and leaf from the pairs' states, top down. */
  private compose(jr: Float64Array, jv: Float64Array, cx: Float64Array, cv: Float64Array): void {
    const s = this.s, nn = s.nn;
    if (nn === 0) return;
    for (let c = 1; c <= 3; c++) cx[3 * nn - c] = cv[3 * nn - c] = 0;
    for (let k = nn - 1; k >= s.nm; k--) {
      const o = 3 * k, A = 3 * s.cA[k], B = 3 * s.cB[k], fa = s.fa[k], fb = s.fb[k];
      for (let c = 0; c < 3; c++) {
        cx[A + c] = cx[o + c] - fb * jr[o + c]; cx[B + c] = cx[o + c] + fa * jr[o + c];
        cv[A + c] = cv[o + c] - fb * jv[o + c]; cv[B + c] = cv[o + c] + fa * jv[o + c];
      }
    }
  }

  /**
   * The bodies' positions and velocities (`x`, `v`) at `to` as `read()` has them, or, with `to`
   * NaN, at the middle before the kick the state is kept at (where the mapping's variables turn
   * into the true ones exactly: the hierarchy's own changes are made there, so that they fall
   * on the grid of steps whatever times were asked for). A new plan has to be made after.
   */
  private cartesian(to: number): void {
    const s = this.s;
    this.unmap(to === to ? to : s.na > 0 && s.h < Infinity ? s.at - 0.5 * s.h : s.at);
    this.compose(s.jr, s.jv, s.cx, s.cv);
    const cm = s.cm, lag = s.at - s.cmT;
    for (let i = 0; i < s.n; i++) {
      const sl = s.slot[i];
      let host = sl, o = -1;
      if (sl < 0) {
        const p = -1 - sl;
        host = s.phost[p]; o = 3 * p;
        this.lightAt(p, s.at, s.pr, s.pv, o);
        s.pt[p] = s.at;
      }
      for (let c = 0; c < 3; c++) {
        s.x[3 * i + c] = cm[c] + cm[3 + c] * lag + (host >= 0 ? s.cx[3 * host + c] : 0) + (o >= 0 ? s.pr[o + c] : 0);
        s.v[3 * i + c] = cm[3 + c] + (host >= 0 ? s.cv[3 * host + c] : 0) + (o >= 0 ? s.pv[o + c] : 0);
      }
    }
    s.dirty = true;
  }

  /**
   * The bodies that met become one each: the heavier survives with the mass and the momentum of
   * both at their centre of mass, and their volumes added (a black hole's horizon grows with its
   * mass). The energy of the impact is in the event; the simulation has no place for it.
   */
  private merge(): void {
    const s = this.s;
    if (!s.dirty) this.cartesian(NaN);
    for (let m = 0; m < this.met.length; m += 2) {
      let i = this.indexOf(this.met[m]), j = this.indexOf(this.met[m + 1]);
      if (i < 0 || j < 0 || i === j) continue;
      // the survivor: a black hole before anything else, then the heavier, then the larger
      const hole = (s.rs[j] > 0 ? 1 : 0) - (s.rs[i] > 0 ? 1 : 0);
      if (hole > 0 || (hole === 0 && (s.gm[j] > s.gm[i] || (s.gm[j] === s.gm[i] && s.radius[j] > s.radius[i])))) { const t = i; i = j; j = t; }
      const gi = s.gm[i], gj = s.gm[j], g = gi + gj;
      const black = s.rs[i] > 0 || s.rs[j] > 0, touch = s.radius[i] + s.radius[j];
      let w2 = 0, d2 = 0;
      for (let c = 0; c < 3; c++) {
        w2 += (s.v[3 * j + c] - s.v[3 * i + c]) ** 2;
        d2 += (s.x[3 * j + c] - s.x[3 * i + c]) ** 2;
        if (gj > 0) {
          s.x[3 * i + c] = (gi * s.x[3 * i + c] + gj * s.x[3 * j + c]) / g;
          s.v[3 * i + c] = (gi * s.v[3 * i + c] + gj * s.v[3 * j + c]) / g;
        }
      }
      if (s.rs[i] > 0) s.rs[i] *= g / gi;
      else if (gj > 0) s.radius[i] = Math.cbrt(s.radius[i] ** 3 + s.radius[j] ** 3);
      s.gm[i] = g;
      // (they are made one where the step that brought them together left them, deeper than touching
      // or already past it: from there to the moment they touched, v² = w² + 2G(m₁ + m₂)(1/touch − 1/d))
      const d = black ? Math.sqrt(d2) : touch;
      if (!black) w2 = Math.max(0, w2 + 2 * g * (1 / touch - 1 / Math.sqrt(d2)));
      this.events.push({ kind: 'collision', time: s.at, survivor: s.id[i], absorbed: s.id[j], speed: Math.sqrt(w2), heat: (0.5 * (gi * gj) / g * w2) / G, distance: d });
      this.drop(j);
    }
    this.met.length = 0;
  }

  /**
   * Who has left, and who goes round whom. From the whole system down its heavier side: while
   * the two halves of a pair are on an open orbit and parting, the lighter half has left, as the
   * families it splits into (down through its own open pairs to bound ones: bodies that merely
   * share a direction are not a family). An event when a family is first seen leaving, another
   * when it passes the edge. Light bodies leave with the family they go round, or on their own.
   * Then each body's primary: the heaviest body of the other half of the first bound pair, going
   * up, in which it is in the lighter half; a change to another body is an event.
   */
  private census(): void {
    const s = this.s;
    if (s.nn === 0) return;
    if (this.wFree.length !== s.free.length) this.wFree = new Uint8Array(s.free.length);
    this.wFree.fill(0);
    let k = s.nn - 1;
    while (k >= s.nm && s.kind[k] === ACTIVE) {
      conic(s.jr, s.jv, 3 * k, s.ngm[k]);
      if (oBound || !oOut) break;
      const heavy = this.within(s.top[k], s.cA[k]) ? s.cA[k] : s.cB[k];
      this.families(heavy === s.cA[k] ? s.cB[k] : s.cA[k], heavy);
      k = heavy;
    }
    for (let p = 0; p < s.np; p++) {
      if (s.pmode[p] !== LIVE || !this.within(k, s.phost[p])) continue;
      const o = 3 * p;
      conic(s.pr, s.pv, o, s.ngm[s.phost[p]]);
      if (!oBound && oOut) this.leaving(-1, p, s.pr[o] ** 2 + s.pr[o + 1] ** 2 + s.pr[o + 2] ** 2 > this.edge * this.edge);
    }
    // (what is bound again may leave again and be told again)
    s.free.set(this.wFree);
    for (let i = 0; i < s.n; i++) {
      const now = this.primary(i), was = s.around[i];
      if (now !== was && now >= 0 && was !== -2) this.events.push({ kind: 'orbit', time: s.at, id: s.id[i], around: now, was });
      s.around[i] = now;
    }
  }

  /** The bound families of the cluster `c`, which has left `from`: each told. */
  private families(c: number, from: number): void {
    const s = this.s, stack = this.wStack, edge2 = this.edge * this.edge;
    let top = 0;
    stack[top++] = c;
    while (top > 0) {
      const f = stack[--top];
      if (f >= s.nm && s.kind[f] === ACTIVE) {
        conic(s.jr, s.jv, 3 * f, s.ngm[f]);
        if (!oBound) { stack[top++] = s.cA[f]; stack[top++] = s.cB[f]; continue; }
      }
      const dx = s.cx[3 * f] - s.cx[3 * from], dy = s.cx[3 * f + 1] - s.cx[3 * from + 1], dz = s.cx[3 * f + 2] - s.cx[3 * from + 2];
      this.leaving(f, -1, dx * dx + dy * dy + dz * dz > edge2);
    }
  }

  /** The cluster `k` (or the light body `p` alone) is unbound, and `gone` if past the edge: told once each. */
  private leaving(k: number, p: number, gone: boolean): void {
    const s = this.s, level = gone ? 2 : 1;
    const ids: number[] = [];
    let fresh = false;
    for (let i = 0; i < s.n; i++) {
      const sl = s.slot[i];
      if (k >= 0 ? !this.within(sl >= 0 ? sl : s.phost[-1 - sl], k) : sl !== -1 - p) continue;
      if (s.free[i] < level) fresh = true;
      this.wFree[i] = level;
      ids.push(s.id[i]);
    }
    if (fresh) this.events.push({ kind: gone ? 'escape' : 'unbound', time: s.at, primary: k >= 0 ? s.id[s.leaf[s.top[k]]] : ids[0], ids });
  }

  /** The number of the body that body `i` goes round (see `census`), or -1. */
  private primary(i: number): number {
    const s = this.s, sl = s.slot[i];
    if (sl < 0) {
      const p = -1 - sl, host = s.phost[p];
      if (host < 0) return -1;
      conic(s.pr, s.pv, 3 * p, s.ngm[host]);
      return oBound ? s.id[s.leaf[s.top[host]]] : -1;
    }
    // (of two of one mass the second goes round the first: what goes round what never runs in a ring)
    for (let from = sl, k = s.par[sl]; k >= 0; from = k, k = s.par[k]) {
      const other = from === s.cA[k] ? s.cB[k] : s.cA[k];
      if (s.ngm[from] > s.ngm[other] || (s.ngm[from] === s.ngm[other] && from === s.cA[k])) continue;
      conic(s.jr, s.jv, 3 * k, s.ngm[k]);
      if (oBound) return s.id[s.leaf[s.top[other]]];
    }
    return -1;
  }

  // ------------------------------------------------------------------ what it is doing, and what it has

  /** What is being approximated now, and what sets the step. */
  report(): SimReport {
    const s = this.s;
    this.ready();
    const rails: SimReport['rails'] = [];
    const following: number[] = [];
    let pacedBy = -1, least = Infinity;
    this.rails();
    for (let k = s.nm; k < s.nn; k++) {
      if (s.kind[k] === FROZEN) {
        const members: number[] = [];
        for (let l = 0; l < s.nm; l++) if (this.within(l, k)) members.push(s.id[s.leaf[l]]);
        for (let p = 0; p < s.np; p++) if (s.pmode[p] === RAILS && this.within(s.phost[p], k)) members.push(s.id[s.pbody[p]]);
        rails.push({ primary: s.id[s.leaf[s.top[k]]], members });
      } else if (s.kind[k] === ACTIVE) {
        if (s.watch[k] & FOLLOW) following.push(s.id[s.leaf[s.top[s.cB[k]]]]);
        if (this.wPace[k] < least) { least = this.wPace[k]; pacedBy = s.id[s.leaf[s.top[s.cB[k]]]]; }
      }
    }
    for (let p = 0; p < s.np; p++) {
      if (s.pmode[p] === RAILS && !(s.phost[p] >= 0 && s.kind[s.phost[p]] >= FROZEN)) rails.push({ primary: s.id[s.pbody[p]], members: [s.id[s.pbody[p]]] });
      if (s.pmode[p] === LIVE && this.wPPace[p] < least) { least = this.wPPace[p]; pacedBy = s.id[s.pbody[p]]; }
    }
    const paced = least / this.steps, contact = this.closePace(), change = s.rate > 0 ? VARY / (this.steps * s.rate) : Infinity;
    const least2 = Math.min(paced, contact, change);
    const setBy = least2 === Infinity ? 'nothing' : least2 === paced ? 'orbit' : least2 === contact ? 'contact' : 'encounter';
    return { time: s.time, step: s.h, setBy, pacedBy, rails, following, light: s.np, misses: this.misses };
  }

  /**
   * Energy (J), momentum (kg m/s) and angular momentum (kg m²/s, about the origin) of the bodies at
   * `time`, as `read()` has them (the bodies with a mass: the others carry none).
   */
  energy(): number {
    this.read();
    const s = this.s, n = s.n, x = this.pos, v = this.vel;
    let kin = 0, pot = 0;
    for (let i = 0; i < n; i++) {
      const gi = s.gm[i];
      if (!(gi > 0)) continue;
      kin += 0.5 * gi * (v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2);
      for (let j = i + 1; j < n; j++) {
        if (!(s.gm[j] > 0)) continue;
        const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
        const r = Math.hypot(dx, dy, dz);
        const hole = s.rs[i] + s.rs[j];
        pot -= (gi * s.gm[j]) / (hole > 0 ? Math.max(r - hole, 1e-3 * hole) : r);
        // each one's bulge: GM J₂R² P₂(sin latitude) / r³
        pot += (gi * s.gm[j] * (level(s.zon[i], s.pole, 3 * i, dx, dy, dz, r) + level(s.zon[j], s.pole, 3 * j, dx, dy, dz, r))) / (r * r * r);
      }
    }
    return (kin + pot) / G;
  }

  momentum(out = new Float64Array(3)): Float64Array {
    this.read();
    const s = this.s, v = this.vel;
    out.fill(0);
    for (let i = 0; i < s.n; i++) for (let c = 0; c < 3; c++) out[c] += (s.gm[i] * v[3 * i + c]) / G;
    return out;
  }

  angularMomentum(out = new Float64Array(3)): Float64Array {
    this.read();
    const s = this.s, x = this.pos, v = this.vel;
    out.fill(0);
    for (let i = 0; i < s.n; i++) {
      const m = s.gm[i] / G, o = 3 * i;
      out[0] += m * (x[o + 1] * v[o + 2] - x[o + 2] * v[o + 1]);
      out[1] += m * (x[o + 2] * v[o] - x[o] * v[o + 2]);
      out[2] += m * (x[o] * v[o + 1] - x[o + 1] * v[o]);
    }
    return out;
  }

  /** Everything the simulation is, as plain numbers and arrays: `restore` carries on from it exactly. */
  snapshot(): NBodySnapshot {
    return { state: copyState(this.s), railsBelow: this.limit, lightRailsBelow: this.lightLimit, railsCross: this.cross, steps: this.perTurn, edge: this.edge, review: this.review } as unknown as NBodySnapshot;
  }

  /**
   * The bodies, settled (see NBodyBodies). Settling is what every change does: the run of equal
   * steps ends here, and the next step is planned afresh. A simulation made from what this returns
   * (`fromBodies`) and this one, made from it again, go on bit for bit alike.
   */
  bodies(): NBodyBodies {
    this.settle();
    const s = this.s, n = s.n, list = <T extends ArrayLike<number>>(a: T, k = 1) => Array.from({ length: k * n }, (_, i) => a[i]);
    return {
      time: s.time, nextId: s.nextId, ids: list(s.id), gm: list(s.gm), radius: list(s.radius), rs: list(s.rs), zon: list(s.zon), pole: list(s.pole, 3),
      free: list(s.free), pin: list(s.pin), around: list(s.around), x: list(s.x, 3), v: list(s.v, 3),
      railsBelow: this.limit, lightRailsBelow: this.lightLimit, railsCross: this.cross, steps: this.perTurn, edge: this.edge,
    };
  }

  /**
   * A simulation of the bodies `b` (as `bodies()` gives them), at their time, about to plan its
   * first step. Throws if they do not make one: lists of other lengths, a number used twice, a
   * mass, size or place that is not a finite number in range.
   */
  static fromBodies(b: NBodyBodies): NBody {
    const n = b.ids.length;
    const lengths = [b.gm, b.radius, b.rs, b.zon, b.free, b.pin, b.around].every((a) => a.length === n) && [b.pole, b.x, b.v].every((a) => a.length === 3 * n);
    if (!lengths) throw new Error('the lists of bodies do not agree');
    const fin = (x: number) => Number.isFinite(x);
    if (![b.time, b.railsBelow, b.lightRailsBelow, b.railsCross, b.steps].every(fin) || !(b.edge > 0) || !(b.steps >= 1) || !(b.railsBelow >= 0) || !(b.lightRailsBelow >= 0) || !(b.railsCross >= 0)) throw new Error('the simulation\'s settings are out of range');
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const id = b.ids[i];
      if (!Number.isInteger(id) || seen.has(id)) throw new Error(`body ${id}: not a number of its own`);
      seen.add(id);
      if (!(b.gm[i] >= 0 && fin(b.gm[i])) || !(b.radius[i] >= 0 && fin(b.radius[i])) || !(b.rs[i] >= 0 && fin(b.rs[i])) || !(b.zon[i] >= 0 && fin(b.zon[i]))) throw new Error(`body ${id}: a mass or size out of range`);
      if (![0, 1, 2].includes(b.free[i]) || ![0, 1].includes(b.pin[i]) || !Number.isInteger(b.around[i]) || b.around[i] < -2) throw new Error(`body ${id}: its state could not be read`);
      for (let c = 0; c < 3; c++) if (!fin(b.x[3 * i + c]) || !fin(b.v[3 * i + c]) || !fin(b.pole[3 * i + c])) throw new Error(`body ${id}: a place or motion out of range`);
    }
    for (let i = 0; i < n; i++) if (b.around[i] >= 0 && !seen.has(b.around[i])) throw new Error(`body ${b.ids[i]}: goes round a body that is not there`);
    if (!Number.isInteger(b.nextId) || b.ids.some((id) => id >= b.nextId)) throw new Error('the numbering of bodies could not be read');
    const sim = new NBody();
    sim.room(Math.max(8, n));
    const s = sim.s;
    s.n = n;
    for (let i = 0; i < n; i++) {
      s.id[i] = b.ids[i]; s.gm[i] = b.gm[i]; s.radius[i] = b.radius[i]; s.rs[i] = b.rs[i]; s.zon[i] = b.zon[i];
      s.free[i] = b.free[i]; s.pin[i] = b.pin[i]; s.around[i] = b.around[i];
      for (let c = 0; c < 3; c++) { s.pole[3 * i + c] = b.pole[3 * i + c]; s.x[3 * i + c] = b.x[3 * i + c]; s.v[3 * i + c] = b.v[3 * i + c]; }
    }
    s.nextId = b.nextId;
    s.time = s.at = s.t0 = b.time;
    s.layout = 1;
    sim.limit = b.railsBelow; sim.lightLimit = b.lightRailsBelow; sim.cross = b.railsCross; sim.perTurn = b.steps; sim.edge = b.edge;
    return sim;
  }

  static restore(snap: NBodySnapshot): NBody {
    const sim = new NBody();
    const from = snap as unknown as { state: State; railsBelow: number; lightRailsBelow: number; railsCross: number; steps: number; edge: number; review: boolean };
    sim.s = copyState(from.state);
    sim.limit = from.railsBelow;
    sim.lightLimit = from.lightRailsBelow;
    sim.cross = from.railsCross;
    sim.perTurn = from.steps;
    sim.edge = from.edge;
    sim.review = from.review;
    sim.workroom();
    return sim;
  }
}
