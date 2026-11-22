/**
 * What covers the view in the ship: the cockpit's frame, or the ship itself in the chase view, as
 * shapes on the screen (CSS pixels), set every frame by the game (`ShipArt`). The names on the sky
 * (`Labels`) ask it whether the thing they name is behind the frame (then the name goes too) and
 * whether their text would lie across it (then it moves to the other side of the point, or goes).
 * Pure arithmetic: no DOM.
 */

/** A thick segment: everything within `r` of the line from a to b. */
export interface Capsule { ax: number; ay: number; bx: number; by: number; r: number }

/** A convex polygon (x, y pairs, either winding). */
export interface Poly { pts: number[] }

function segDist2(px: number, py: number, c: Capsule): number {
  const dx = c.bx - c.ax, dy = c.by - c.ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - c.ax) * dx + (py - c.ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = c.ax + t * dx - px, ey = c.ay + t * dy - py;
  return ex * ex + ey * ey;
}

function inPoly(px: number, py: number, p: Poly): boolean {
  const s = p.pts, n = s.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const ax = s[i * 2], ay = s[i * 2 + 1], bx = s[((i + 1) % n) * 2], by = s[((i + 1) % n) * 2 + 1];
    const c = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (c === 0) continue;
    const sg = c > 0 ? 1 : -1;
    if (sign === 0) sign = sg;
    else if (sg !== sign) return false;
  }
  return true;
}

/** Distance from a point to a rectangle (0 inside). */
function rectDist2(px: number, py: number, x: number, y: number, w: number, h: number): number {
  const dx = Math.max(x - px, 0, px - (x + w)), dy = Math.max(y - py, 0, py - (y + h));
  return dx * dx + dy * dy;
}

/** Do two segments cross? */
function segsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return o(ax, ay, bx, by, cx, cy) !== o(ax, ay, bx, by, dx, dy) && o(cx, cy, dx, dy, ax, ay) !== o(cx, cy, dx, dy, bx, by);
}

export class ViewMask {
  capsules: Capsule[] = [];
  polys: Poly[] = [];

  clear(): void {
    this.capsules.length = 0;
    this.polys.length = 0;
  }

  get empty(): boolean {
    return this.capsules.length === 0 && this.polys.length === 0;
  }

  /** Is the point (CSS px) behind what covers the view? (`pad`: grown by this many pixels) */
  covers(x: number, y: number, pad = 0): boolean {
    for (const c of this.capsules) if (segDist2(x, y, c) <= (c.r + pad) ** 2) return true;
    for (const p of this.polys) if (inPoly(x, y, p)) return true;
    return false;
  }

  /** Does the rectangle (CSS px) touch what covers the view? */
  overlapsRect(x: number, y: number, w: number, h: number): boolean {
    for (const c of this.capsules) {
      // the capsule's segment against the rectangle: an end inside, or the segment crossing an edge,
      // or the nearest approach within its radius
      if (rectDist2(c.ax, c.ay, x, y, w, h) <= c.r * c.r || rectDist2(c.bx, c.by, x, y, w, h) <= c.r * c.r) return true;
      const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      for (const [px, py] of corners) if (segDist2(px, py, c) <= c.r * c.r) return true;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
        if (segsCross(ax, ay, bx, by, c.ax, c.ay, c.bx, c.by)) return true;
      }
    }
    for (const p of this.polys) {
      const s = p.pts, n = s.length / 2;
      // a corner of either inside the other, or edges crossing
      for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) if (inPoly(px, py, p)) return true;
      for (let i = 0; i < n; i++) if (s[i * 2] >= x && s[i * 2] <= x + w && s[i * 2 + 1] >= y && s[i * 2 + 1] <= y + h) return true;
      const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      for (let i = 0; i < n; i++) {
        const ax = s[i * 2], ay = s[i * 2 + 1], bx = s[((i + 1) % n) * 2], by = s[((i + 1) % n) * 2 + 1];
        for (let k = 0; k < 4; k++) {
          const [cx, cy] = corners[k], [dx, dy] = corners[(k + 1) % 4];
          if (segsCross(ax, ay, bx, by, cx, cy, dx, dy)) return true;
        }
      }
    }
    return false;
  }
}

/** The view's mask, shared by the game (which sets it) and the names on the sky (which read it). */
export const VIEW_MASK = new ViewMask();
