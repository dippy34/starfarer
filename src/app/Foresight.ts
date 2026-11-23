import { NBody, type NBodySnapshot } from '../sim/NBody';

/**
 * The future, drawn (version 1: the world touched). While a finger holds a world, aims a throw or
 * is on the mass slider, the simulation is run ahead on a copy of itself (the same engine, every
 * body pulling, not the two-body orbit the orbit line is) to show where that world will really go,
 * and what ends it: hitting another, leaving for good, or going round something else. It grows a
 * few milliseconds a frame (src/app/App.ts gives it the time the stepping of the paused simulation
 * is not using), up to three turns of the world or a hundred years. It works on numbers alone: it
 * never touches the bodies of the scene, nor what live physics tells (src/render/Futures.ts draws
 * the path, the app says what ends it).
 */

/** places kept along the way, at most */
export const AHEAD_MOST = 640;
/** a place is kept each time the world has turned this far about what it goes round (rad)... */
const TURN = (2 * Math.PI) / 96;
/** ...or gone this share of its distance from it (a fall, an open path), or after a step of time (a 96th of a turn) */
const STRIDE = 0.03;
/** it looks this far ahead at most: three turns, or a hundred years (s) */
const TURNS = 3, LONGEST = 100 * 365.25 * 86_400;
/** the copy goes in steps of this share of a place's time, so that a place is kept where it falls due */
const SPLIT = 4;

/** What ends the look ahead, `time` seconds on: the world hits `other`, is torn apart by the tides of `by`, leaves for good, or goes round `around` instead of `was` (-1: nothing). */
export type Ending =
  | { kind: 'hit'; other: number; time: number }
  | { kind: 'torn'; by: number; time: number }
  | { kind: 'leaves'; time: number }
  | { kind: 'round'; around: number; was: number; time: number };

export class Foresight {
  /** the world looked ahead for, and what it goes round as the look begins (its number in the simulation; -1 nothing) */
  id = -1;
  around = -1;
  /** where it will be, from what it goes round (m; three numbers a place), and when (the simulation's own time, s), `count` places, the first where it is now, at `from` */
  readonly at = new Float64Array(3 * AHEAD_MOST);
  readonly times = new Float64Array(AHEAD_MOST);
  count = 0;
  from = 0;
  /** what ended it (null: nothing yet, or it ran its length) */
  end: Ending | null = null;
  /** it has looked as far as it will */
  done = true;
  private sim: NBody | null = null;
  private step = 0;
  /** how far it has looked (s from the start) */
  private t = 0;
  private turned = 0;
  private rel = new Float64Array(3);

  /**
   * Look ahead from `snap` (live.sim.snapshot()) for the world numbered `id`, which goes round
   * `around` (-1: nothing) once in `turn` seconds (the orbit it is on now; for an open path, the
   * time a circle would take where it is). What goes round faster than a quarter of that is carried
   * on rails, as live physics would carry it while the change is watched (a watch runs at an eighth
   * of the quickest turn a second, and live physics carries what goes round in less than two
   * seconds of that): the path is the one time will take, when nothing else changes.
   */
  start(snap: NBodySnapshot, id: number, around: number, turn: number): void {
    const sim = NBody.restore(snap);
    sim.railsBelow = sim.lightRailsBelow = turn / 4;
    // (what the live simulation had still to tell is no news of the future)
    sim.takeEvents();
    this.sim = sim;
    this.id = id;
    this.around = around;
    this.from = sim.time;
    this.step = turn / 96;
    this.t = 0;
    this.turned = 0;
    this.count = 0;
    this.end = null;
    this.done = false;
    this.keep(this.place()!);
  }

  /** Stop looking (the hold is over): the copy is let go. */
  stop(): void {
    this.sim = null;
    this.done = true;
  }

