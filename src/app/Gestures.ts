/**
 * Touch gestures, recognised from raw finger positions. Nothing here touches the DOM:
 * src/app/Input.ts feeds it pointer events, tests/gestures.test.ts drives it directly.
 *
 *   one finger    a drag (it keeps gliding after a flick), a tap, a double tap
 *   two fingers   a drag (both travel together), or a pinch that may also twist
 *
 * What two fingers are doing is decided once, from their first few pixels of motion, and kept
 * until one lifts: a pinch never tilts the view and a two-finger drag never zooms. A finger left
 * down when the other lifts does nothing more until it lifts too, so lifting unevenly never jerks
 * the view.
 *
 * Positions are CSS pixels, times milliseconds.
 */

/** a finger may wander this far and still be a tap; a drag starts beyond it */
export const TAP_SLOP = 10;
/** a touch held longer than this is not a tap */
export const TAP_MS = 600;
/** two taps this close in time (lift to lift) and place are a double tap */
export const DOUBLE_MS = 400;
export const DOUBLE_PX = 36;
/** two fingers move this far before they are taken for a drag or a pinch */
const DECIDE_PX = 10;
/** a drag wins only when the fingers travel clearly more than they spread or turn */
const DRAG_BIAS = 1.3;
/** a pinch has to turn this far (rad) before it also twists: fingers never close in dead straight */
const TWIST_START = 0.2;
/** fingers closer than this give no steady distance or angle */
const MIN_SPAN = 24;
/** a flick: the finger left faster than FLING_MIN (px/s); the glide dies away over FLING_TAU */
const FLING_MIN = 80;
const FLING_STOP = 6;
const FLING_TAU = 0.3;
/** the finger's speed at lift-off is taken over this long (ms); a finger at rest that long does not flick */
const VELOCITY_MS = 90;

export interface Point { x: number; y: number }
export interface Delta { dx: number; dy: number }
/** a drag: how far the pointer moved, and where it is now */
export interface Drag extends Delta, Point {}

export interface GestureFrame {
  /** one finger dragging (px since the last frame) and where it is */
  drag: Drag;
  /** two fingers travelling together (px since the last frame) */
  pan: Delta;
  /** pinch: the natural log of the factor by which the fingers closed in (spread apart: negative) */
  pinch: number;
  /** the middle of the pinch, while there is one */
  pinchAt: Point | null;
  /** twist (rad since the last frame), clockwise on the screen positive */
  twist: number;
}

interface Finger extends Point { id: number; x0: number; y0: number; t0: number }
/** two fingers: their middle, the distance between them and the direction from one to the other, at the start and now */
interface TwoFingers {
  mode: 'undecided' | 'drag' | 'pinch';
  cx0: number; cy0: number; span0: number;
  cx: number; cy: number; span: number; angle: number;
  /** how far the pair has turned since it landed (rad) */
  turned: number;
}
interface Sample extends Point { t: number }

export class TouchGestures {
  onTap: ((x: number, y: number) => void) | null = null;
  onDoubleTap: ((x: number, y: number) => void) | null = null;

  private fingers: Finger[] = [];
  /** the touch so far could still end as a tap */
  private tapping = false;
  /** the one finger has left the tap slop: it drags */
  private dragging = false;
  /** a finger of a finished two-finger gesture is still down: nothing until it lifts */
  private spent = false;
  private two: TwoFingers | null = null;
  private lastTap: { x: number; y: number; t: number } | null = null;
  private samples: Sample[] = [];
  private fling: { vx: number; vy: number } | null = null;
  private lastTake = 0;
  private at: Point = { x: 0, y: 0 };
  private acc = { dx: 0, dy: 0, px: 0, py: 0, pinch: 0, twist: 0 };

  /** fingers on the glass */
  get count(): number {
    return this.fingers.length;
  }

  /** true while the view still glides from a flick */
  get gliding(): boolean {
    return this.fling !== null;
  }

  down(id: number, x: number, y: number, t: number): void {
    if (this.fingers.some((f) => f.id === id)) return;
    // a touch that stops a glide is a stop, not a tap
    const stopped = this.fling !== null;
    this.fling = null;
    this.fingers.push({ id, x, y, x0: x, y0: y, t0: t });
    if (this.fingers.length === 1) {
      this.tapping = !stopped;
      this.dragging = false;
      this.spent = false;
      this.samples = [{ x, y, t }];
      this.at = { x, y };
    } else {
      this.tapping = false;
      this.dragging = false;
      if (this.fingers.length === 2 && !this.spent) {
        const m = this.measure();
        this.two = { mode: 'undecided', cx0: m.cx, cy0: m.cy, span0: m.span, ...m, turned: 0 };
      }
    }
  }

