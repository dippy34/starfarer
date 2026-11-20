import { describe, expect, it } from 'vitest';
import { DOUBLE_MS, TAP_MS, TAP_SLOP, TouchGestures, type GestureFrame } from '../src/app/Gestures';

/** A recogniser that records its taps. */
function setup() {
  const g = new TouchGestures();
  const taps: string[] = [];
  g.onTap = (x, y) => taps.push(`tap ${x},${y}`);
  g.onDoubleTap = (x, y) => taps.push(`double ${x},${y}`);
  return { g, taps };
}

/** Sum of the frames taken while `steps` run (one frame per step, 16 ms apart, starting at `t0`). */
function run(g: TouchGestures, t0: number, steps: ((t: number) => void)[]): GestureFrame & { t: number } {
  const sum = { drag: { dx: 0, dy: 0, x: 0, y: 0 }, pan: { dx: 0, dy: 0 }, pinch: 0, pinchAt: null as GestureFrame['pinchAt'], twist: 0, t: t0 };
  for (const step of steps) {
    sum.t += 16;
    step(sum.t);
    const f = g.take(sum.t);
    sum.drag.dx += f.drag.dx; sum.drag.dy += f.drag.dy; sum.drag.x = f.drag.x; sum.drag.y = f.drag.y;
    sum.pan.dx += f.pan.dx; sum.pan.dy += f.pan.dy;
    sum.pinch += f.pinch; sum.twist += f.twist;
    sum.pinchAt = f.pinchAt ?? sum.pinchAt;
  }
  return sum;
}

/** Frames with nothing touching, until the view rests (or `max` frames). */
function settle(g: TouchGestures, t0: number, max = 600): { dx: number; dy: number; frames: number } {
  let dx = 0, dy = 0, frames = 0, t = t0;
  while (frames < max) {
    t += 16;
    const f = g.take(t);
    dx += f.drag.dx; dy += f.drag.dy;
    frames++;
    if (!g.gliding) break;
  }
  return { dx, dy, frames };
}

describe('taps', () => {
  it('a touch that stays put is a tap, at the place it lifted', () => {
    const { g, taps } = setup();
    g.down(1, 100, 200, 0);
    g.move(1, 103, 204, 40); // a finger never holds perfectly still
    g.up(1, 103, 204, 90);
    expect(taps).toEqual(['tap 103,204']);
    const f = g.take(100);
    expect(f.drag.dx).toBe(0);
    expect(f.drag.dy).toBe(0);
  });

  it('a long press is not a tap, nor is a touch that wandered', () => {
    const { g, taps } = setup();
    g.down(1, 100, 200, 0);
    g.up(1, 100, 200, TAP_MS + 1);
    g.down(2, 100, 200, 2000);
    g.move(2, 100 + TAP_SLOP + 1, 200, 2020);
    g.move(2, 100, 200, 2040); // back where it started: still a drag
    g.up(2, 100, 200, 2060);
    expect(taps).toEqual([]);
  });

  it('two quick taps in one place: a tap, then a double tap; a third starts over', () => {
    const { g, taps } = setup();
    for (const [i, t] of [0, 200, 400].entries()) {
      g.down(i, 50, 60, t);
      g.up(i, 52, 61, t + 60);
    }
    expect(taps).toEqual(['tap 52,61', 'double 52,61', 'tap 52,61']);
  });

  it('taps far apart in time or place stay single taps', () => {
    const { g, taps } = setup();
    g.down(1, 50, 60, 0); g.up(1, 50, 60, 50);
    g.down(2, 50, 60, 100 + DOUBLE_MS); g.up(2, 50, 60, 150 + DOUBLE_MS); // too late
    g.down(3, 250, 60, 200 + DOUBLE_MS); g.up(3, 250, 60, 250 + DOUBLE_MS); // too far
    expect(taps).toEqual(['tap 50,60', 'tap 50,60', 'tap 250,60']);
  });

  it('two fingers down and up is not a tap', () => {
    const { g, taps } = setup();
    g.down(1, 50, 60, 0);
    g.down(2, 150, 60, 10);
    g.up(1, 50, 60, 80);
    g.up(2, 150, 60, 90);
    expect(taps).toEqual([]);
  });

  it('a cancelled touch is not a tap', () => {
    const { g, taps } = setup();
    g.down(1, 50, 60, 0);
    g.cancel(1);
    g.up(1, 50, 60, 50);
    expect(taps).toEqual([]);
    expect(g.count).toBe(0);
  });
});

