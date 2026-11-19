/**
 * Platform service interfaces.
 *
 * Everything the app needs from "the device" beyond the web runtime itself
 * (DOM, canvas/WebGL, Web Workers) goes through these interfaces, so the web
 * implementations in ./web can be swapped for Capacitor plugins when the app
 * is wrapped for iOS/Android — without touching game code.
 */

/** Small synchronous key–value store for settings, bookmarks, recents. */
export interface KeyValueStore {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

/** Persistent binary cache for data tiles (IndexedDB on the web; filesystem on native). */
export interface BlobStore {
  /** Resolves to null when the key is absent or the store is unavailable. */
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  /** Remove every entry whose key does not start with `keepPrefix` (used when the data version changes). */
  clearExcept(keepPrefix: string): Promise<void>;
  /** True if entries survive a restart (false = in-memory fallback). */
  readonly persistent: boolean;
}

export interface ShareService {
  /** Open the native share sheet; resolves false if unsupported or cancelled. */
  share(data: { title: string; text?: string; url?: string }): Promise<boolean>;
  /** Copy text to the clipboard; resolves false if not permitted. */
  copy(text: string): Promise<boolean>;
  /** Save or share a file (screenshots). */
  saveFile(blob: Blob, filename: string): Promise<boolean>;
}

export type HapticKind = 'tap' | 'select' | 'arrive' | 'warp' | 'error';

export interface Haptics {
  fire(kind: HapticKind): void;
}

export type SoundEffect = 'tap' | 'select' | 'open' | 'close' | 'flyStart' | 'flyArrive' | 'shutter' | 'error' | 'toggle';
export type AmbientScene = 'none' | 'space' | 'galaxy' | 'system' | 'planet' | 'surface' | 'cosmic';

/**
 * Sound manager. The web implementation synthesises everything with WebAudio
 * (no audio files); a native implementation could play real music/effects
 * through the same hooks.
 */
export interface AudioEngine {
  /** Must be called from a user gesture before any sound can play (autoplay policies). */
  unlock(): void;
  setEnabled(enabled: boolean): void;
  /** Suspend/resume output when the app is backgrounded. */
  setSuspended(suspended: boolean): void;
  playEffect(effect: SoundEffect): void;
  /** Cross-fade the ambient bed to match where the player is. */
  setAmbient(scene: AmbientScene): void;
  /** Engine / warp intensity 0–1 (drives a soft whoosh). */
  setWarp(intensity: number): void;
  /** Black-hole proximity 0–1: a low rumble that rises in pitch and volume. */
  setRumble(intensity: number): void;
}

/** URL / deep-link state (the share-link hash). */
export interface Links {
  /** Current fragment without the leading '#'. */
  getHash(): string;
  /** Replace the fragment without adding a history entry. */
  setHash(hash: string): void;
  /** Absolute URL of the app with the given fragment (for sharing). */
  urlWithHash(hash: string): string;
  onHashChange(listener: (hash: string) => void): () => void;
}

/** Static asset loading (data tiles). On native this can read from the app bundle. */
export interface Assets {
  /** Fetch a file under the data folder. Rejects on network / HTTP errors. */
  fetchData(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  /** Base URL of the data folder (for workers that fetch on their own). */
  readonly dataUrl: string;
}

export interface DeviceInfo {
  /** Coarse pointer / small screen → phone or tablet. */
  readonly mobile: boolean;
  /** Approximate device memory in GB (undefined when the browser does not say). */
  readonly memoryGb: number | undefined;
  readonly cores: number;
  readonly prefersReducedMotion: boolean;
  readonly pixelRatio: number;
}

export interface Lifecycle {
  /** True while the app is visible / foregrounded. */
  isVisible(): boolean;
  onVisibilityChange(listener: (visible: boolean) => void): () => void;
  isOnline(): boolean;
  onOnlineChange(listener: (online: boolean) => void): () => void;
  /** Keep the screen awake while exploring (best effort). */
  requestWakeLock(): void;
  /** Register the offline service worker (no-op where unsupported). */
  registerOfflineSupport(): void;
}

export interface Platform {
  storage: KeyValueStore;
  blobs: BlobStore;
  share: ShareService;
  haptics: Haptics;
  audio: AudioEngine;
  links: Links;
  assets: Assets;
  device: DeviceInfo;
  lifecycle: Lifecycle;
}
