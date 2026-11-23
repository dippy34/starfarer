import type { Stroke } from '../render/Labels';

/** The slingshot's arrow over the view (src/app/Mover.ts: Aim): where the world is and its edge, the way and length of the arrow, and its marks (CSS px). */
export interface AimView {
  x: number; y: number; edge: number;
  ux: number; uy: number; length: number;
  circle: number; escape: number;
  snapped: 'circle' | 'escape' | null;
}

type Point = [number, number];

/** the arrow's head is this long (CSS px), and this far either side of the line at its base */
export const AIM_HEAD = 12, AIM_HEAD_HALF = 7;
/** the words of the marks are about this far either side of their middle, and this tall (CSS px: "circle", "escape" at 12.5 px) */
const WORD_HALF = 22, WORD_TALL = 10;

/** Where each part of the arrow is drawn (CSS px; src/ui/Hud.ts: setAim draws them). */
export interface AimShape {
  /** the faint line from the world's edge on past the mark of escape, and the shaft along it to the head */
  guide: [Point, Point];
  shaft: [Point, Point];
  /** the head: its tip, and the two corners of its base */
  head: [Point, Point, Point];
  /** each mark across the line, and where its word stands (its middle, on the line its letters sit on) */
  marks: { which: 'circle' | 'escape'; line: [Point, Point]; word: Point }[];
}

/** The arrow's parts for `aim`, on a view `width` px wide. */
export function aimShape(aim: AimView, width: number): AimShape {
  const { ux, uy } = aim, nx = -uy, ny = ux;
  const x0 = aim.x + ux * aim.edge, y0 = aim.y + uy * aim.edge, at = (d: number): Point => [x0 + ux * d, y0 + uy * d];
  const tip = at(aim.length), base = at(aim.length - AIM_HEAD);
  const marks = (['circle', 'escape'] as const).map((which) => {
    const p = at(aim[which]);
    // (the word stands beside its mark, on the side away from the screen's nearer edge, and wholly inside the part of the
    // view the arrow is drawn in, 8 px in from the screen's edges at least)
    const side = p[0] + nx * 20 < 40 || p[0] + nx * 20 > width - 40 ? -1 : 1;
    const line: [Point, Point] = [[p[0] + nx * 9, p[1] + ny * 9], [p[0] - nx * 9, p[1] - ny * 9]];
    const x = Math.max(WORD_HALF + 12, Math.min(width - WORD_HALF - 12, p[0] + side * nx * 22));
    return { which, line, word: [x, p[1] + side * ny * 22 + 4] as Point };
  });
  return {
    guide: [at(0), at(Math.max(aim.length, aim.escape) + 24)],
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
 * head, and the marks across it with their words. None while there is no throw to draw.
 */
export function aimStrokes(aim: AimView | null, width: number): Stroke[] {
  if (!aim || !(aim.length > 0)) return [];
  const s = aimShape(aim, width), out: Stroke[] = [];
  const add = (a: Point, b: Point, r: number) => out.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], r });
  add(s.guide[0], s.guide[1], AIM_HEAD_HALF + 2);
  add(s.guide[0], s.head[0], AIM_HEAD_HALF + 2);
  for (const m of s.marks) {
    add(m.line[0], m.line[1], 3);
    const [x, y] = m.word, mid = y + 1 - WORD_TALL / 2;
    add([x - WORD_HALF, mid], [x + WORD_HALF, mid], WORD_TALL / 2 + 1);
  }
  return out;
}