  move(id: number, x: number, y: number, t: number): void {
    const f = this.fingers.find((g) => g.id === id);
    if (!f) return;
    const px = f.x, py = f.y;
    f.x = x;
    f.y = y;
    if (this.spent) return;
    if (this.two) { this.moveTwo(); return; }
    if (this.fingers.length !== 1) return;
    if (!this.dragging) {
      if (Math.hypot(x - f.x0, y - f.y0) <= TAP_SLOP) return;
      // the drag starts where the finger is now: the slop is not played back as a jump
      this.dragging = true;
      this.tapping = false;
      this.samples = [{ x, y, t }];
      this.at = { x, y };
      return;
    }
    this.acc.dx += x - px;
    this.acc.dy += y - py;
    this.at = { x, y };
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > VELOCITY_MS) this.samples.shift();
  }

  up(id: number, x: number, y: number, t: number): void {
    const i = this.fingers.findIndex((g) => g.id === id);
    if (i < 0) return;
    const f = this.fingers[i];
    this.fingers.splice(i, 1);
    if (this.two) {
      // one of the two has lifted: the gesture is over, and the finger left behind does nothing
      this.two = null;
      this.spent = this.fingers.length > 0;
      return;
    }
    if (this.fingers.length > 0) return;
    if (this.spent) { this.spent = false; return; }
    if (this.dragging) {
      this.dragging = false;
      this.fling = this.flick(t);
      return;
    }
    if (!this.tapping || t - f.t0 > TAP_MS || Math.hypot(x - f.x0, y - f.y0) > TAP_SLOP) return;
    const prev = this.lastTap;
    if (prev && t - prev.t <= DOUBLE_MS && Math.hypot(x - prev.x, y - prev.y) <= DOUBLE_PX) {
      this.lastTap = null; // a third tap starts over
      this.onDoubleTap?.(x, y);
    } else {
      this.lastTap = { x, y, t };
      this.onTap?.(x, y);
    }
  }

  /** The system took the touch away (a call, an edge swipe): it ends with no tap and no glide. */
  cancel(id: number): void {
    const i = this.fingers.findIndex((g) => g.id === id);
    if (i < 0) return;
    this.fingers.splice(i, 1);
    this.two = null;
    this.tapping = false;
    this.dragging = false;
    this.spent = this.fingers.length > 0;
  }

  /** Stop everything (the view was taken over: a menu opened, the app lost focus). */
  reset(): void {
    this.fingers = [];
    this.two = null;
    this.tapping = this.dragging = this.spent = false;
    this.fling = null;
    this.acc = { dx: 0, dy: 0, px: 0, py: 0, pinch: 0, twist: 0 };
  }

  /** What the fingers did since the last call (once per frame, `now` in ms). */
  take(now: number): GestureFrame {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTake) / 1000));
    this.lastTake = now;
    const a = this.acc;
    if (this.two?.mode === 'undecided') this.decide();
    if (this.fling) {
      // the glide: the finger's last velocity, dying away
      const g = this.fling;
      const dx = g.vx * dt, dy = g.vy * dt;
      a.dx += dx;
      a.dy += dy;
      this.at = { x: this.at.x + dx, y: this.at.y + dy };
      const k = Math.exp(-dt / FLING_TAU);
      g.vx *= k;
      g.vy *= k;
      if (Math.hypot(g.vx, g.vy) < FLING_STOP) this.fling = null;
    }
    const frame: GestureFrame = {
      drag: { dx: a.dx, dy: a.dy, x: this.at.x, y: this.at.y },
      pan: { dx: a.px, dy: a.py },
      pinch: a.pinch,
      pinchAt: this.two && this.two.mode === 'pinch' ? { x: this.two.cx, y: this.two.cy } : null,
      twist: a.twist,
    };
    this.acc = { dx: 0, dy: 0, px: 0, py: 0, pinch: 0, twist: 0 };
    return frame;
  }

  /** The first two fingers as they are now; `steady`: far enough apart for their direction to mean something. */
  private measure(): { cx: number; cy: number; span: number; angle: number; steady: boolean } {
    const [a, b] = this.fingers;
    const apart = Math.hypot(b.x - a.x, b.y - a.y);
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, span: Math.max(MIN_SPAN, apart), angle: Math.atan2(b.y - a.y, b.x - a.x), steady: apart >= MIN_SPAN };
  }

  private moveTwo(): void {
    const g = this.two!;
    const m = this.measure();
    const turn = m.steady ? wrap(m.angle - g.angle) : 0;
    if (g.mode === 'drag') {
      this.acc.px += m.cx - g.cx;
      this.acc.py += m.cy - g.cy;
    } else if (g.mode === 'pinch') {
      this.acc.pinch += Math.log(g.span / m.span);
      // a twist counts only beyond the first TWIST_START of turning (and from there on: no jump)
      this.acc.twist += beyond(g.turned + turn) - beyond(g.turned);
    }
    // (deltas are always taken from the previous position: nothing is played back when the mode is decided)
    g.turned += turn;
    g.cx = m.cx;
    g.cy = m.cy;
    g.span = m.span;
    if (m.steady) g.angle = m.angle;
  }

  /**
   * Drag or pinch? Asked once per frame, when every finger has reported: the fingers' events come
   * one at a time, and in between one finger is always a little ahead of the other.
   */
  private decide(): void {
    const g = this.two!;
    const travel = Math.hypot(g.cx - g.cx0, g.cy - g.cy0);
    const spread = Math.abs(g.span - g.span0);
    const arc = Math.abs(g.turned) * g.span0 / 2;
    if (Math.max(travel, spread, arc) > DECIDE_PX) g.mode = travel > DRAG_BIAS * Math.max(spread, arc) ? 'drag' : 'pinch';
  }

  /** The glide a lifted finger leaves behind: its velocity over the last moments, if it was moving. */
  private flick(t: number): { vx: number; vy: number } | null {
    const s = this.samples;
    const last = s[s.length - 1];
    // a finger that rested before lifting meant to stop there
    if (s.length < 2 || t - last.t > VELOCITY_MS) return null;
    const first = s[0];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return null;
    const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
    return Math.hypot(vx, vy) >= FLING_MIN ? { vx, vy } : null;
  }
}

/** an angle difference brought into (-π, π] */
function wrap(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** the part of a turn (rad) that lies beyond the twist threshold */
function beyond(turned: number): number {
  return Math.sign(turned) * Math.max(0, Math.abs(turned) - TWIST_START);
}
