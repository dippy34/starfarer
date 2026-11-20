/** What kind of device this is, where it changes what the app does. */

/** A device that is held and touched (a phone, a tablet), not pointed at with a mouse. */
export function touchFirst(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
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
