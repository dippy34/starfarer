import type { Stroke } from '../render/Labels';

/** The slingshot's arrow over the view (src/app/Mover.ts: Aim): where the world is and its edge, the way and length of the arrow, and its marks (CSS px). */
export interface AimView {
  x: number; y: number; edge: number;
  ux: number; uy: number; length: number;
  circle: number; escape: number;
  snapped: 'circle' | 'escape' | null;
}

/** A part of the screen (CSS px): the arrow is drawn only in the part of the view the interface leaves clear (Hud.freeArea). */
export interface ClearBox { left: number; top: number; right: number; bottom: number }

type Point = [number, number];

/** the arrow's head is this long (CSS px), and this far either side of the line at its base */
export const AIM_HEAD = 12, AIM_HEAD_HALF = 7;
/** the words of the marks are about this far either side of their middle, and this tall above the line they sit on, and this far below it (CSS px: "circle", "escape" at 12.5 px; the p of escape hangs below) */
const WORD_HALF = 22, WORD_TALL = 10, WORD_LOW = 3;
/** a word stands this far from its mark, beside the arrow (CSS px) */
const BESIDE = 22;
/** the marks reach this far either side of the line (CSS px) */
const MARK_HALF = 9;
/** a word is kept this far clear of the line (half its drawn width, 2 px, and a pixel more), of the head, of the marks and of the ring round the world (CSS px) */
const LINE_CLEAR = 3, HEAD_CLEAR = AIM_HEAD_HALF + 1, MARK_CLEAR = 2;
/** a word stays this far inside the part of the view the arrow is drawn in, and never nearer the screen's sides than 8 px (CSS px) */
const INSIDE = 2, SCREEN_SIDE = 8;

/** Where each part of the arrow is drawn (CSS px; src/ui/Hud.ts: setAim draws them). */
export interface AimShape {
  /** the faint line from the world's edge on past the mark of escape, and the shaft along it to the head */
  guide: [Point, Point];
  shaft: [Point, Point];
  /** the head: its tip, and the two corners of its base */
  head: [Point, Point, Point];
  /**
   * each mark across the line, and where its word stands (its middle, on the line its letters sit
   * on): null where none of the places tried for it is in the clear part of the view (it is not
   * drawn rather than cut off)
   */
  marks: { which: 'circle' | 'escape'; line: [Point, Point]; word: Point | null }[];
}

type Box = [number, number, number, number];

/** The box a mark's word takes with its middle at (x, y) on the line its letters sit on: left, top, right, bottom. */
function wordBox(x: number, y: number): Box {
  return [x - WORD_HALF, y - WORD_TALL, x + WORD_HALF, y + WORD_LOW];
}

/** How far a box is from the segment a-b (0 if they meet): sampled every pixel along it, which is fine enough for keeping a word clear. */
function boxToSegment(box: Box, a: Point, b: Point): number {
  const [l, t, r, bo] = box;
  const cx = (l + r) / 2, cy = (t + bo) / 2, hx = (r - l) / 2, hy = (bo - t) / 2;
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  let least = Infinity;
  for (let k = 0; k <= n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
    least = Math.min(least, Math.hypot(Math.max(Math.abs(x - cx) - hx, 0), Math.max(Math.abs(y - cy) - hy, 0)));
    if (least === 0) break;
  }
  return least;
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * The arrow's parts for `aim`, on a view `width` px wide, drawn in `free` (the part of the view the
 * interface leaves clear; the whole screen if not given).
 *
 * Each mark's word stands beside its mark, on the side away from the screen's nearer edge, as it
 * always did, a little farther out where the arrow is steep (so that it is clear of the line and of
 * the mark). Where that is not wholly in the clear part (a mark under the mark of live physics at the
 * top, or near the card), it tries the other side, then places back along the arrow towards the
 * world, past the mark, straight below and above it, and farther out: the first that is wholly in the
 * clear part and clear of the arrow's line, head and marks, of the ring round the world and of the
 * other mark's word. The mark of escape, the one a throw is aimed for, is placed first. Only where
 * none of these fits is a word left out.
 */
