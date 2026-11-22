import { Matrix4, Quaternion, Vector3 } from 'three';
import type { UPos } from '../core/upos';
import type { Body } from '../universe/Body';
import type { SolarSystem } from '../universe/SolarSystem';
import type { CameraRig } from './CameraRig';
import { goesRound, type LivePhysics, weighty } from './LivePhysics';
import { affected, WATCH_SECONDS, WATCH_SLOWEST, type Watched, watchPlan, type Weighed } from './Powers';

/**
 * Watch it happen: after a change, time runs for WATCH_SECONDS at a pace at which what follows can
 * be seen (src/app/Powers.ts: watchPlan), while the camera eases to a frame that holds the worlds
 * the change matters to (`Glide`). Then the explorer's own rate of time comes back, and Replay is
 * offered: the moment just after the change again, watched again (the simulation goes the same
 * way twice). A finger on the view takes the camera back at once, and time keeps the watch's pace;
 * Stop gives the rate back as well. The app (src/app/App.ts) asks for each of these; this is the
 * planning and the bookkeeping, kept clear of the page so that it can be tested by itself.
 */

/** The rate of time as the explorer set it (the step of App's rates, its direction, the clock's rate, paused): what a watch puts back. */
export interface RateState { index: number; sign: number; rate: number; paused: boolean }

/** what the explorer can do to the worlds, one gesture each */
export type ChangeKind = 'mass' | 'move' | 'add' | 'remove';
/** A world as a change finds it: G times its mass (m³/s²), where it is (m), how it moves (m/s), how long once round takes it (s; Infinity: open, or round nothing). */
export interface Sampled { gm: number; pos: [number, number, number]; vel: [number, number, number]; period: number }
/** How a change is watched: the pace (simulated seconds a second), the frame's centre and how far the frame reaches (m; no centre: the camera stays). */
export interface WatchFrame { rate: number; radius: number; centre: Body | null }

/**
 * The worlds that matter to what is seen of a change (LivePhysics: weighty), and the one it is made
 * to: each one's mass, place and motion, and how long the orbit it is on takes once round.
 */
export function sample(physics: LivePhysics, system: SolarSystem, touched: Body): Map<Body, Sampled> {
  const out = new Map<Body, Sampled>();
  for (const b of system.bodies) {
    if (!b.valid || system.isGone(b) || (b !== touched && !weighty(b))) continue;
    const o = physics.orbit(b);
    out.set(b, { gm: b.gm, pos: [b.pos.x, b.pos.y, b.pos.z], vel: [b.vel.x, b.vel.y, b.vel.z], period: o?.bound ? o.period : Infinity });
  }
  return out;
}

/**
 * How a change of `kind` to `body` is watched, from the worlds as it found them (`before`) and as
 * it left them (`after`), framed round `centre`, no faster than `most` (null: none of the worlds it
 * matters to goes round anything to be seen). The worlds it matters to are those whose
 * acceleration it changes by a hundredth or more (Powers.affected), weighed at one moment: the one
 * moved and what goes round it where they were and where they are, the rest where they are now.
 * The centre of a world taken away is the place it would have gone on to: it has no mass to frame
 * round, and nothing to turn round.
 */
export function planChange(kind: ChangeKind, body: Body, before: ReadonlyMap<Body, Sampled>, after: ReadonlyMap<Body, Sampled>, centre: Body | null, most: number): WatchFrame | null {
  const moved = (b: Body) => kind === 'move' && (b === body || goesRound(b, body));
  const was: Weighed[] = [...before].map(([b, s]) => ({ id: b.id, gm: s.gm, pos: moved(b) || !after.has(b) ? s.pos : after.get(b)!.pos }));
  const now: Weighed[] = [...after].map(([b, s]) => ({ id: b.id, gm: s.gm, pos: s.pos }));
  const hit = new Set(affected(was, now));
  const worlds: Watched[] = [...after].filter(([b]) => hit.has(b.id)).map(([b, s]) => ({ ...s, was: before.get(b)?.period ?? Infinity }));
  const plan = watchPlan(worlds, centre && { gm: kind === 'remove' ? 0 : centre.gm, pos: centre.pos.toArray(), vel: centre.vel.toArray() }, most);
  return plan && { rate: plan.rate, radius: plan.radius, centre: plan.radius > 0 ? centre : null };
}

/** the stepping is behind when it has managed less than this share of the time asked for lately (LivePhysics' own measure)... */
const BEHIND = 0.75;
/**
 * ...for this many frames running: the watch then goes this much slower. (Not by half: live
 * physics takes a change of the rate by a factor of two as a new rate, and starts again on what
 * it carries on rails; and before it would carry more on rails, which it does after 40 frames.)
 */
const BEHIND_FRAMES = 12, SLOWER = 0.6;
/** Replay is offered for this long after a watch (s) */
export const REPLAY_OFFERED = 30;

