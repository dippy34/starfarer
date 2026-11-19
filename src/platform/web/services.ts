/**
 * Web implementations of the smaller platform services:
 * share sheet / clipboard / file save, haptics, deep links, asset fetching,
 * device info and app lifecycle.
 */
import type { Assets, DeviceInfo, HapticKind, Haptics, Lifecycle, Links, ShareService } from '../types';

export class WebShare implements ShareService {
  async share(data: { title: string; text?: string; url?: string }): Promise<boolean> {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share(data);
        return true;
      }
    } catch {
      /* cancelled or blocked: fall through to "not shared" */
    }
    return false;
  }

  async copy(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall back below */
    }
    // Legacy fallback for webviews without the async clipboard API.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async saveFile(blob: Blob, filename: string): Promise<boolean> {
    // Prefer the share sheet on phones (lets the user save to Photos); otherwise download.
    try {
      const file = new File([blob], filename, { type: blob.type });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (matchMedia('(pointer: coarse)').matches && nav.canShare?.({ files: [file] }) && typeof navigator.share === 'function') {
        await navigator.share({ files: [file], title: 'Starfarer' } as ShareData);
        return true;
      }
    } catch {
      /* cancelled: fall back to a download */
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch {
      return false;
    }
  }
}

const PATTERNS: Record<HapticKind, number | number[]> = { tap: 8, select: 14, arrive: [18, 40, 28], warp: 30, error: [30, 60, 30] };

export class WebHaptics implements Haptics {
  fire(kind: HapticKind): void {
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(PATTERNS[kind]);
    } catch {
      /* vibration not allowed: ignore */
    }
  }
}

export class WebLinks implements Links {
  getHash(): string {
    return window.location.hash.replace(/^#/, '');
  }

  setHash(hash: string): void {
    try {
      const url = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`;
      window.history.replaceState(null, '', url);
    } catch {
      /* sandboxed iframes may forbid history changes */
    }
  }

  urlWithHash(hash: string): string {
    return `${window.location.origin}${window.location.pathname}${window.location.search}#${hash}`;
  }

  onHashChange(listener: (hash: string) => void): () => void {
    const fn = (): void => listener(this.getHash());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }
}

export class WebAssets implements Assets {
  readonly dataUrl: string;

  constructor() {
    // Vite's BASE_URL makes the app relocatable (sub-folder hosting, Capacitor's local server).
    this.dataUrl = new URL(`${import.meta.env.BASE_URL}data/`, window.location.href).href;
  }

  async fetchData(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await fetch(this.dataUrl + path, { signal, cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for data/${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

export class WebDevice implements DeviceInfo {
  readonly mobile = matchMedia('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) < 700;
  readonly memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  readonly cores = navigator.hardwareConcurrency || 4;
  readonly prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  get pixelRatio(): number {
    return window.devicePixelRatio || 1;
  }
}

export class WebLifecycle implements Lifecycle {
  private wantWakeLock = false;

  constructor() {
    // Wake locks are dropped when the page is hidden; re-acquire on return.
    document.addEventListener('visibilitychange', () => {
      if (this.isVisible() && this.wantWakeLock) this.requestWakeLock();
    });
  }

  isVisible(): boolean {
    return document.visibilityState !== 'hidden';
  }

  onVisibilityChange(listener: (visible: boolean) => void): () => void {
    const fn = (): void => listener(this.isVisible());
    document.addEventListener('visibilitychange', fn);
    window.addEventListener('pagehide', fn);
    window.addEventListener('pageshow', fn);
    return () => {
      document.removeEventListener('visibilitychange', fn);
      window.removeEventListener('pagehide', fn);
      window.removeEventListener('pageshow', fn);
    };
  }

  isOnline(): boolean {
    return navigator.onLine !== false;
  }

  onOnlineChange(listener: (online: boolean) => void): () => void {
    const on = (): void => listener(true);
    const off = (): void => listener(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }

  requestWakeLock(): void {
    this.wantWakeLock = true;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } };
    nav.wakeLock
      ?.request('screen')
      .catch(() => {
        // Not allowed (low battery, background tab…): the screen may dim, nothing else breaks.
        this.wantWakeLock = false;
      });
  }

  registerOfflineSupport(): void {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    });
  }
}