export function aimShape(aim: AimView, width: number, free?: ClearBox): AimShape {
  const { ux, uy } = aim, nx = -uy, ny = ux;
  const x0 = aim.x + ux * aim.edge, y0 = aim.y + uy * aim.edge, at = (d: number): Point => [x0 + ux * d, y0 + uy * d];
  const tip = at(aim.length), base = at(aim.length - AIM_HEAD);
  const guide: [Point, Point] = [at(0), at(Math.max(aim.length, aim.escape) + 24)];
  const ticks = (['circle', 'escape'] as const).map((which) => {
    const p = at(aim[which]);
    return [[p[0] + nx * MARK_HALF, p[1] + ny * MARK_HALF], [p[0] - nx * MARK_HALF, p[1] - ny * MARK_HALF]] as [Point, Point];
  });
  // the room a word may take: the clear part, and never nearer the screen's sides than before
  const room = {
    left: Math.max(free ? free.left + INSIDE : -Infinity, SCREEN_SIDE),
    right: Math.min(free ? free.right - INSIDE : Infinity, width - SCREEN_SIDE),
    top: free ? free.top + INSIDE : -Infinity,
    bottom: free ? free.bottom - INSIDE : Infinity,
  };
  const inRoom = (b: Box) => b[0] >= room.left && b[2] <= room.right && b[1] >= room.top && b[3] <= room.bottom;
  const clear = (b: Box) => boxToSegment(b, guide[0], guide[1]) > LINE_CLEAR && boxToSegment(b, guide[0], tip) > LINE_CLEAR && boxToSegment(b, base, tip) > HEAD_CLEAR
    && ticks.every(([a, c]) => boxToSegment(b, a, c) > MARK_CLEAR) && boxToSegment(b, [aim.x, aim.y], [aim.x, aim.y]) > HANDLE_RADIUS + 3;
  const placed: Box[] = [];
  const fits = (t: Point) => { const b = wordBox(t[0], t[1]); return inRoom(b) && clear(b) && !placed.some((q) => overlaps(q, b)); };
  const word = (p: Point, side: number): Point | null => {
    const clampX = (x: number) => Math.max(WORD_HALF + SCREEN_SIDE + 4, Math.min(width - WORD_HALF - SCREEN_SIDE - 4, x));
    // beside the arrow, `along` it from the mark, on side `s`: BESIDE out, or as little farther as clears the line and the
    // marks (beside a steep arrow the word's own width reaches towards the line)
    const beside = (s: number, along: number, far = 1): Point | null => {
      for (let more = 0; more <= 16; more += 4) {
        const d = far * BESIDE + more, t: Point = [clampX(p[0] + ux * along + s * nx * d), p[1] + uy * along + s * ny * d + 4];
        if (fits(t)) return t;
      }
      return null;
    };
    const tries: (() => Point | null)[] = [
      // beside the mark, on its side, then on the other
      () => beside(side, 0), () => beside(-side, 0),
      // back along the arrow towards the world, and on past the mark, either side
      ...[-18, -34, 18, -50].flatMap((along) => [() => beside(side, along), () => beside(-side, along)]),
      // straight below the mark and above it
      () => { const t: Point = [clampX(p[0]), p[1] + BESIDE + 8]; return fits(t) ? t : null; },
      () => { const t: Point = [clampX(p[0]), p[1] - BESIDE + 4]; return fits(t) ? t : null; },
      // farther out beside it
      () => beside(side, 0, 1.6), () => beside(-side, 0, 1.6),
    ];
    for (const t of tries) {
      const w = t();
      if (w) { placed.push(wordBox(w[0], w[1])); return w; }
    }
    return null;
  };
  const marks = (['escape', 'circle'] as const).map((which) => {
    const p = at(aim[which]);
    const side = p[0] + nx * 20 < 40 || p[0] + nx * 20 > width - 40 ? -1 : 1;
    const line: [Point, Point] = [[p[0] + nx * MARK_HALF, p[1] + ny * MARK_HALF], [p[0] - nx * MARK_HALF, p[1] - ny * MARK_HALF]];
    return { which, line, word: word(p, side) };
  }).reverse();
  return {
    guide,
    shaft: [at(0), at(Math.max(0, aim.length - AIM_HEAD))],
    head: [tip, [base[0] + nx * AIM_HEAD_HALF, base[1] + ny * AIM_HEAD_HALF], [base[0] - nx * AIM_HEAD_HALF, base[1] - ny * AIM_HEAD_HALF]],
    marks,
  };
}

/** the ring round the world being moved is this far out from it (CSS px: styles.css, .move-handle, 48 px across) */
export const HANDLE_RADIUS = 24;

/** The ring round the world being moved (`at`: where it is; null: none), as a stroke no name may cross. */
export function ringStrokes(at: { x: number; y: number } | null): Stroke[] {
  return at ? [{ ax: at.x, ay: at.y, bx: at.x, by: at.y, r: HANDLE_RADIUS + 3 }] : [];
}

/**
 * The arrow as strokes no name may cross (src/render/Labels.ts): its line all along, as wide as its
 * head, and the marks across it with their words (as drawn in `free`). None while there is no throw to draw.
 */
export function aimStrokes(aim: AimView | null, width: number, free?: ClearBox): Stroke[] {
  if (!aim || !(aim.length > 0)) return [];
  const s = aimShape(aim, width, free), out: Stroke[] = [];
  const add = (a: Point, b: Point, r: number) => out.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], r });
  add(s.guide[0], s.guide[1], AIM_HEAD_HALF + 2);
  add(s.guide[0], s.head[0], AIM_HEAD_HALF + 2);
  for (const m of s.marks) {
    add(m.line[0], m.line[1], 3);
    if (!m.word) continue;
    const [x, y] = m.word, mid = y + 1 - WORD_TALL / 2;
    add([x - WORD_HALF, mid], [x + WORD_HALF, mid], WORD_TALL / 2 + 1);
  }
  return out;
}
