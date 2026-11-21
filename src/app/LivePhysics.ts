import type { SimClock } from '../core/time';
import { AU, DAY } from '../core/units';
import { LEFT_OUT, type SimEvent } from '../sim/NBody';
import { apply, capture, type Live, liveDate, release, riders } from '../sim/SystemSim';
import type { Body } from '../universe/Body';
import type { SolarSystem } from '../universe/SolarSystem';
import { dayWords, listed, type Orbit, orbitOf, reachWords, shapeWords, speedWords, the } from './Powers';

/**
 * Live physics: the Solar System under its own gravity, from the moment the explorer changes
 * something in it (the owner's rule: the real universe stays real until you touch it; then that
 * system is simulated, and one button goes back to reality).
 *
 * Until then nothing here does anything, and the bodies are where the ephemeris has them. The
 * first change starts a simulation (src/sim/NBody.ts) from where every body is at that date and
 * how it moves; from then on the clock follows the simulation, each frame the bodies are put
 * where it has them, what it tells of (a collision, a world thrown out, a capture) is put into
 * words, and `Body.parent` is what each body goes round now. `backToReality` undoes all of it.
 *
 * What is simulated from the start: the Sun, the planets, Pluto, Ceres and the seven asteroids
 * that have been weighed, and the twenty moons heavy enough to matter to anything (Mimas and up).
 * Every other body (a moon too light to pull on anything, or of unknown mass; an asteroid nobody
 * has weighed) rides on what it goes round in the catalogue, on its catalogued path, until that
 * body or it is changed or taken away: then it is simulated too, one of unknown mass as a body
 * that is pulled and does not pull. (The catalogue's places for the smallest moons are not a
 * state their orbits can keep: Saturn's Helene, which shares Dione's orbit, runs into Dione
 * within twenty years if it is stepped from where the catalogue has it.)
 *
 * Nothing here knows of the page or of the renderer: `LiveScene` is what it asks of the app.
 */

/** What live physics asks of whoever shows the bodies. */
export interface LiveScene {
  /** `b` is no longer there: taken away, or made one with `into` */
  left(b: Body, into: Body | null): void;
}

/** a moon is simulated from the start if G times its mass is at least this (m³/s²): Mimas, the least of the round ones, has 2.5 times it */
const MOON_GM = 1e9;
/** What live physics leaves out besides what the simulation itself does (NBody's LEFT_OUT), in plain words. */
const ALSO_LEFT_OUT: readonly string[] = [
  'A moon too light to pull on anything, and a world whose mass is not known, keeps its real path round its planet until you change that planet or it.',
  'A world keeps its size and its look whatever mass you give it. What theory says it would turn into is told, not shown.',
  'The 75,000 small asteroids of the belt and the comets cannot be simulated one by one: they keep their real paths while the Sun is as it was, and are left out once you change it or take it away. The real spacecraft are left out too: they flew their paths in the real Solar System.',
  'Run backwards, time undoes what gravity did, but two bodies that have become one stay one.',
];
/** an unbound body this far from what it left has left for good */
const EDGE = 2000 * AU;
/** the stepping may take this share of a frame, and between these many milliseconds */
const BUDGET_SHARE = 0.25, BUDGET_MIN = 3, BUDGET_MAX = 12;
/**
 * A family of moons whose every orbit would go round in less than this many seconds on the screen
 * is carried on rails (NBody.railsBelow): at a year a second a moon is a blur anyway, and stepping
 * each of its turns would leave no time for the planets. If the stepping still cannot keep up with
 * the time asked for, more is carried, a stage at a time, until another rate is asked for: first
 * the larger figure is used, then families whose moons cross each other's paths are carried too
 * (NBody.railsCross). What goes round a star is always stepped.
 */
const RAILS_SECONDS = [2, 20, 20], RAILS_CROSS = [undefined, undefined, 1];
/** the stepping "cannot keep up" when it has managed less than this share of the time asked for... */
const PRESSED_BELOW = 0.75;
/** ...for this many frames at one stage */
const PRESSED_AFTER = 40;
/** as many events are kept as this */
const LOG_MOST = 60;

interface Real { gm: number; systemGm: number; radius: number; radii: [number, number, number] }

export interface LiveStatus {
  /** the day it began, in words */
  since: string;
  /** the share of the time asked for that the simulation manages (1: all of it) */
  share: number;
  /** what is carried on rails now, in words ('' when everything is stepped) */
  rails: string;
  /** what the simulation leaves out, always */
  leftOut: readonly string[];
  /** what has happened, newest first */
  log: { day: string; text: string }[];
}

