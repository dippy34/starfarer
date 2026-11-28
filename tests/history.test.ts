import { describe, expect, it } from 'vitest';
import { Gesture, History, RUN_GAP, UNDO_STEPS } from '../src/app/History';

describe('undo', () => {
  it('goes back one change at a time, the newest first, and no further than there were changes', () => {
    const h = new History<string>();
    h.push('real');
    h.push('Jupiter heavier');
    expect(h.size).toBe(2);
    expect(h.pop()).toBe('Jupiter heavier');
    expect(h.pop()).toBe('real');
    expect(h.pop()).toBeUndefined();
    expect(h.size).toBe(0);
  });

  it('keeps the last twenty changes: the oldest is let go to make room; there is no redo', () => {
    const h = new History<number>();
    for (let k = 1; k <= UNDO_STEPS + 5; k++) h.push(k);
    expect(h.size).toBe(UNDO_STEPS);
    const back: number[] = [];
    for (let s = h.pop(); s !== undefined; s = h.pop()) back.push(s);
    expect(back[0]).toBe(UNDO_STEPS + 5);
    expect(back[back.length - 1]).toBe(6);
    h.push(1);
    h.clear();
    expect(h.size).toBe(0);
  });
});

describe('one change per gesture', () => {
  it('a finger on the slider is one change, however many places it passes, until it lifts', () => {
    const g = new Gesture();
    expect(g.begin(0, true)).toBe(true);
    // (every place the slider passes reports a change: none of them begins another)
    for (let t = 16; t < 5000; t += 16) expect(g.begin(t)).toBe(false);
    // held still for longer than a pause: still the same change
    expect(g.due(9000)).toBe(false);
    expect(g.end()).toBe(true);
    expect(g.open).toBe(false);
    // lifted again: nothing more to end
    expect(g.end()).toBe(false);
  });

  it('arrow keys with less than 600 ms between them are one change; a pause ends it', () => {
    const g = new Gesture();
    expect(g.begin(0)).toBe(true);
    expect(g.begin(300)).toBe(false);
    expect(g.begin(800)).toBe(false);
    expect(g.due(800 + RUN_GAP - 1)).toBe(false);
    expect(g.due(800 + RUN_GAP)).toBe(true);
    expect(g.end()).toBe(true);
    // the next key is a new change
    expect(g.begin(2000)).toBe(true);
  });

  it('a tap (Add, Remove) begins and ends one change at once', () => {
    const g = new Gesture();
    expect(g.begin(0, true)).toBe(true);
    expect(g.end()).toBe(true);
    expect(g.begin(10, true)).toBe(true);
  });
});

describe('Undo of a real black hole\'s mass among the changes of the worlds', () => {
  type Step = { world: string } | { hole: string; factor: number };
  const isHole = (s: Step): s is { hole: string; factor: number } => 'hole' in s;

  it('the newest step is readable without taking it off', () => {
    const h = new History<Step>();
    expect(h.last()).toBeUndefined();
    h.push({ world: 'a' });
    h.push({ hole: 'Sagittarius A*', factor: 1 });
    expect(h.last()).toEqual({ hole: 'Sagittarius A*', factor: 1 });
    expect(h.size).toBe(2);
  });

  it('what lets go of the worlds (Back to reality, another system) keeps the holes, in their order', () => {
    const h = new History<Step>();
    h.push({ world: 'a' });
    h.push({ hole: 'Sagittarius A*', factor: 1 });
    h.push({ world: 'b' });
    h.push({ hole: 'Cygnus X-1', factor: 2 });
    h.keepOnly(isHole);
    expect(h.size).toBe(2);
    expect(h.pop()).toEqual({ hole: 'Cygnus X-1', factor: 2 });
    expect(h.pop()).toEqual({ hole: 'Sagittarius A*', factor: 1 });
    expect(h.pop()).toBeUndefined();
  });

  it('what lets go of the holes (a scene opened) keeps the worlds', () => {
    const h = new History<Step>();
    h.push({ hole: 'Sagittarius A*', factor: 1 });
    h.push({ world: 'a' });
    h.keepOnly((s) => !isHole(s));
    expect(h.pop()).toEqual({ world: 'a' });
    expect(h.size).toBe(0);
  });
});
