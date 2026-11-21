import { describe, expect, it } from 'vitest';
import { layoutLabels, type LabelCandidate } from '../src/render/Labels';

const cand = (key: string, x: number, y: number, radius: number, priority: number, over = false): LabelCandidate =>
  ({ key, text: key, x, y, radius, priority, cls: 'x', ...(over ? { over } : {}) });

describe('names on the sky', () => {
  it('names one point once: a galaxy and the hole at its heart (M87 and M87*)', () => {
    // the hole selected: its name stays and the galaxy's, set up and to the right by its own size, goes
    let shown = layoutLabels([cand('M87', 200, 300, 60, 650), cand('M87*', 200, 300, 1, 1e4)], 390, 844);
    expect(shown.map((s) => s.c.key)).toEqual(['M87*']);
    // nothing selected: the galaxy outranks its hole
    shown = layoutLabels([cand('M87', 200, 300, 60, 650), cand('M87*', 200.5, 300, 1, 420)], 390, 844);
    expect(shown.map((s) => s.c.key)).toEqual(['M87']);
  });

  it('still names objects a few pixels apart, and what is set over another on purpose', () => {
    let shown = layoutLabels([cand('A', 100, 300, 40, 10), cand('B', 104, 300, 2, 5)], 390, 844);
    expect(shown.map((s) => s.c.key).sort()).toEqual(['A', 'B']);
    shown = layoutLabels([cand('Jupiter', 100, 300, 40, 1e4), cand('Earth, to scale', 102, 300, 1, 2e4, true)], 390, 844);
    expect(shown.map((s) => s.c.key).sort()).toEqual(['Earth, to scale', 'Jupiter']);
  });

  it('keeps a name clear of its object: further out for a larger disc', () => {
    const [small] = layoutLabels([cand('a', 100, 300, 0, 1)], 390, 844);
    const [big] = layoutLabels([cand('b', 100, 300, 12, 1)], 390, 844);
    expect(big.x - small.x).toBeCloseTo(12 * 0.72);
    expect(small.y - big.y).toBeCloseTo(12 * 0.72);
  });
});
