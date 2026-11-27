import { describe, expect, it } from 'vitest';
import { Governor, LOWEST_RATIO, QUALITY, RENDER_SCALE, renderScale } from '../src/render/Quality';

/** run `n` frames of `dt` ms from time `t`; returns the end time */
const run = (g: Governor, t: number, n: number, dt: number, budget = 1000 / 60): number => {
  for (let i = 0; i < n; i++) { t += dt; g.update(t, budget); }
  return t;
};

describe('quality governor', () => {
  it('holds full quality at frame rate, steps down when frames are missed, back up after a clean run', () => {
    QUALITY.level = 0;
    const g = new Governor(true);
    let t = run(g, 0, 600, 16.7);
    expect(QUALITY.level).toBe(0);
    // 30 fps on a 60 Hz budget: one level down, not more than one a second
    t = run(g, t, 35, 33.4);   // (a fifth of the window missed: about 10 frames)
    expect(QUALITY.level).toBe(1);
    t = run(g, t, 30, 33.4);   // a fresh window and 1 s later: another
    expect(QUALITY.level).toBe(2);
    // smooth again: one level up after 5 s without a miss
    t = run(g, t, 200, 16.7);
    expect(QUALITY.level).toBe(2);
    t = run(g, t, 150, 16.7);
    expect(QUALITY.level).toBe(1);
  });

  it('does not oscillate: a step up undone at once doubles the wait before the next', () => {
    QUALITY.level = 1;
    const g = new Governor(true);
    let t = run(g, 0, 320, 16.7);          // 5.3 s clean: up to 0
    expect(QUALITY.level).toBe(0);
    t = run(g, t, 20, 33.4);               // and straight back down
    expect(QUALITY.level).toBe(1);
    t = run(g, t, 320, 16.7);              // 5.3 s clean is no longer enough (wait now 10 s)
    expect(QUALITY.level).toBe(1);
    t = run(g, t, 330, 16.7);
    expect(QUALITY.level).toBe(0);
  });

  it('steps back up when late frames are rare, not none: one in thirty, as the iPhone 13 had in its easy scenes', () => {
    QUALITY.level = 3;
    const g = new Governor(true);
    /** `n` frames on time with one late (35 ms) frame in every `every` */
    const rare = (t: number, n: number, every: number): number => {
      for (let i = 1; i <= n; i++) { t += i % every === 0 ? 35 : 16.7; g.update(t, 1000 / 60); }
      return t;
    };
    let t = rare(0, 280, 30);              // under 5 s: not yet
    expect(QUALITY.level).toBe(3);
    t = rare(t, 60, 30);                   // past 5 s, one late frame in thirty: one level up
    expect(QUALITY.level).toBe(2);
    // one late frame in ten is not rare: it stays, though no fifth of the window is late either
    QUALITY.level = 3;
    const h = new Governor(true);
    let u = 0;
    for (let i = 1; i <= 900; i++) { u += i % 10 === 0 ? 35 : 16.7; h.update(u, 1000 / 60); }
    expect(QUALITY.level).toBe(3);
    // and a step up never comes in the middle of a late patch: the last frames must be on time
    QUALITY.level = 2;
    const k = new Governor(true);
    let v = run(k, 0, 330, 16.7);          // 5.5 s, all on time...
    expect(QUALITY.level).toBe(1);
    v = run(k, v, 2, 35);                  // (a late pair right after does not step back down)
    expect(QUALITY.level).toBe(1);
    QUALITY.level = 0;
  });

  it('ignores pauses and does nothing when off', () => {
    QUALITY.level = 0;
    const g = new Governor(false);
    run(g, 0, 300, 50);
    expect(QUALITY.level).toBe(0);
    const h = new Governor(true);
    let t = run(h, 0, 100, 16.7);
    t += 5000; h.update(t, 1000 / 60);      // a paused tab
    run(h, t, 100, 16.7);
    expect(QUALITY.level).toBe(0);
  });

  it('does not lower quality for CPU-bound frames, and recovers while they last', () => {
    const budget = 1000 / 75;
    const runCpu = (g: Governor, t: number, n: number, dt: number, cpu: number, gpu = -1): number => {
      for (let i = 0; i < n; i++) { t += dt; g.update(t, budget, cpu, gpu); }
      return t;
    };
    QUALITY.level = 0;
    let g = new Governor(true);
    // the Quest benchmark: 20 ms frames, 15 ms of them main thread, no GPU timer
    let t = runCpu(g, 0, 300, 20, 15);
    expect(QUALITY.level).toBe(0);
    expect(QUALITY.cpuBound).toBe(true);
    // stuck at a low level from an earlier GPU load: CPU-bound frames don't hold it down
    QUALITY.level = 3;
    g = new Governor(true);
    t = runCpu(g, t, 60 * 25, 20, 15);
    expect(QUALITY.level).toBe(0);
    // the GPU timer says the GPU is the slower: a real miss, step down
    t = runCpu(g, t, 120, 20, 15, 18);
    expect(QUALITY.level).toBeGreaterThan(0);
    expect(QUALITY.cpuBound).toBe(false);
    // light main thread, late frames: GPU-bound as before
    QUALITY.level = 0;
    g = new Governor(true);
    runCpu(g, t, 120, 20, 4);
    expect(QUALITY.level).toBeGreaterThan(0);
    QUALITY.level = 0;
  });
});

describe('the resolution the scene is drawn at', () => {
  it('a canvas of ordinary density comes down to 0.6 of its own, as it always did', () => {
    for (const ratio of [1, 1.5, 2]) expect([0, 1, 2, 3].map((l) => renderScale(l, ratio))).toEqual(RENDER_SCALE);
  });

  it("a phone's dense canvas has farther to come down: to the same pixels per CSS pixel, in even steps", () => {
    const steps = [0, 1, 2, 3].map((l) => renderScale(l, 3));
    expect(steps[0]).toBe(1);
    expect(steps[3] * 3).toBeCloseTo(LOWEST_RATIO, 9);
    // each step the same ratio down
    expect(steps[1] / steps[0]).toBeCloseTo(steps[2] / steps[1], 9);
    expect(steps[2] / steps[1]).toBeCloseTo(steps[3] / steps[2], 9);
    // never coarser than a canvas of 2 at the same level
    for (let l = 0; l < 4; l++) expect(steps[l] * 3).toBeGreaterThanOrEqual(RENDER_SCALE[l] * 2 - 1e-9);
  });

  it('a level out of range is the nearest one', () => {
    expect(renderScale(-1, 2)).toBe(1);
    expect(renderScale(9, 2)).toBe(0.6);
  });
});

describe('starting afresh', () => {
  it('forgets the slow frames of the loading and returns to full quality', () => {
    const g = new Governor(true);
    QUALITY.level = 0;
    // two seconds of frames twice over the budget: the level drops
    let t = 1000;
    for (let i = 0; i < 80; i++) { t += 34; g.update(t, 16.7); }
    expect(QUALITY.level).toBeGreaterThan(0);
    expect(g.reset()).toBe(true);
    expect(QUALITY.level).toBe(0);
    expect(g.reset()).toBe(false);
    // and the frames that follow are judged on their own: on time, nothing changes
    for (let i = 0; i < 80; i++) { t += 16; expect(g.update(t, 16.7)).toBe(false); }
    expect(QUALITY.level).toBe(0);
    QUALITY.enabled = true;
  });
});