export class LivePhysics {
  /** the simulation, once something has been changed */
  live: Live | null = null;
  /** what has happened, oldest first */
  readonly log: { jd: number; text: string }[] = [];
  private news: string[] = [];
  /** the catalogue's values of the bodies whose mass or size has been changed */
  private real = new Map<Body, Real>();
  private share = 1;
  /** the rate of time what is on rails was last chosen for (simulated seconds a second), for how many frames the stepping has fallen short at it, and how far more has been put on rails for that */
  private rate = 0;
  private slowFor = 0;
  private stage = 0;
  /** the simulation's own word on which moons may cross on rails */
  private cross = 0;

  constructor(private system: SolarSystem, private scene: LiveScene) {}

  get on(): boolean {
    return this.live !== null;
  }

  /** Is this body's motion the simulation's now (and not the ephemeris's)? */
  simulated(b: Body): boolean {
    return !!this.live && this.live.index.has(b);
  }

  /** The bodies whose motion is the simulation's. */
  bodies(): Iterable<Body> {
    return this.live ? this.live.index.keys() : [];
  }

  /** G times the mass the catalogue gives a body (m³/s²), whatever it has been given since. */
  realGm(b: Body): number {
    return this.real.get(b)?.gm ?? b.gm;
  }

  /**
   * Are the asteroids and comets that are not bodies of their own (the belt's 75,000, the comets)
   * where they belong? They are drawn on their catalogued paths round the Sun and cannot be
   * simulated one by one: once the Sun is changed or gone they are left out.
   */
  get sunAsWas(): boolean {
    const sun = this.system.sun;
    return !this.live || (!this.system.isGone(sun) && sun.gm === this.realGm(sun));
  }

  // ------------------------------------------------------------------ the powers

  /** Give a body another mass (G times it, m³/s²): its pull changes from now on, its size and look stay. */
  setMass(b: Body, gm: number, jd: number): void {
    const live = this.start(jd);
    this.keep(b);
    // (what rides on it would keep its catalogued path round a body that no longer pulls as it did)
    release(live, this.system, [b, ...riders(live, this.system, b)]);
    live.sim.setMass(b.id, gm);
    b.systemGm += gm - b.gm;
    b.gm = gm;
    this.settle(live);
  }

  /**
   * Put a body somewhere else (`pos`: m from the system's centre), moving at `vel` there (m/s).
   * What goes round it comes with it, keeping its place and its motion about it.
   */
  move(b: Body, pos: ArrayLike<number>, vel: ArrayLike<number>, jd: number): void {
    const live = this.start(jd);
    release(live, this.system, b);
    const d = [pos[0] - b.pos.x, pos[1] - b.pos.y, pos[2] - b.pos.z], w = [vel[0] - b.vel.x, vel[1] - b.vel.y, vel[2] - b.vel.z];
    // (the simulated bodies that go round it, and round those; what rides on any of them follows by itself)
    const family = [...live.index.keys()].filter((m) => goesRound(m, b));
    for (const m of [b, ...family]) {
      live.sim.setState(m.id, [m.pos.x + d[0], m.pos.y + d[1], m.pos.z + d[2]], [m.vel.x + w[0], m.vel.y + w[1], m.vel.z + w[2]]);
    }
    this.settle(live);
  }

  /**
   * The body that holds sway at a place (m from the system's centre): the one a small body put
   * there would go round, by the measure of Laplace's sphere of influence (distance to the fifth
   * power over mass squared: the simulation's own for pairing bodies). Never `but` itself, nor
   * what goes round it. Null where nothing has a mass.
   */
  swayAt(pos: ArrayLike<number>, but: Body): Body | null {
    let best: Body | null = null, least = Infinity;
    for (const q of this.system.bodies) {
      if (q === but || !q.valid || !(q.gm > 0) || goesRound(q, but)) continue;
      const d = Math.hypot(pos[0] - q.pos.x, pos[1] - q.pos.y, pos[2] - q.pos.z);
      const measure = d ** 5 / (q.gm + but.gm) ** 2;
      if (measure < least) { least = measure; best = q; }
    }
    return best;
  }

  /** A body that has just been made joins the simulation, if there is one. */
  join(b: Body): void {
    const live = this.live;
    if (!live) return;
    release(live, this.system, b);
    this.settle(live);
  }