export class Watch {
  /** watching: time runs at `rate`; ended: Replay is offered; idle: neither */
  state: 'idle' | 'watching' | 'ended' = 'idle';
  /** how fast time runs while watching (simulated seconds a second) */
  rate = 0;
  /** how much of the watch is left (s), and how much simulated time it has shown (s) */
  left = 0;
  shown = 0;
  private saved: RateState | null = null;
  private behind = 0;
  private offered = 0;

  get watching(): boolean {
    return this.state === 'watching';
  }

  /** Begin watching at `rate`; `saved` is the rate of time to come back to. */
  start(rate: number, saved: RateState): void {
    this.state = 'watching';
    this.rate = rate;
    this.left = WATCH_SECONDS;
    this.shown = 0;
    this.saved = saved;
    this.behind = 0;
  }

  /**
   * A frame of `dt` seconds, in which `ran` simulated seconds went by and the stepping managed
   * `share` of the time asked for lately. 'slower': the rate was lowered, the stepping not keeping
   * up; 'over': the watch has run its course (`stop` says what to put back).
   */
  tick(dt: number, ran: number, share: number): 'slower' | 'over' | null {
    if (this.state === 'ended') {
      this.offered -= dt;
      if (this.offered <= 0) this.state = 'idle';
      return null;
    }
    if (this.state !== 'watching') return null;
    this.shown += Math.abs(ran);
    this.left -= dt;
    if (this.left <= 0) return 'over';
    this.behind = share < BEHIND ? this.behind + 1 : 0;
    if (this.behind >= BEHIND_FRAMES && this.rate > WATCH_SLOWEST) {
      this.rate = Math.max(WATCH_SLOWEST, this.rate * SLOWER);
      this.behind = 0;
      return 'slower';
    }
    return null;
  }

  /** It ends, having run its course or been stopped, and Replay is offered: the rate of time to put back (null if it was not watching). */
  stop(): RateState | null {
    if (this.state !== 'watching') return null;
    const saved = this.saved;
    this.offer();
    return saved;
  }

  /** The explorer has taken the rate of time into their own hands (Faster, Pause...): it ends with nothing put back, and Replay is offered. */
  yieldRate(): void {
    if (this.state === 'watching') this.offer();
  }

  /** Forget it (another change, Undo, Back to reality): the rate of time to put back if it was watching. */
  clear(): RateState | null {
    const saved = this.state === 'watching' ? this.saved : null;
    this.state = 'idle';
    this.saved = null;
    return saved;
  }

  private offer(): void {
    this.state = 'ended';
    this.offered = REPLAY_OFFERED;
    this.saved = null;
  }
}

/** the camera turns to the frame in this share of the time it takes to ease out to it */
const TURN_SHARE = 0.6;

/**
 * The camera eased to a watch's frame: along the line from the frame's centre to where it is,
 * evenly in the logarithm of the distance, until it is `distance` away; turning meanwhile to look
 * at the centre so that the centre stands in the middle of the part of the view that the interface
 * leaves clear (`look`: that middle in the camera's own axes, src/app/Powers.ts: viewFrame). The
 * centre may move (a planet round its sun): the camera goes with it.
 */
export class Glide {
  readonly seconds: number;
  private t = 0;
  private readonly dir: Vector3;
  private readonly from: number;
  private readonly to: number;
  private readonly q0: Quaternion;
  private readonly q1: Quaternion;

  constructor(private rig: CameraRig, readonly centre: { upos: UPos }, distance: number, look: ArrayLike<number>) {
    const rel = rig.upos.sub(centre.upos, new Vector3());
    const d = rel.length();
    // (a camera at the centre itself backs away the way it looks from)
    this.dir = d > 1 ? rel.divideScalar(d) : rig.forward(new Vector3()).negate();
    this.from = Math.log(Math.max(d, 1));
    this.to = Math.log(Math.max(distance, 1));
    this.q0 = rig.quat.clone();
    const ahead = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), this.dir.clone().negate(), rig.up(new Vector3())));
    this.q1 = ahead.multiply(new Quaternion().setFromUnitVectors(new Vector3(look[0], look[1], look[2]).normalize(), new Vector3(0, 0, -1)));
    this.seconds = Math.min(3, 1.2 + 0.25 * Math.abs(this.to - this.from));
  }

  /** Each frame, after the camera has taken the explorer's input: false once it is there. */
  step(dt: number): boolean {
    this.t = Math.min(this.seconds, this.t + dt);
    const s = smooth(this.t / this.seconds);
    this.rig.upos.copy(this.centre.upos).addVec(this.dir, Math.exp(this.from + (this.to - this.from) * s));
    this.rig.quat.copy(this.q0).slerp(this.q1, smooth(this.t / (TURN_SHARE * this.seconds)));
    return this.t < this.seconds;
  }
}

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}
