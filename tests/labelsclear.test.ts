import { describe, expect, it } from 'vitest';
import { type LabelCandidate, layoutLabels, strokeMeets } from '../src/render/Labels';
import { aimShape, aimStrokes, type AimView, HANDLE_RADIUS, ringStrokes } from '../src/ui/aimShape';

const name = (key: string, x: number, y: number, priority = 1): LabelCandidate => ({ key, text: key, x, y, radius: 3, priority, cls: 'star' });

describe('names and the interface', () => {
  it('no name is set under a part of the interface over the view, nor at its edge', () => {
    // a card from (400, 60) to (760, 200), as the ship's instruments on a phone on its side
    const card = { l: 400, t: 60, r: 760, b: 200 };
    const shown = layoutLabels([
      name('Aldebaran', 500, 120, 5), // under the card
      name('M35', 395, 120, 4), // its name would run onto the card
      name('Uranus', 200, 120, 3), // clear of it
      name('James Webb Space Telescope', 420, 215, 2), // its name would sit just under the card's foot
    ], 844, 390, null, [card]);
    expect(shown.map((s) => s.c.key)).toEqual(['Uranus']);
    for (const s of shown) expect(s.x + s.w <= card.l || s.x >= card.r || s.y + s.h <= card.t || s.y >= card.b).toBe(true);
  });

  it('with nothing kept clear, names go where they did', () => {
    expect(layoutLabels([name('Aldebaran', 500, 120)], 844, 390).length).toBe(1);
  });
});

