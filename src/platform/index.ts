/**
 * Platform entry point. Game code imports `platform` from here and never
 * touches storage / share / haptics / audio / lifecycle browser APIs directly.
 *
 * To target Capacitor later, build a `Platform` object from native plugins and
 * call `setPlatform()` before the app boots — nothing else needs to change.
 */
import type { Platform } from './types';
import { WebAudioEngine } from './web/audio';
import { WebAssets, WebDevice, WebHaptics, WebLifecycle, WebLinks, WebShare } from './web/services';
import { WebBlobStore, WebKeyValueStore } from './web/storage';

export type * from './types';

let current: Platform | null = null;

/** Lazily create the default (web) platform. */
function createWebPlatform(): Platform {
  return {
    storage: new WebKeyValueStore(),
    blobs: new WebBlobStore(),
    share: new WebShare(),
    haptics: new WebHaptics(),
    audio: new WebAudioEngine(),
    links: new WebLinks(),
    assets: new WebAssets(),
    device: new WebDevice(),
    lifecycle: new WebLifecycle(),
  };
}

/** Replace the platform implementation (e.g. with Capacitor-backed services). Call before boot. */
export function setPlatform(p: Platform): void {
  current = p;
}

/** The active platform services. */
export const platform: Platform = new Proxy({} as Platform, {
  get(_target, prop: keyof Platform) {
    if (!current) current = createWebPlatform();
    return current[prop];
  },
});