describe('one finger', () => {
  it('drags by what the finger travels beyond the tap slop, and reports where it is', () => {
    const { g } = setup();
    const f = run(g, 0, [
      (t) => g.down(1, 100, 100, t),
      (t) => g.move(1, 100 + TAP_SLOP + 2, 100, t),   // leaves the slop: the drag starts here
      (t) => g.move(1, 150, 130, t),
      (t) => g.move(1, 180, 90, t),
    ]);
    expect(f.drag.dx).toBeCloseTo(180 - (100 + TAP_SLOP + 2), 9);
    expect(f.drag.dy).toBeCloseTo(90 - 100, 9);
    expect([f.drag.x, f.drag.y]).toEqual([180, 90]);
    expect(f.pinch).toBe(0);
    expect(f.pan).toEqual({ dx: 0, dy: 0 });
  });

  it('a flick glides on in the same direction and dies away', () => {
    const { g } = setup();
    const moves = Array.from({ length: 8 }, (_, i) => (t: number) => g.move(1, 100 + 20 * (i + 1), 300, t)); // 20 px per 16 ms: 1250 px/s
    const f = run(g, 0, [(t) => g.down(1, 100, 300, t), ...moves]);
    g.up(1, 260, 300, f.t + 4);
    expect(g.gliding).toBe(true);
    const first = g.take(f.t + 16);
    expect(first.drag.dx).toBeGreaterThan(10);   // carries on at about the finger's speed
    expect(first.drag.dx).toBeLessThan(22);
    expect(first.drag.dy).toBeCloseTo(0, 9);
    const rest = settle(g, f.t + 16);
    expect(g.gliding).toBe(false);
    // the whole glide: about speed x time constant (1250 px/s x 0.3 s)
    expect(first.drag.dx + rest.dx).toBeGreaterThan(250);
    expect(first.drag.dx + rest.dx).toBeLessThan(450);
    expect(rest.frames * 16).toBeLessThan(2500);
    // the pointer position glides with it, so what is under it keeps following
    const end = g.take(1e6);
    expect(end.drag.x).toBeCloseTo(260 + first.drag.dx + rest.dx, 6);
  });

  it('a finger that rests before lifting leaves no glide', () => {
    const { g } = setup();
    const f = run(g, 0, [(t) => g.down(1, 100, 300, t), (t) => g.move(1, 160, 300, t), (t) => g.move(1, 220, 300, t)]);
    g.up(1, 220, 300, f.t + 200);
    expect(g.gliding).toBe(false);
  });

  it('touching the view stops a glide, and that touch is not a tap', () => {
    const { g, taps } = setup();
    const f = run(g, 0, [(t) => g.down(1, 100, 300, t), (t) => g.move(1, 160, 300, t), (t) => g.move(1, 220, 300, t), (t) => g.move(1, 280, 300, t)]);
    g.up(1, 280, 300, f.t + 2);
    expect(g.gliding).toBe(true);
    g.down(2, 200, 200, f.t + 50);
    expect(g.gliding).toBe(false);
    g.up(2, 200, 200, f.t + 100);
    expect(taps).toEqual([]);
  });
});

