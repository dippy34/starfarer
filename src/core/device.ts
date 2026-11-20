/** What kind of device this is, where it changes what the app does. */

/** A device that is held and touched (a phone, a tablet), not pointed at with a mouse. */
export function touchFirst(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** the most pixels a canvas denser than 2 to a CSS pixel is given: about a 6.1-inch phone's own */
export const CANVAS_PIXELS = 3.2e6;

/**
 * The canvas's pixels per CSS pixel on a screen of `dpr`: the screen's own up to 2, as ever; and
 * a denser screen's own too (a phone's 3), as far as CANVAS_PIXELS allows. A canvas of 2 on a
 * screen of 3 is stretched one and a half times to fit: every star a pixel wide comes out a soft
 * blob, and the picture's fine grain as a faint mesh. (If that many pixels are more than the
 * device draws in time, the quality governor lowers the scene's resolution: render/Quality.ts.)
 */
export function canvasRatio(dpr: number, cssWidth: number, cssHeight: number): number {
  const within = Math.sqrt(CANVAS_PIXELS / Math.max(cssWidth * cssHeight, 1));
  return Math.min(dpr > 0 ? dpr : 1, Math.max(2, within));
}

/**
 * Little memory to spare: headsets, phones and tablets, where the browser closes a page that takes
 * too much. They get the lighter set of content (fewer procedural stars and galaxy particles,
 * smaller tile caches and ground materials, no 8k maps); `?lean=0` or `?lean=1` overrides.
 */
export function leanDevice(headset: boolean): boolean {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lean') : null;
  if (q === '1') return true;
  if (q === '0') return false;
  return headset || touchFirst();
}
