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
