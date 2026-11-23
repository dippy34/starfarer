import type { Approach } from './Powers';

/**
 * Impacts you can see: when two worlds are about to hit, time slows, so that the last of their
 * coming together takes a few seconds on the screen however fast time was running; src/app/App.ts
 * frames the two, flashes where they meet (src/render/Flash.ts) and says what the hit was
 * (Powers.impactWords). This is the bookkeeping of the slowing, kept clear of the page so that it
 * can be tested by itself; the hits ahead are found by Powers.soonestContact.
 *
 * Each hit ahead is judged once, as the two come within ZONE times their radii added of each
 * other: if the rest of their fall would take less than SHOW seconds at the rate time runs, time
 * runs at the rate at which it takes SHOW, until they have met and a moment more; then it comes
 * back to the rate asked for, doubling every EASE seconds. A fall that takes SHOW or more anyway is
 * left as it is: slowing it again and again as the two came nearer would never let them meet.
 */

/** the last of a fall is shown from this many times the two radii added apart... */
export const ZONE = 8;
/** ...and takes at least this long on the screen (s) */
export const SHOW = 3;
/** once they have met, time stays slow this long (s); then it doubles every EASE seconds until it is back */
const HOLD = 1.2, EASE = 0.25;

export class SlowMotion<T> {
  /** idle: time runs as asked; coming: two worlds are coming together, slowly; after: they have met, and time comes back */
  phase: 'idle' | 'coming' | 'after' = 'idle';
  /** the fastest time may run now (simulated seconds a second) */
  cap = Infinity;
  /** the two it slows for, or last slowed for */
  pair: readonly [T, T] | null = null;
  private judged: (readonly [T, T])[] = [];
  private hold = 0;

  /**
   * A frame of `dt` seconds with time asked to run at `rate` simulated seconds a second (nothing is
   * slowed while it stands still or runs back): how many simulated seconds go by in it. `next`: the
   * first hit ahead, looked for within this frame's time at `rate`. `slowed`: time has just been
   * slowed for it (the frame stops where the last of the fall begins).
   */
  run(dt: number, rate: number, next: Approach<T> | null): { seconds: number; slowed: boolean } {
    const asked = rate * dt;
    if (!(rate > 0) || !(dt > 0)) return { seconds: asked, slowed: false };
    if (next && next.zone <= asked && !this.seen(next)) {
      this.judged.push([next.a, next.b]);
      // (never slower than real time: two already touching meet at the next step)
      const cap = Math.max(1, (next.contact - next.zone) / SHOW);
      if (cap < rate) {
        this.phase = 'coming';
        this.pair = [next.a, next.b];
        this.cap = cap;
        return { seconds: next.zone > 0 ? next.zone : cap * dt, slowed: true };
      }
    }
    if (this.phase === 'coming' && (!next || !this.same(next, this.pair!))) {
      // (they passed each other after all: time comes back)
      this.phase = 'after';
      this.hold = 0;
    }
    if (this.phase === 'after') {
      if (this.hold > 0) this.hold -= dt;
      else this.cap *= Math.pow(2, dt / EASE);
      if (this.cap >= rate) this.idle();
    }
    return { seconds: Math.min(rate, this.cap) * dt, slowed: false };
  }

  /** Two worlds have met: if time was slowed for them, it stays slow a moment more, then comes back. */
  hit(): void {
    if (this.phase !== 'coming') return;
    this.phase = 'after';
    this.hold = HOLD;
  }

  /** Forget everything (a change undone or replayed, the way back to reality): the hits ahead are judged afresh. */
  reset(): void {
    this.idle();
    this.pair = null;
    this.judged = [];
  }

  private idle(): void {
    this.phase = 'idle';
    this.cap = Infinity;
  }

  private seen(next: Approach<T>): boolean {
    return this.judged.some((p) => this.same(next, p));
  }

  private same(next: Approach<T>, p: readonly [T, T]): boolean {
    return (p[0] === next.a && p[1] === next.b) || (p[0] === next.b && p[1] === next.a);
  }
}
