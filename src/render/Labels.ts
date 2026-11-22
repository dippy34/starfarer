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
}

/** a box of the screen (CSS px) */
export interface Box { l: number; t: number; r: number; b: number }
/** no name comes within this many px of a box kept clear (the estimate of a name's width is rough) */
const CLEAR = 4;

/** a label on the screen: its box, and where the object it names is (CSS px) */
export interface Shown { x: number; y: number; w: number; h: number; ox: number; oy: number; c: LabelCandidate }

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
 * noise on it.
 */
export function layoutLabels(cands: LabelCandidate[], width: number, height: number, mask: ViewMask | null = null, keepOut: readonly Box[] = []): Shown[] {
  const shown: Shown[] = [];
  const sorted = [...cands].sort((a, b) => b.priority - a.priority);
  const masked = !!mask && !mask.empty;
  for (const c of sorted) {
    if (shown.length >= MAX_SHOWN) break;
    if (masked && mask.covers(c.x, c.y)) continue;
    const w = 7 * c.text.length + 6, h = 14;
    let x = c.x + Math.min(c.radius, 40) * 0.72 + 4;
    const y = c.y - Math.min(c.radius, 40) * 0.72 - h + 2;
    if (masked && mask.overlapsRect(x, y, w, h)) {
      x = c.x - Math.min(c.radius, 40) * 0.72 - 4 - w;
      if (mask.overlapsRect(x, y, w, h)) continue;
    }
    if (x > width || y > height || x + w < 0 || y + h < 0) continue;
    if (keepOut.some((k) => x < k.r + CLEAR && x + w > k.l - CLEAR && y < k.b + CLEAR && y + h > k.t - CLEAR)) continue;
    let free = true;
    for (const b of shown) {
      if ((x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) || (!c.over && !b.c.over && Math.hypot(c.x - b.ox, c.y - b.oy) < ONE_POINT)) { free = false; break; }
    }
    if (free) shown.push({ x, y, w, h, ox: c.x, oy: c.y, c });
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
