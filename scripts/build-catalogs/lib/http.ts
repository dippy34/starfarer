/**
 * Download helpers for the catalog pipeline.
 *
 * Every raw download is cached under scripts/build-catalogs/.raw/ so the
 * pipeline is resumable: re-running only fetches what is missing. Delete the
 * folder (or pass --refresh) to force a clean re-download.
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

const here = dirname(fileURLToPath(import.meta.url));

/** Folder holding raw (unprocessed) catalog downloads. Git-ignored. */
export const RAW_DIR = join(here, '..', '.raw');

/** Folder the runtime data tiles are written to (served statically by Vite). */
export const OUT_DIR = join(here, '..', '..', '..', 'public', 'data');

export function rawPath(name: string): string {
  const p = join(RAW_DIR, name);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: URLSearchParams | string;
  headers?: Record<string, string>;
  /** Total attempts before giving up (default 5, exponential backoff). */
  attempts?: number;
  /** Per-attempt timeout in ms (default 10 minutes). */
  timeoutMs?: number;
  /** Reject downloads smaller than this many bytes (guards against HTML error pages). */
  minBytes?: number;
}

/** fetch() with retry + backoff. Throws after the last attempt fails. */
export async function fetchRetry(url: string, opts: FetchOpts = {}): Promise<Response> {
  const attempts = opts.attempts ?? 5;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        body: opts.body,
        headers: opts.headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 600_000),
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status} from ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(60_000, 2000 * 2 ** i);
      console.warn(`  ! ${String(err).slice(0, 160)} — retry ${i + 1}/${attempts} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${String(lastErr)}`);
}

/**
 * Download `url` to .raw/`name` unless it is already cached.
 * Returns the local path. Writes via a temp file so partial downloads are never
 * mistaken for complete ones.
 */
export async function download(name: string, url: string, opts: FetchOpts & { refresh?: boolean } = {}): Promise<string> {
  const dest = rawPath(name);
  if (!opts.refresh && existsSync(dest) && statSync(dest).size >= (opts.minBytes ?? 1)) return dest;
  const attempts = opts.attempts ?? 5;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const tmp = `${dest}.part`;
    try {
      const res = await fetchRetry(url, { ...opts, attempts: 1 });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(tmp));
      const size = statSync(tmp).size;
      if (size < (opts.minBytes ?? 1)) throw new Error(`download too small (${size} bytes) for ${url}`);
      renameSync(tmp, dest);
      console.info(`  ✓ ${name} (${(size / 1e6).toFixed(2)} MB)`);
      return dest;
    } catch (err) {
      lastErr = err;
      if (existsSync(tmp)) unlinkSync(tmp);
      const wait = Math.min(90_000, 3000 * 2 ** i);
      console.warn(`  ! ${name}: ${String(err).slice(0, 200)} — retry ${i + 1}/${attempts} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`Failed to download ${name} from ${url}: ${String(lastErr)}`);
}

/** Run async jobs with a bounded number in flight (archives throttle parallel clients). */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
