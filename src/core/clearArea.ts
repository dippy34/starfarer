/**
 * The part of the screen the interface leaves clear, for the view's optical centre to sit in (as a
 * map app pads its view by the card that stands over it). Pure arithmetic: no DOM.
 */

/** A part of the screen, in CSS px from its top-left corner. */
export interface Box { l: number; t: number; r: number; b: number }

/**
 * What a clear rectangle is worth to hold a view in: its area, but a width beyond `wide` times its
 * height counts for nothing (a long strip between a chip and a card is room for a line of text,
 * not for what is looked at).
 */
export const worth = (b: Box, wide: number): number => Math.min(b.r - b.l, wide * (b.b - b.t)) * (b.b - b.t);

/**
 * The most worth (`worth`, given `wide`) among the clear rectangles on a `width` x `height` screen
 * with every one of `boxes` (grown by `pad` on each side) left out, at least `minW` x `minH`; null
 * if there is none.
 * Every such rectangle can be grown until its sides touch a box or the screen's edge, so only
 * rectangles whose sides are those edges are tried: the clear stretch is found along the height
 * for each pair of such vertical sides.
 */
export function largestClear(width: number, height: number, boxes: readonly Box[], pad: number, minW: number, minH: number, wide = Infinity): Box | null {
  const grown = boxes.map((b) => ({ l: b.l - pad, t: b.t - pad, r: b.r + pad, b: b.b + pad }));
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  const xs = [...new Set([0, width, ...grown.flatMap((b) => [clamp(b.l, width), clamp(b.r, width)])])].sort((a, b) => a - b);
  let best: Box | null = null, bestArea = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const w = xs[j] - xs[i];
      if (w < minW) continue;
      // what stands in the way across this width, as stretches of the height
      const stops = grown.filter((b) => b.l < xs[j] && b.r > xs[i]).map((b) => [b.t, b.b] as const).sort((p, q) => p[0] - q[0]);
      let from = 0;
      const gap = (a: number, z: number) => {
        const h = z - a;
        if (h < minH) return;
        const here = { l: xs[i], t: a, r: xs[j], b: z }, v = worth(here, wide);
        if (v > bestArea) { bestArea = v; best = here; }
      };
      for (const [t, b] of stops) {
        if (t > from) gap(from, Math.min(t, height));
        from = Math.max(from, b);
      }
      if (from < height) gap(Math.max(0, from), height);
    }
  }
  return best;
}

/** Is `box` still free of every one of `boxes` (grown by `pad`)? */
export function isClear(box: Box, boxes: readonly Box[], pad: number): boolean {
  return !boxes.some((b) => box.l < b.r + pad && box.r > b.l - pad && box.t < b.b + pad && box.b > b.t - pad);
}