describe('two fingers', () => {
  it('spreading the fingers is a pinch: it zooms by the ratio of their distances, about their middle', () => {
    const { g } = setup();
    const f = run(g, 0, [
      (t) => { g.down(1, 150, 400, t); g.down(2, 250, 400, t); },   // 100 px apart
      (t) => { g.move(1, 140, 400, t); g.move(2, 260, 400, t); },   // 120: decided here
      (t) => { g.move(1, 100, 400, t); g.move(2, 300, 400, t); },   // 200
      (t) => { g.move(1, 50, 400, t); g.move(2, 350, 400, t); },    // 300
    ]);
    expect(f.pinch).toBeCloseTo(Math.log(120 / 300), 9);
    expect(f.pinchAt).toEqual({ x: 200, y: 400 });
    expect(f.pan).toEqual({ dx: 0, dy: 0 });
    expect(f.twist).toBe(0);
    expect(f.drag.dx).toBe(0);
  });

  it('a thumb that stays put while the other finger moves away is still a pinch', () => {
    const { g } = setup();
    const f = run(g, 0, [
      (t) => { g.down(1, 150, 400, t); g.down(2, 250, 400, t); },
      (t) => g.move(2, 280, 400, t),
      (t) => g.move(2, 350, 400, t),
    ]);
    expect(f.pinch).toBeCloseTo(Math.log(130 / 200), 9);
    expect(f.pan).toEqual({ dx: 0, dy: 0 });
  });

  it('two fingers travelling together are a drag: it never zooms or twists, however unevenly they move', () => {
    const { g } = setup();
    const f = run(g, 0, [
      (t) => { g.down(1, 150, 400, t); g.down(2, 250, 410, t); },
      (t) => { g.move(1, 150, 420, t); g.move(2, 250, 432, t); },   // decided: a drag
      (t) => { g.move(1, 146, 470, t); g.move(2, 262, 480, t); },   // (the fingers drift apart a little)
      (t) => { g.move(1, 150, 520, t); g.move(2, 250, 530, t); },
    ]);
    expect(f.pan.dx).toBeCloseTo(0, 9);
    expect(f.pan.dy).toBeCloseTo(525 - 426, 9);
    expect(f.pinch).toBe(0);
    expect(f.twist).toBe(0);
    expect(f.pinchAt).toBeNull();
  });

  it('a twist turns the view only beyond a dead zone, then follows the fingers', () => {
    const { g } = setup();
    const at = (a: number) => (t: number) => {
      g.move(1, 200 - 100 * Math.cos(a), 400 - 100 * Math.sin(a), t);
      g.move(2, 200 + 100 * Math.cos(a), 400 + 100 * Math.sin(a), t);
    };
    const small = run(g, 0, [(t) => { g.down(1, 100, 400, t); g.down(2, 300, 400, t); }, at(0.05), at(0.1), at(0.15)]);
    expect(small.twist).toBe(0); // the unsteadiness of a straight pinch
    const more = run(g, small.t, [at(0.3), at(0.5), at(0.7)]);
    expect(more.twist).toBeCloseTo(0.7 - 0.2, 9); // clockwise on the screen (y down): positive
    const back = run(g, more.t, [at(0.4), at(0.1)]);
    expect(more.twist + back.twist).toBeCloseTo(0, 9);
    expect(Math.abs(small.pinch + more.pinch + back.pinch)).toBeLessThan(1e-9);
  });

  it('when one finger lifts, the one left behind does nothing until it lifts too', () => {
    const { g, taps } = setup();
    const f = run(g, 0, [
      (t) => { g.down(1, 150, 400, t); g.down(2, 250, 400, t); },
      (t) => { g.move(1, 100, 400, t); g.move(2, 300, 400, t); },
      (t) => g.up(2, 300, 400, t),
      (t) => g.move(1, 180, 520, t),   // the remaining finger slides: no drag
      (t) => g.move(1, 260, 640, t),
      (t) => g.up(1, 260, 640, t),
    ]);
    expect(f.drag.dx).toBe(0);
    expect(f.drag.dy).toBe(0);
    expect(g.gliding).toBe(false);
    expect(taps).toEqual([]);
    // and the next touch is a fresh one
    g.down(3, 50, 50, f.t + 500);
    g.up(3, 50, 50, f.t + 560);
    expect(taps).toEqual(['tap 50,50']);
  });

  it('a second finger ends a one-finger drag and starts a pinch', () => {
    const { g } = setup();
    const f = run(g, 0, [
      (t) => g.down(1, 100, 400, t),
      (t) => g.move(1, 140, 400, t),
      (t) => g.move(1, 160, 400, t),
      (t) => g.down(2, 260, 400, t),
      (t) => g.move(2, 300, 400, t),   // 100 -> 140: decided
      (t) => g.move(2, 360, 400, t),   // 200
    ]);
    expect(f.drag.dx).toBeCloseTo(20, 9);
    expect(f.pinch).toBeCloseTo(Math.log(140 / 200), 9);
  });

  it('fingers almost touching give no wild zoom or twist', () => {
    const { g } = setup();
    const f = run(g, 0, [
      (t) => { g.down(1, 200, 400, t); g.down(2, 204, 400, t); },
      (t) => g.move(2, 200, 404, t),
      (t) => g.move(2, 196, 400, t),
      (t) => g.move(2, 215, 400, t),
    ]);
    expect(Math.abs(f.pinch)).toBeLessThan(0.01);
    expect(f.twist).toBe(0);
  });
});
