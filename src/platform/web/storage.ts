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
const STORE = 'tiles';
/** In-memory fallback budget when IndexedDB is unavailable. */
const MEMORY_LIMIT_BYTES = 24 * 1024 * 1024;

export class WebBlobStore implements BlobStore {
  persistent = false;
  private db: IDBDatabase | null = null;
  private readonly ready: Promise<void>;
  private readonly memory = new Map<string, Uint8Array>();
  private memoryBytes = 0;

  constructor() {
    this.ready = this.open();
  }

  private open(): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (typeof window.indexedDB === 'undefined') return resolve();
        const req = window.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => {
          this.db = req.result;
          this.persistent = true;
          // If another tab upgrades the database, release our handle instead of blocking it.
          this.db.onversionchange = () => {
            this.db?.close();
            this.db = null;
            this.persistent = false;
          };
          resolve();
        };
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    return new Promise((resolve) => {
      if (!this.db) return resolve(null);
      try {
        const tx = this.db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
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
    const value = await this.request<unknown>('readonly', (s) => s.get(key));
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.ready;
    if (!this.db) {
      this.memory.set(key, data);
      this.memoryBytes += data.byteLength;
      for (const [k, v] of this.memory) {
        if (this.memoryBytes <= MEMORY_LIMIT_BYTES) break;
        this.memory.delete(k);
        this.memoryBytes -= v.byteLength;
      }
      return;
    }
    await this.request('readwrite', (s) => s.put(data, key));
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    const hit = this.memory.get(key);
    if (hit) {
      this.memoryBytes -= hit.byteLength;
      this.memory.delete(key);
    }
    if (this.db) await this.request('readwrite', (s) => s.delete(key));
  }

  async clearExcept(keepPrefix: string): Promise<void> {
    await this.ready;
    for (const k of [...this.memory.keys()]) if (!k.startsWith(keepPrefix)) await this.delete(k);
    if (!this.db) return;
    const keys = await this.request<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    if (!keys) return;
    for (const k of keys) {
      if (typeof k === 'string' && !k.startsWith(keepPrefix)) await this.request('readwrite', (s) => s.delete(k));
    }
  }
}
