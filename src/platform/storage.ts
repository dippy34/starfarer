import { STORAGE_PREFIX } from '../core/product';

/**
 * What the app remembers on this device from one visit to the next (a setting the explorer chose).
 * The browser's storage is reached from here and nowhere else in new code (src/platform holds the
 * browser's own APIs); where it is not available (private browsing, a test run in Node) nothing is
 * remembered and nothing fails.
 */

/** What was remembered under `key`, or null. */
export function recall(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(`${STORAGE_PREFIX}-${key}`) ?? null;
  } catch {
    return null;
  }
}

/** Remember `value` under `key`. */
export function remember(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(`${STORAGE_PREFIX}-${key}`, value);
  } catch {
    /* not remembered: asked again next time */
  }
}

/** How keeping something went: kept; not kept because the browser's room for this site is full; not kept because the browser keeps nothing here (private browsing in an older Safari, storage switched off). */
export type Kept = 'kept' | 'full' | 'unavailable';

/** Remember `value` under `key`, and say how that went (`remember` for what may quietly not be kept). */
export function keep(key: string, value: string): Kept {
  let store: Storage | undefined;
  try {
    store = globalThis.localStorage;
  } catch {
    return 'unavailable';
  }
  if (!store) return 'unavailable';
  try {
    store.setItem(`${STORAGE_PREFIX}-${key}`, value);
    return 'kept';
  } catch (e) {
    // (QuotaExceededError, by whatever name and code each browser gives it. An older Safari in private browsing throws
    // it for everything, with nothing kept: that is not "full", it keeps nothing)
    const full = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
    return full && store.length > 0 ? 'full' : 'unavailable';
  }
}

/** Forget what was remembered under `key`. */
export function forget(key: string): void {
  try {
    globalThis.localStorage?.removeItem(`${STORAGE_PREFIX}-${key}`);
  } catch {
    /* nothing kept to forget */
  }
}