  /** Look on, for `budgetMs` milliseconds of work at most. */
  grow(budgetMs: number, now: () => number = () => performance.now()): void {
    const sim = this.sim;
    if (!sim || this.done) return;
    const until = now() + budgetMs;
    while (!this.done) {
      const left = until - now();
      if (left <= 0) return;
      const to = this.from + this.t + this.step / SPLIT;
      sim.advance(to - sim.time, left);
      if (this.heard()) return;
      // (out of time before the step was over: on from there next frame)
      if (to - sim.time > 1e-6 * this.step) return;
      this.t += this.step / SPLIT;
      const p = this.place();
      if (!p) { this.done = true; return; }
      if (this.due(p)) this.keep(p);
      if (this.turned >= TURNS * 2 * Math.PI || this.t >= LONGEST || this.count >= AHEAD_MOST) this.done = true;
    }
  }

  /** Where the world is in the copy now, from what it went round as the look began; null if the copy no longer has it. */
  private place(): Float64Array | null {
    const sim = this.sim!;
    sim.read();
    const i = sim.indexOf(this.id), j = this.around >= 0 ? sim.indexOf(this.around) : -1;
    if (i < 0) return null;
    for (let c = 0; c < 3; c++) this.rel[c] = sim.pos[3 * i + c] - (j >= 0 ? sim.pos[3 * j + c] : 0);
    return this.rel;
  }

  /** Is a place due: has it turned far enough, or gone far enough, or has a step of time gone by since the last? */
  private due(p: Float64Array): boolean {
    const k = 3 * (this.count - 1), a = this.at;
    const d = Math.hypot(p[0], p[1], p[2]), e = Math.hypot(a[k], a[k + 1], a[k + 2]);
    const turned = Math.acos(Math.max(-1, Math.min(1, (p[0] * a[k] + p[1] * a[k + 1] + p[2] * a[k + 2]) / (d * e || 1))));
    const moved = Math.hypot(p[0] - a[k], p[1] - a[k + 1], p[2] - a[k + 2]);
    if (turned < TURN && moved < STRIDE * d && this.sim!.time - this.times[this.count - 1] < this.step) return false;
    this.turned += turned;
    return true;
  }

  private keep(p: Float64Array): void {
    const k = this.count++;
    this.at[3 * k] = p[0];
    this.at[3 * k + 1] = p[1];
    this.at[3 * k + 2] = p[2];
    this.times[k] = this.sim!.time;
  }

  /**
   * What the copy has to tell: the world hit another, left for good, or goes round something else
   * now. That ends the look, with a last place where it ended (the world they became, for a hit).
   */
  private heard(): boolean {
    const sim = this.sim!, id = this.id;
    for (const e of sim.takeEvents()) {
      const time = e.time - this.from;
      let end: Ending | null = null;
      if (e.kind === 'collision' && (e.survivor === id || e.absorbed === id)) end = { kind: 'hit', other: e.survivor === id ? e.absorbed : e.survivor, time };
      else if (e.kind === 'torn' && e.id === id) end = { kind: 'torn', by: e.by, time };
      else if ((e.kind === 'unbound' || e.kind === 'escape') && e.ids.includes(id)) end = { kind: 'leaves', time };
      else if (e.kind === 'orbit' && e.id === id && e.around !== this.around) end = e.around < 0 ? { kind: 'leaves', time } : { kind: 'round', around: e.around, was: e.was, time };
      if (!end) continue;
      this.end = end;
      this.done = true;
      // (the last place: where it is now, a moment past; one taken in by another ends where that one is; one torn apart where
      // it came apart, from what it went round as the look began)
      if (e.kind === 'torn') {
        const sim = this.sim!, j = this.around >= 0 ? sim.indexOf(this.around) : -1;
        sim.read();
        for (let c = 0; c < 3; c++) this.rel[c] = e.pos[c] - (j >= 0 ? sim.pos[3 * j + c] : 0);
        if (this.count < AHEAD_MOST) this.keep(this.rel);
        this.sim = null;
        return true;
      }
      const into = end.kind === 'hit' && e.kind === 'collision' && e.absorbed === id ? e.survivor : id;
      const was = this.id;
      this.id = into;
      const p = this.place();
      this.id = was;
      if (p && this.count < AHEAD_MOST) this.keep(p);
      this.sim = null;
      return true;
    }
    return false;
  }
}
