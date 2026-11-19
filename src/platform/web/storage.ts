/**
 * Web implementations of the storage services.
 *   KeyValueStore → localStorage (falls back to memory in private mode)
 *   BlobStore     → IndexedDB    (falls back to a small in-memory LRU)
 */
import type { BlobStore, KeyValueStore } from '../types';

const PREFIX = 'starfarer:';

export class WebKeyValueStore implements KeyValueStore {
  private readonly memory = new Map<string, string>();
  private readonly ls: Storage | null;

  constructor() {
    let ls: Storage | null = null;
    try {
      ls = window.localStorage;
      const probe = `${PREFIX}__probe`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
    } catch {
      ls = null; // private browsing / storage disabled
    }
    this.ls = ls;
  }

  get<T>(key: string, fallback: T): T {
    try {
      const raw = this.ls ? this.ls.getItem(PREFIX + key) : (this.memory.get(key) ?? null);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    const raw = JSON.stringify(value);
    try {
      if (this.ls) this.ls.setItem(PREFIX + key, raw);
      else this.memory.set(key, raw);
    } catch {
      this.memory.set(key, raw); // quota exceeded: keep it for this session at least
    }
  }

  remove(key: string): void {
    try {
      this.ls?.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
    this.memory.delete(key);
  }
}

const DB_NAME = 'starfarer-data';
const DB_VERSION = 2;
const STORE = 'tiles';
const META = 'meta';
/** In-memory fallback budget when IndexedDB is unavailable. */
const MEMORY_LIMIT_BYTES = 24 * 1024 * 1024;
/** Entries touched this recently are never evicted (they are probably on screen). */
const PROTECT_MS = 60_000;

interface Meta {
  bytes: number;
  /** Last read or write, ms since the epoch. */
  used: number;
}

/**
 * Persistent cache for data tiles.
 *
 * IndexedDB holds the bytes; a small `meta` store (mirrored in memory) records
 * each entry's size and last use. When the cache grows past `limitBytes` the
 * least-recently-used entries are evicted, so the app never takes more than its
 * allowance of a phone's storage however much of the universe has been visited.
 */
export class WebBlobStore implements BlobStore {
  persistent = false;
  private db: IDBDatabase | null = null;
  private readonly ready: Promise<void>;
  private readonly memory = new Map<string, Uint8Array>();
  private memoryBytes = 0;
  private readonly index = new Map<string, Meta>();
  private totalBytes = 0;
  private readonly touched = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private evicting = false;

  /** @param limitBytes size cap of the persistent cache */
  constructor(private readonly limitBytes = 128 * 1024 * 1024) {
    this.ready = this.open();
  }

  /** Bytes currently held in the persistent cache. */
  get usedBytes(): number {
    return this.db ? this.totalBytes : this.memoryBytes;
  }

  private open(): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (typeof window.indexedDB === 'undefined') return resolve();
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          // The cache can always be refilled from the network: start clean on any schema change.
          const db = req.result;
          for (const name of [STORE, META]) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
            db.createObjectStore(name);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          // If another tab upgrades the database, release our handle instead of blocking it.
          db.onversionchange = () => {
            db.close();
            this.db = null;
            this.persistent = false;
          };
          // Load the size / last-use index.
          try {
            const cursor = db.transaction(META, 'readonly').objectStore(META).openCursor();
            cursor.onsuccess = () => {
              const c = cursor.result;
              if (c) {
                const m = c.value as Meta;
                if (typeof c.key === 'string' && m && typeof m.bytes === 'number') {
                  this.index.set(c.key, { bytes: m.bytes, used: m.used || 0 });
                  this.totalBytes += m.bytes;
                }
                c.continue();
                return;
              }
              this.db = db;
              this.persistent = true;
              resolve();
            };
            cursor.onerror = () => resolve();
          } catch {
            resolve();
          }
        };
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /** Run one transaction; resolves true when it committed. */
  private transact(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => void): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      try {
        const tx = this.db.transaction(stores, mode);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
        run(tx);
      } catch {
        resolve(false);
      }
    });
  }

  /** Remember that an entry was used; last-use times are written back lazily in one batch. */
  private touch(key: string): void {
    const m = this.index.get(key);
    if (!m) return;
    m.used = Date.now();
    this.touched.add(key);
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const keys = [...this.touched];
        this.touched.clear();
        void this.transact([META], 'readwrite', (tx) => {
          const meta = tx.objectStore(META);
          for (const k of keys) {
            const v = this.index.get(k);
            if (v) meta.put(v, k);
          }
        });
      }, 5000);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    await this.ready;
    if (!this.db) {
      const hit = this.memory.get(key);
      if (hit) {
        // Refresh LRU position.
        this.memory.delete(key);
        this.memory.set(key, hit);
      }
      return hit ?? null;
    }
    let value: unknown = null;
    await this.transact([STORE], 'readonly', (tx) => {
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        value = req.result;
      };
    });
    const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    if (bytes) this.touch(key);
    return bytes;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.ready;
    if (!this.db) {
      const old = this.memory.get(key);
      if (old) this.memoryBytes -= old.byteLength;
      this.memory.delete(key);
      this.memory.set(key, data);
      this.memoryBytes += data.byteLength;
      for (const [k, v] of this.memory) {
        if (this.memoryBytes <= MEMORY_LIMIT_BYTES) break;
        this.memory.delete(k);
        this.memoryBytes -= v.byteLength;
      }
      return;
    }
    const meta: Meta = { bytes: data.byteLength, used: Date.now() };
    const ok = await this.transact([STORE, META], 'readwrite', (tx) => {
      tx.objectStore(STORE).put(data, key);
      tx.objectStore(META).put(meta, key);
    });
    if (!ok) return; // quota exceeded or storage revoked: the tile simply is not cached
    this.totalBytes += meta.bytes - (this.index.get(key)?.bytes ?? 0);
    this.index.set(key, meta);
    if (this.totalBytes > this.limitBytes) await this.evict();
  }

  /** Drop least-recently-used entries until the cache is comfortably under its limit. */
  private async evict(): Promise<void> {
    if (this.evicting) return;
    this.evicting = true;
    try {
      const target = this.limitBytes * 0.85;
      const now = Date.now();
      const victims: string[] = [];
      let freed = 0;
      const byAge = [...this.index.entries()].sort((a, b) => a[1].used - b[1].used);
      for (const [key, m] of byAge) {
        if (this.totalBytes - freed <= target) break;
        // Keep what is in use right now, and the manifest (needed to start offline).
        if (now - m.used < PROTECT_MS || !key.includes('/')) continue;
        victims.push(key);
        freed += m.bytes;
      }
      if (victims.length === 0) return;
      const ok = await this.transact([STORE, META], 'readwrite', (tx) => {
        for (const k of victims) {
          tx.objectStore(STORE).delete(k);
          tx.objectStore(META).delete(k);
        }
      });
      if (!ok) return;
      for (const k of victims) {
        this.totalBytes -= this.index.get(k)?.bytes ?? 0;
        this.index.delete(k);
        this.touched.delete(k);
      }
    } finally {
      this.evicting = false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    const hit = this.memory.get(key);
    if (hit) {
      this.memoryBytes -= hit.byteLength;
      this.memory.delete(key);
    }
    if (!this.db) return;
    const ok = await this.transact([STORE, META], 'readwrite', (tx) => {
      tx.objectStore(STORE).delete(key);
      tx.objectStore(META).delete(key);
    });
    if (ok) {
      this.totalBytes -= this.index.get(key)?.bytes ?? 0;
      this.index.delete(key);
    }
  }

  async clearExcept(keepPrefix: string): Promise<void> {
    await this.ready;
    for (const k of [...this.memory.keys()]) if (!k.startsWith(keepPrefix)) await this.delete(k);
    if (!this.db) return;
    // Anything in the store that the index does not know about (a crash between writes) goes too.
    let keys: IDBValidKey[] = [];
    await this.transact([STORE], 'readonly', (tx) => {
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => {
        keys = req.result;
      };
    });
    const stale = keys.filter((k): k is string => typeof k === 'string' && (!k.startsWith(keepPrefix) || !this.index.has(k)));
    if (stale.length === 0) return;
    const ok = await this.transact([STORE, META], 'readwrite', (tx) => {
      for (const k of stale) {
        tx.objectStore(STORE).delete(k);
        tx.objectStore(META).delete(k);
      }
    });
    if (!ok) return;
    for (const k of stale) {
      this.totalBytes -= this.index.get(k)?.bytes ?? 0;
      this.index.delete(k);
    }
  }
}