  /** Take a body away: everything else carries on without it. */
  remove(b: Body, jd: number): void {
    const live = this.start(jd);
    release(live, this.system, riders(live, this.system, b));
    if (live.sim.indexOf(b.id) >= 0) live.sim.remove(b.id);
    this.depart(b, null);
    this.tell(liveDate(live), `${capital(the(b.name))} is gone.`);
    this.settle(live);
  }

  // ------------------------------------------------------------------ each frame

  /**
   * Take the simulation to the clock's date, or as near as the frame's share of work allows, and
   * set the clock to where it got: in live physics the simulation keeps the time. `frameSeconds`:
   * how long a frame takes now.
   */
  follow(clock: SimClock, frameSeconds: number): void {
    const live = this.live;
    if (!live) return;
    const want = (clock.jdTdb - liveDate(live)) * DAY;
    if (want === 0) return;
    const budget = Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, BUDGET_SHARE * frameSeconds * 1000));
    // (the rate as it is, whoever sets it: the clock, the ship's own; not for every small change of it)
    const rate = Math.abs(want) / Math.max(frameSeconds, 1e-3);
    if (rate > 2 * this.rate || rate < this.rate / 2) { this.rate = rate; this.slowFor = 0; this.stage = 0; }
    live.sim.railsBelow = live.sim.lightRailsBelow = RAILS_SECONDS[this.stage] * this.rate;
    live.sim.railsCross = RAILS_CROSS[this.stage] ?? this.cross;
    const moved = live.sim.advance(want, budget);
    this.share += (moved / want - this.share) * 0.15;
    this.slowFor = this.share < PRESSED_BELOW ? this.slowFor + 1 : 0;
    if (this.slowFor > PRESSED_AFTER && this.stage < RAILS_SECONDS.length - 1) { this.stage++; this.slowFor = 0; }
    clock.jdTdb = liveDate(live);
    this.hear(live);
  }

  /**
   * Put the bodies where the simulation has them (after `SolarSystem.update` for the same date,
   * which gives those it leaves out their own motion), each going round what it goes round now.
   */
  place(jd: number): void {
    const live = this.live;
    if (!live) return;
    const system = this.system;
    apply(live, system);
    const primaries = live.sim.primaries;
    for (const [b, i] of live.index) {
      const id = primaries[i];
      if (id === -2) continue;
      const p = id >= 0 ? system.byId.get(id) ?? null : null;
      if (b.parent !== p && !(p && system.isGone(p))) system.adopt(b, p);
      // (a moon keeps a face to what it goes round, wherever that is now)
      if (b.kind === 'moon') system.updateOrientation(b, jd);
    }
  }

  /** What has been said since the last call, oldest first. */
  takeNews(): string[] {
    const n = this.news;
    this.news = [];
    return n;
  }

  // ------------------------------------------------------------------ back to reality

  /**
   * End it: every body as the catalogue has it and where the ephemeris has it, at the date the
   * simulation reached if the ephemeris covers that date, else at the date it began. Returns what
   * to tell the explorer.
   */
  backToReality(clock: SimClock): string {
    const live = this.live;
    if (!live) return '';
    const reached = liveDate(live);
    const known = this.system.ephemeris.inRange(reached);
    for (const [b, r] of this.real) { b.gm = r.gm; b.systemGm = r.systemGm; b.radius = r.radius; b.radii = r.radii; }
    this.real.clear();
    this.system.settle();
    this.live = null;
    this.log.length = 0;
    this.news = [];
    this.share = 1;
    clock.jdTdb = known ? reached : live.jd0;
    this.system.update(clock.jdTdb);
    return known ? 'Back to reality' : `Back to reality, on ${dayWords(live.jd0)}: where the real planets are is only known from 1849 to 2150`;
  }

  // ------------------------------------------------------------------ telling

  /** What to show of the simulation as a whole. */
  status(): LiveStatus | null {
    const live = this.live;
    if (!live) return null;
    const report = live.sim.report(), name = (id: number) => this.system.byId.get(id)?.name ?? '?';
    const families = report.rails.filter((r) => r.members.length > 1).map((r) => name(r.primary));
    const alone = report.rails.length - families.length;
    const rails = [
      ...(families.length ? [`${listed(families, 4)} with ${families.length > 1 ? 'their' : 'its'} moons`] : []),
      ...(alone ? [`${alone} small ${alone > 1 ? 'bodies' : 'body'}`] : []),
    ].join(', and ');
    return {
      since: dayWords(live.jd0), share: Math.max(0, Math.min(1, this.share)), rails, leftOut: [...LEFT_OUT, ...ALSO_LEFT_OUT],
      log: this.log.slice(-12).reverse().map((e) => ({ day: dayWords(e.jd), text: e.text })),
    };
  }

  /** The orbit a body is on now about what it goes round, or null (it goes round nothing, or its mass and its primary's are unknown). */
  orbit(b: Body): Orbit | null {
    const p = b.parent;
    if (!p || !(p.gm + b.gm > 0)) return null;
    return orbitOf([b.pos.x - p.pos.x, b.pos.y - p.pos.y, b.pos.z - p.pos.z], [b.vel.x - p.vel.x, b.vel.y - p.vel.y, b.vel.z - p.vel.z], p.gm + b.gm);
  }

  /** What a body's details say of it while physics is live: whether it is simulated, what it goes round, the orbit it is on. */
  rows(b: Body): [string, string][] {
    const live = this.live;
    if (!live) return [];
    if (!this.simulated(b)) {
      const round = the(this.system.homeOf(b)?.name ?? 'Sun');
      return [['Live physics', `not simulated: it keeps its real path round ${round} (${b.gm > 0 ? `it is too light to matter until it or ${round} is changed` : 'its mass is not known'})`]];
    }
    const rows: [string, string][] = [['Live physics', `simulated since ${dayWords(live.jd0)}`]];
    const o = this.orbit(b);
    if (!b.parent) rows.push(['Goes round', 'nothing: it flies free']);
    else rows.push(['Goes round', the(b.parent.name)]);
    if (o) rows.push(["Its orbit's shape", shapeWords(o)], ['Nearest to farthest · once round', reachWords(o)]);
    return rows;
  }

  // ------------------------------------------------------------------ inside

  /** The simulation, started now if this is the first change. */
  private start(jd: number): Live {
    if (this.live) return this.live;
    const live = capture(this.system, jd, (b) => b.gm > 0 && (b.kind !== 'moon' || b.gm >= MOON_GM));
    live.sim.edge = EDGE;
    this.live = live;
    this.rate = 0;
    this.cross = live.sim.railsCross;
    this.settle(live);
    return live;
  }

  /** After a change: who goes round whom now, told at once (also while time stands still), and the bodies put there. */
  private settle(live: Live): void {
    live.sim.advance(0);
    this.hear(live);
    this.system.update(liveDate(live));
    this.place(liveDate(live));
  }

  /** Remember a body's catalogued mass and size before the first change to them. */
  private keep(b: Body): void {
    if (!this.real.has(b)) this.real.set(b, { gm: b.gm, systemGm: b.systemGm, radius: b.radius, radii: [b.radii[0], b.radii[1], b.radii[2]] });
  }

  /** A body leaves the scene: what went round it goes round what it went round, until the simulation says otherwise. */
  private depart(b: Body, into: Body | null): void {
    for (const c of [...b.children]) this.system.adopt(c, into ?? b.parent);
    this.system.setGone(b, true);
    this.scene.left(b, into);
  }

  /** Something has happened: into the log, and told now. */
  private tell(jd: number, text: string): void {
    this.note(jd, text);
    this.news.push(text);
  }

  /** ...or into the log alone. */
  private note(jd: number, text: string): void {
    this.log.push({ jd, text });
    if (this.log.length > LOG_MOST) this.log.shift();
  }

  /** Put what the simulation tells of into words, and into effect: a body absorbed leaves the scene, its mass and size go to the survivor. */
  private hear(live: Live): void {
    const events = live.sim.takeEvents();
    if (!events.length) return;
    const system = this.system;
    // (told for the moment it happened: at a hundred years a second a frame is a long time)
    const when = (e: SimEvent) => live.jd0 + e.time / DAY;
    const body = (id: number) => system.byId.get(id);
    const free: Body[] = [], left: Body[] = [], caught: Extract<SimEvent, { kind: 'orbit' }>[] = [];
    let jd = liveDate(live);
    // Collisions first, and of those every body that is gone before anything else is looked at:
    // one the simulation no longer has must not be taken for one that rides along on its planet.
    const hits = events.filter((e) => e.kind === 'collision');
    const lost = hits.map((e) => this.absorbed(live, e));
    hits.forEach((e, k) => this.grown(live, e, lost[k], when(e)));
    for (const e of events) {
      if (e.kind === 'collision') continue;
      if (e.kind === 'unbound' || e.kind === 'escape') {
        const b = body(e.primary);
        if (b && !system.isGone(b)) (e.kind === 'unbound' ? free : left).push(b);
        jd = Math.min(jd, when(e));
      } else if (e.kind === 'orbit') caught.push(e);
      else {
        const a = body(e.a), b = body(e.b);
        // (a close pass is kept for the log: it is told only if it was nearly a hit)
        if (a && b && isWorld(a) && isWorld(b)) {
          const text = `${capital(the(a.name))} and ${the(b.name)} passed ${passWords(e.distance)} apart, at ${speedWords(e.speed)}.`;
          if (e.distance < 10 * (a.radius + b.radius)) this.tell(when(e), text);
          else this.note(when(e), text);
        }
      }
    }
    // the worlds are told by name; the small bodies with them only as how many (alone, they are not told at all:
    // an asteroid drifting off is no news)
    const flying = (list: Body[], one: string, many: string) => {
      const worlds = list.filter(isWorld).sort((a, b) => b.gm - a.gm), small = list.length - worlds.length;
      if (!worlds.length) return;
      const names = worlds.map((b, k) => (k === 0 ? capital(the(b.name)) : the(b.name)));
      this.tell(jd, `${listed(names)} ${worlds.length > 1 ? many : one}${small ? ` So ${worlds.length > 1 ? 'are' : 'is'} ${small} smaller ${small > 1 ? 'bodies' : 'body'}.` : ''}`);
    };
    flying(free, 'is flying free: nothing holds it now.', 'are flying free: nothing holds them now.');
    flying(left, 'has left for good.', 'have left for good.');
    // a change of what a world goes round
    const moved = caught.filter((e) => { const b = body(e.id), p = body(e.around); return b && p && isWorld(b) && !system.isGone(b) && !system.isGone(p) && !free.includes(b); })
      .sort((x, y) => body(y.id)!.gm - body(x.id)!.gm);
    for (const e of moved.slice(0, 3)) {
      const b = body(e.id)!, p = body(e.around)!, w = e.was >= 0 ? body(e.was) : undefined;
      this.tell(when(e), w && !system.isGone(w) ? `${capital(the(b.name))} goes round ${the(p.name)} now, no longer round ${the(w.name)}.` : `${capital(the(b.name))} goes round ${the(p.name)} now.`);
    }
    if (moved.length > 3) this.tell(when(moved[3]), `${moved.length - 3} more worlds have changed what they go round.`);
  }

  /** Two bodies have become one: the one absorbed leaves the scene, and what rode on it with it (there is nowhere to say where that would be by now). Returns how many rode on it. */
  private absorbed(live: Live, e: Extract<SimEvent, { kind: 'collision' }>): number {
    const system = this.system, s = system.byId.get(e.survivor), a = system.byId.get(e.absorbed);
    if (!s || !a) return 0;
    const lost = riders(live, system, a);
    for (const r of lost) this.depart(r, null);
    this.depart(a, s);
    return lost.length;
  }

  /** ...and the survivor has the mass of both, and their volume; it is told. */
  private grown(live: Live, e: Extract<SimEvent, { kind: 'collision' }>, lost: number, jd: number): void {
    const system = this.system, s = system.byId.get(e.survivor), a = system.byId.get(e.absorbed);
    if (!s || !a) return;
    // (what rode on it is simulated from here on: it pulls harder than the body their catalogued paths are round)
    release(live, system, riders(live, system, s));
    const i = live.sim.indexOf(s.id);
    // (one that has since been absorbed itself, in the same moment: it is gone, and what took it in has its mass)
    if (i >= 0) {
      this.keep(s);
      const k = live.sim.radius[i] / s.radius;
      s.systemGm += live.sim.gm[i] - s.gm;
      s.gm = live.sim.gm[i];
      s.radius *= k;
      s.radii = [s.radii[0] * k, s.radii[1] * k, s.radii[2] * k];
    }
    this.tell(jd, `${capital(the(a.name))} hit ${the(s.name)} at ${speedWords(e.speed)} and is part of it now.${lost ? ` ${lost} small moon${lost > 1 ? 's' : ''} went with it.` : ''}`);
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Does `m` go round `b`, directly or as a moon of something that does? */
function goesRound(m: Body, b: Body): boolean {
  for (let p = m.parent; p; p = p.parent) if (p === b) return true;
  return false;
}
/** a body worth telling of by name: a star, a planet or a dwarf planet, or a moon heavy enough to be weighed */
const isWorld = (b: Body) => b.kind === 'star' || b.kind === 'planet' || b.kind === 'dwarf' || (b.kind === 'moon' && b.gm > 0);

/** How near two bodies passed, in words. */
function passWords(m: number): string {
  return m >= 0.01 * AU ? `${Number((m / AU).toPrecision(2))} AU` : `${Math.round(m / 1e3).toLocaleString('en-US')} km`;
}
