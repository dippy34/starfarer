/**
 * Links to a scene, and handing them on: the browser's address, its share sheet and its clipboard
 * are reached from here and nowhere else (src/platform holds the browser's
 * own APIs; storage.ts is the other). What the link says is src/app/SceneLink.ts's business; here
 * it is only a string after the '#'.
 *
 * The scene goes after '#' (the fragment), not in the query: the browser never sends the fragment
 * to the server, so a long link is never refused by it (GitHub Pages answers 414 to long request
 * lines), and nobody's scene is written into a server's logs.
 */

/** How a link was handed on: the system's share sheet; copied; shown for the explorer to copy; the sheet closed without sharing; nothing worked. */
export type Handed = 'shared' | 'copied' | 'shown' | 'cancelled' | 'failed';

/** The scene part of the address this page was opened at ('' for none): what follows the '#'. */
export function linkFragment(): string {
  try {
    return typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '');
  } catch {
    return '';
  }
}

/** Take the scene part off the address bar (once it has been opened), the page staying as it is. */
export function forgetFragment(): void {
  try {
    if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  } catch {
    /* the address keeps it: a reload opens the scene again */
  }
}

/** When the scene part of the address changes while the page is open (a second link opened into this tab). */
export function onFragmentChange(then: (fragment: string) => void): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('hashchange', () => then(linkFragment()));
}

/** The address of this app with `fragment` after it: this page, without whatever the query asked of it. */
export function pageLink(fragment: string): string {
  return `${location.origin}${location.pathname}#${fragment}`;
}

/**
 * Hand a link on: the system's share sheet if `sheet` (a phone) and the browser has one; else
 * copied to the clipboard; else, where neither is allowed, shown in a box for the explorer to copy.
 * Always settles, never throws.
 */
export async function handOn(link: { url: string; title: string; text: string }, sheet: boolean): Promise<Handed> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (sheet && nav && typeof nav.share === 'function') {
    const data = { title: link.title, text: link.text, url: link.url };
    try {
      if (!nav.canShare || nav.canShare(data)) {
        await nav.share(data);
        return 'shared';
      }
    } catch (e) {
      // (closed without choosing: nothing to say; anything else falls through to the clipboard)
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(link.url);
      return 'copied';
    }
  } catch {
    /* not allowed here: the older way, then shown */
  }
  if (copyByCommand(link.url)) return 'copied';
  try {
    window.prompt('Copy this link:', link.url);
    return 'shown';
  } catch {
    return 'failed';
  }
}

/** The clipboard as browsers had it before navigator.clipboard (an older Safari, a page not served securely). */
function copyByCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