describe('names and the slingshot\'s arrow', () => {
  it('a stroke touches a box where its line, or its width either side, comes into it', () => {
    const box = [100, 100, 60, 14] as const;
    expect(strokeMeets({ ax: 50, ay: 107, bx: 200, by: 107, r: 1 }, ...box)).toBe(true); // through it
    expect(strokeMeets({ ax: 50, ay: 90, bx: 200, by: 90, r: 4 }, ...box)).toBe(false); // above it, by more than its width
    expect(strokeMeets({ ax: 50, ay: 90, bx: 200, by: 90, r: 12 }, ...box)).toBe(true); // as near, but wider
    expect(strokeMeets({ ax: 120, ay: 0, bx: 130, by: 60, r: 3 }, ...box)).toBe(false); // ends short of it
    expect(strokeMeets({ ax: 130, ay: 107, bx: 130, by: 107, r: 2 }, ...box)).toBe(true); // a point in it
    expect(strokeMeets({ ax: 0, ay: 0, bx: 300, by: 300, r: 2 }, ...box)).toBe(true); // across a corner
    expect(strokeMeets({ ax: 0, ay: 60, bx: 300, by: 360, r: 2 }, ...box)).toBe(false); // past a corner
  });

  it('the arrow kept clear: its line as wide as its head, the marks and their words; and the ring round the world it is drawn from', () => {
    // (the Moon at (200, 400), the arrow pulled to the mark of escape up and to the left)
    const aim: AimView = { x: 200, y: 400, edge: 12, ux: -Math.SQRT1_2, uy: -Math.SQRT1_2, length: 110 * Math.SQRT2, circle: 110, escape: 110 * Math.SQRT2, snapped: 'escape' };
    const shape = aimShape(aim, 390), strokes = aimStrokes(aim, 390);
    const near = (x: number, y: number) => strokes.some((s) => strokeMeets(s, x - 0.5, y - 0.5, 1, 1));
    for (const [x, y] of [...shape.guide, ...shape.head, ...shape.marks.flatMap((m) => [...m.line, m.word!])]) expect(near(x, y)).toBe(true);
    // (half way along, a little to the side of the line: the head is as wide as that; well to the side the marks have no words)
    const mid = [(shape.guide[0][0] + shape.guide[1][0]) / 2, (shape.guide[0][1] + shape.guide[1][1]) / 2];
    expect(near(mid[0] - 6 * Math.SQRT1_2, mid[1] + 6 * Math.SQRT1_2)).toBe(true);
    expect(near(mid[0] - 30 * Math.SQRT1_2, mid[1] + 30 * Math.SQRT1_2)).toBe(false);
    // nothing to keep clear while there is no throw
    expect(aimStrokes({ ...aim, length: 0 }, 390)).toEqual([]);
    expect(aimStrokes(null, 390)).toEqual([]);
    // the ring round the world, all of it and a little more
    const [ring] = ringStrokes({ x: 200, y: 400 });
    expect(strokeMeets(ring, 200 + HANDLE_RADIUS, 400, 1, 1)).toBe(true);
    expect(strokeMeets(ring, 200 + HANDLE_RADIUS + 6, 400, 1, 1)).toBe(false);
    expect(ringStrokes(null)).toEqual([]);
  });

  it('the words of the marks stand wholly on the screen: at the mark of escape near its left edge, "escape" is not cut off', () => {
    // (Part 4's picture of the Moon at the mark of escape: the arrow to the left, nearly level, its far mark 25 px from the edge)
    const aim: AimView = { x: 190, y: 170, edge: 21, ux: -0.9995, uy: -0.0316, length: 155.6, circle: 110, escape: 155.6, snapped: 'escape' };
    const shape = aimShape(aim, 390);
    const escape = shape.marks.find((m) => m.which === 'escape')!;
    expect(escape.line[0][0]).toBeLessThan(26);
    // (its left end, some 23 px from its middle, inside the 8 px the arrow's clip keeps from the edge)
    expect(escape.word![0] - 23).toBeGreaterThanOrEqual(8);
    // (where there is room it stands right beside its mark, as before: 22 px out along the normal)
    const circle = shape.marks.find((m) => m.which === 'circle')!;
    expect(circle.word![0]).toBeCloseTo((circle.line[0][0] + circle.line[1][0]) / 2 - 22 * aim.uy, 6);
  });

  it('a mark near the edge of the clear part of the view (the mark of live physics above it) keeps its word: below it, along the arrow, wholly in the clear part', () => {
    // (the trailer's Moon thrown on a phone: the arrow up, the mark of escape 3 px under the top of the part of the view the
    // interface leaves clear; beside it, as before, "escape" was cut off by the arrow's clip at the mark of live physics)
    const aim: AimView = { x: 200, y: 320, edge: 15, ux: 0, uy: -1, length: 155.6, circle: 110, escape: 155.6, snapped: 'escape' };
    const mark = 320 - 15 - 155.6, free = { left: 0, top: mark - 3, right: 390, bottom: 560 };
    const before = aimShape(aim, 390), after = aimShape(aim, 390, free);
    const box = (w: [number, number]) => ({ l: w[0] - 22, t: w[1] - 10, r: w[0] + 22, b: w[1] + 3 });
    const old = box(before.marks.find((m) => m.which === 'escape')!.word!);
    expect(old.t).toBeLessThan(free.top);
    const escape = after.marks.find((m) => m.which === 'escape')!, circle = after.marks.find((m) => m.which === 'circle')!;
    expect(escape.word).not.toBeNull();
    const e = box(escape.word!), c = box(circle.word!);
    // wholly in the clear part, near its mark (below it, back along the arrow), and clear of the circle's word
    expect(e.t >= free.top && e.b <= free.bottom && e.l >= free.left && e.r <= free.right).toBe(true);
    expect(Math.hypot(escape.word![0] - 200, escape.word![1] - mark)).toBeLessThan(45);
    expect(escape.word![1]).toBeGreaterThan(mark);
    expect(e.r <= c.l || e.l >= c.r || e.b <= c.t || e.t >= c.b).toBe(true);
    // clear of the arrow's line and of the marks across it
    const strokes = aimStrokes(aim, 390, free).filter((s) => s.r !== 6);
    expect(strokes.some((s) => strokeMeets({ ...s, r: Math.min(s.r, 3) }, e.l, e.t, e.r - e.l, e.b - e.t))).toBe(false);
    // where there is room beside the mark it stands there as always
    const roomy = aimShape(aim, 390, { left: 0, top: 0, right: 390, bottom: 844 }).marks.find((m) => m.which === 'escape')!;
    expect(Math.abs(roomy.word![1] - (mark + 4))).toBeLessThan(1e-9);
    // and where nothing fits (a sliver of clear view) it is left out rather than cut off
    const none = aimShape(aim, 390, { left: 0, top: mark - 3, right: 390, bottom: mark + 6 }).marks.find((m) => m.which === 'escape')!;
    expect(none.word).toBeNull();
    expect(aimStrokes(aim, 390, { left: 0, top: mark - 3, right: 390, bottom: mark + 6 }).length).toBeGreaterThan(0);
  });

  it('the words at the end of the path ahead are set clear of the arrow, at another corner of it or nudged off it; where nothing will do they go', () => {
    const words = (x: number, y: number, avoid: LabelCandidate['avoid']): LabelCandidate => ({ key: 'future-end', text: 'in 3.2 days it is the Sun\'s', x, y, radius: 4, priority: 3e4, cls: 'future', over: true, avoid });
    // (on a phone: the Moon at (213, 215), thrown at the speed of escape to the left and a little up; three days on, its
    // path ends at (83, 198), on the arrow's line)
    const arrow = [...ringStrokes({ x: 213, y: 215 }), ...aimStrokes({ x: 213, y: 215, edge: 21, ux: -0.9913, uy: -0.1316, length: 155.6, circle: 110, escape: 155.6, snapped: 'escape' }, 390)];
    const crosses = (b: { x: number; y: number; w: number; h: number }) => arrow.some((s) => strokeMeets(s, b.x, b.y, b.w, b.h));
    const [plain] = layoutLabels([words(83, 198, undefined)], 390, 844);
    // (as names go, up and to the right of the end: along the arrow)
    expect(crosses(plain)).toBe(true);
    const [clear] = layoutLabels([words(83, 198, arrow)], 390, 844);
    expect(clear).toBeDefined();
    expect(crosses(clear)).toBe(false);
    // (on the screen, and by the end of the path still)
    expect(clear.x >= 0 && clear.x + clear.w <= 390 && clear.y >= 0).toBe(true);
    expect(Math.hypot(clear.x - 83, clear.y + clear.h - 198)).toBeLessThan(60);
    // nor under a part of the interface: with a card above the arrow, below it
    const card = { l: 0, t: 0, r: 390, b: 190 };
    const [below] = layoutLabels([words(83, 198, arrow)], 390, 844, null, [card]);
    expect(crosses(below)).toBe(false);
    expect(below.y).toBeGreaterThan(card.b);
    // nothing clear near the end: no words rather than words on the arrow
    expect(layoutLabels([words(83, 198, [{ ax: 83, ay: 198, bx: 83, by: 198, r: 200 }])], 390, 844)).toEqual([]);
  });
});
