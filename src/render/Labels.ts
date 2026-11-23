import { VIEW_MASK, type ViewMask } from './ViewMask';

/** HTML labels with greedy overlap rejection. */
export interface LabelCandidate {
  key: string;
  /** camera-relative position (m), used by the VR label renderer */
  rel?: import('three').Vector3;
  text: string;
  x: number; // CSS px
  y: number;
  /** pixel radius of the object, labels are offset beyond it */
  radius: number;
  priority: number;
  cls: string;
  /** set over another object on purpose (Earth for scale): named even where that object is */
  over?: boolean;
  /**
   * strokes drawn over the view that the name may not cross (the slingshot's arrow); with them it
   * may stand at any corner of its point, and be nudged off it, but never past the screen's edge
   */
  avoid?: readonly Stroke[];
}

/** a box of the screen (CSS px) */
export interface Box { l: number; t: number; r: number; b: number }

/** a stroke drawn over the view: the line from (ax, ay) to (bx, by), and `r` either side of it (CSS px) */
export interface Stroke { ax: number; ay: number; bx: number; by: number; r: number }

/**
 * Does a stroke touch the box from (x, y), `w` wide and `h` tall? The box grown by the stroke's
 * width either side, clipped against its line (Liang and Barsky). The grown box has square corners
 * where the stroke's reach is round: near a corner it errs on the side of clear.
 */
export function strokeMeets(s: Stroke, x: number, y: number, w: number, h: number): boolean {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, s.ax - (x - s.r)], [dx, x + w + s.r - s.ax], [-dy, s.ay - (y - s.r)], [dy, y + h + s.r - s.ay]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** no name comes within this many px of a box kept clear (the estimate of a name's width is rough) */
const CLEAR = 4;

/** a label on the screen: its box, and where the object it names is (CSS px) */
export interface Shown { x: number; y: number; w: number; h: number; ox: number; oy: number; c: LabelCandidate }

/** a name kept off strokes may be nudged from a corner of its point this far at a time (CSS px), this many times at most */
const NUDGE = 6, NUDGES = 8;

/**
 * Where a name `w` by `h` may stand by its point, best first: up and to the right of it, clear of its
 * disc; for one kept off strokes, also at the other corners, then nudged off each a step at a time
 * (outwards, up or down, along), nearest first.
 */
function spots(c: LabelCandidate, w: number, h: number): [number, number][] {
  const off = Math.min(c.radius, 40) * 0.72;
  const right = c.x + off + 4, left = c.x - off - 4 - w, up = c.y - off - h + 2, down = c.y + off - 2;
  if (!c.avoid) return [[right, up]];
  const out: [number, number][] = [];
  for (let k = 0; k <= NUDGES; k++) {
    for (const [x, y, sx, sy] of [[right, up, 1, -1], [right, down, 1, 1], [left, up, -1, -1], [left, down, -1, 1]]) {
      const d = k * NUDGE;
      out.push([x + sx * d, y + sy * d]);
      if (k) out.push([x, y + sy * d], [x + sx * d, y]);
    }
  }
  return out;
}

/** at most this many names at once */
const MAX_SHOWN = 80;
/**
 * Objects this close on the screen (CSS px) are one point to the eye: only the first of them by
 * priority is named. Two names for one point stand on each other (M87 and the hole at its heart,
 * M87*, are at the very same place: the galaxy's name was set up and to the right of the hole's
 * by its own size and read as a stack of two).
 */
export const ONE_POINT = 3;

/**
 * Where the names go (pure: no DOM): by priority, each up and to the right of its object, clear of
 * the object's own disc (`radius`, counted up to 40 px), skipping one that would overlap a name
 * already placed, lie off the screen, or name a point already named (but for one set over another
 * object on purpose). In the ship, `mask` is what covers the view (the cockpit's frame, the ship
 * itself: `ViewMask`): an object behind it goes unnamed, and a name that would lie across it goes
 * to the other side of its point, or goes. Nor does a name fall under a part of the interface
 * (`keepOut`: its cards and chips, the ship's instruments): a name half read through a card is
 * noise on it. A name to be kept off strokes drawn over the view (`avoid`: the words at the end of the
 * path ahead, off the slingshot's arrow) tries the corners of its point and places nudged off them,
 * nearest first, and goes where none will do.
 */
export function layoutLabels(cands: LabelCandidate[], width: number, height: number, mask: ViewMask | null = null, keepOut: readonly Box[] = []): Shown[] {
  const shown: Shown[] = [];
  const sorted = [...cands].sort((a, b) => b.priority - a.priority);
  const masked = !!mask && !mask.empty;
  for (const c of sorted) {
    if (shown.length >= MAX_SHOWN) break;
    if (masked && mask.covers(c.x, c.y)) continue;
    const w = 7 * c.text.length + 6, h = 14;
    for (const [sx, y] of spots(c, w, h)) {
      let x = sx;
      if (masked && mask.overlapsRect(x, y, w, h)) {
        if (c.avoid) continue;
        x = c.x - Math.min(c.radius, 40) * 0.72 - 4 - w;
        if (mask.overlapsRect(x, y, w, h)) break;
      }
      if (x > width || y > height || x + w < 0 || y + h < 0) continue;
      if (c.avoid && (x < 0 || y < 0 || x + w > width || y + h > height)) continue;
      if (keepOut.some((k) => x < k.r + CLEAR && x + w > k.l - CLEAR && y < k.b + CLEAR && y + h > k.t - CLEAR)) continue;
      if (c.avoid?.some((s) => strokeMeets(s, x, y, w, h))) continue;
      let free = true;
      for (const b of shown) {
        if ((x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) || (!c.over && !b.c.over && Math.hypot(c.x - b.ox, c.y - b.oy) < ONE_POINT)) { free = false; break; }
      }
      if (free) {
        shown.push({ x, y, w, h, ox: c.x, oy: c.y, c });
        break;
      }
    }
  }
  return shown;
}

export class Labels {
  enabled = true;
  /** the parts of the interface over the view, where no name may go (set each frame by the app) */
  keepOut: readonly Box[] = [];
  private nodes = new Map<string, HTMLDivElement>();
  private used = new Set<string>();
  private shown: Shown[] = [];

  constructor(private container: HTMLElement) {}

  update(cands: LabelCandidate[], width: number, height: number): void {
    this.used.clear();
    this.shown = this.enabled ? layoutLabels(cands, width, height, VIEW_MASK, this.keepOut) : [];
    for (const { x, y, c } of this.shown) {
      let el = this.nodes.get(c.key);
      if (!el) {
        el = document.createElement('div');
        this.container.appendChild(el);
        this.nodes.set(c.key, el);
      }
      if (el.textContent !== c.text) el.textContent = c.text;
      const cls = `label ${c.cls}`;
      if (el.className !== cls) el.className = cls;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.display = '';
      this.used.add(c.key);
    }
    this.sweep();
  }

  /**
   * The object named by the label at a point of the view (within `pad` px of its text): where that
   * object is on the screen, or null. People tap the name as readily as the dot beside it.
   */
  at(x: number, y: number, pad = 0): { x: number; y: number } | null {
    for (const b of this.shown) {
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return { x: b.ox, y: b.oy };
    }
    return null;
  }

  /** Hide the labels not shown this frame (and drop them once there are many). */
  private sweep(): void {
    for (const [k, el] of this.nodes) {
      if (!this.used.has(k)) {
        if (this.nodes.size > 400) {
          el.remove();
          this.nodes.delete(k);
        } else {
          el.style.display = 'none';
        }
      }
    }
  }
}
