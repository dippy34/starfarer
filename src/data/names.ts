/**
 * Names table: every real object that has a name or catalogue designation.
 * Chunk 0 (famous objects) is loaded at start-up; the long tail loads the
 * first time it is needed (search, or tapping an object whose name lives in a
 * later chunk).
 */
import type { WorkerPool } from './workerPool';

export type NameKind = 's' | 'g' | 'q' | 'd';

export interface NameRecord {
  id: number;
  kind: NameKind;
  /** Display name first, then aliases. */
  names: string[];
  /** Position codes in the owning dataset's quantisation (for 'd': a = index into the deep-sky list). */
  a: number;
  b: number;
  c: number;
  /** Dataset id: 'stars', 'galaxies', 'sdss', 'quasars' or 'dso'. */
  ds: string;
  extra?: Record<string, string | number>;
}

type Row = [NameKind, string, number, number, number, string, Record<string, string | number>?];

export interface SearchHit {
  record: NameRecord;
  /** The alias that matched (may differ from the display name). */
  matched: string;
  score: number;
}

/** Lower-case, strip accents and punctuation: "Boötis" → "bootis", "M 31" → "m 31". */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9α-ω+\-.* ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class NamesTable {
  private readonly chunkStart: number[] = [];
  private readonly records: Array<NameRecord[] | null>;
  private readonly normalized: Array<string[] | null>;
  private readonly loading = new Map<number, Promise<void>>();

  constructor(
    private readonly chunks: Array<{ file: string; count: number }>,
    private readonly fetchBytes: (file: string) => Promise<Uint8Array>,
    private readonly pool: WorkerPool,
  ) {
    let start = 0;
    for (const c of chunks) {
      this.chunkStart.push(start);
      start += c.count;
    }
    this.records = chunks.map(() => null);
    this.normalized = chunks.map(() => null);
  }

  private chunkOf(id: number): number {
    for (let i = this.chunkStart.length - 1; i >= 0; i--) if (id >= this.chunkStart[i]!) return i;
    return 0;
  }

  /** Load one chunk (idempotent). */
  loadChunk(i: number): Promise<void> {
    if (this.records[i]) return Promise.resolve();
    let p = this.loading.get(i);
    if (!p) {
      p = (async () => {
        const bytes = await this.fetchBytes(this.chunks[i]!.file);
        const rows = (await this.pool.run('json', { bytes }, { priority: 2, transfer: [bytes.buffer as ArrayBuffer] }).promise) as Row[];
        const start = this.chunkStart[i]!;
        this.records[i] = rows.map((r, k) => ({ id: start + k, kind: r[0], names: r[1].split('|'), a: r[2], b: r[3], c: r[4], ds: r[5], extra: r[6] }));
        this.normalized[i] = rows.map((r) => r[1].split('|').map(normalizeName).join(' | '));
      })().finally(() => this.loading.delete(i));
      this.loading.set(i, p);
    }
    return p;
  }

  /** Record for a names-table id if its chunk is already in memory. */
  peek(id: number): NameRecord | undefined {
    const ci = this.chunkOf(id);
    return this.records[ci]?.[id - this.chunkStart[ci]!];
  }

  /** Record for a names-table id, loading its chunk if necessary. */
  async get(id: number): Promise<NameRecord | undefined> {
    const ci = this.chunkOf(id);
    await this.loadChunk(ci);
    return this.records[ci]?.[id - this.chunkStart[ci]!];
  }

  /** All records of the first (famous) chunk, if loaded — used for labels. */
  famous(): NameRecord[] {
    return this.records[0] ?? [];
  }

  /**
   * Search every name. Loads the remaining chunks on first use; results from
   * already-loaded chunks are returned immediately via `onPartial`.
   */
  async search(query: string, limit = 30, onPartial?: (hits: SearchHit[]) => void): Promise<SearchHit[]> {
    const q = normalizeName(query);
    if (q.length < 1) return [];
    const run = (): SearchHit[] => this.scan(q, limit);
    const missing = this.records.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
    if (missing.length > 0) {
      onPartial?.(run());
      await Promise.all(missing.map((i) => this.loadChunk(i).catch(() => undefined)));
    }
    return run();
  }

  private scan(q: string, limit: number): SearchHit[] {
    const tokens = q.split(' ');
    const hits: SearchHit[] = [];
    // Collect a few more than needed, then keep the best.
    const cap = limit * 6;
    for (let ci = 0; ci < this.records.length; ci++) {
      const recs = this.records[ci];
      const norm = this.normalized[ci];
      if (!recs || !norm) continue;
      for (let k = 0; k < recs.length; k++) {
        const hay = norm[k]!;
        if (!hay.includes(tokens[0]!)) continue;
        const aliases = hay.split(' | ');
        let best = 99;
        let bestAlias = 0;
        for (let a = 0; a < aliases.length; a++) {
          const name = aliases[a]!;
          let score = 99;
          if (name === q) score = 0;
          else if (name.startsWith(q)) score = 1 + Math.min(0.9, (name.length - q.length) / 40);
          else {
            // Every query token must start some word of the name ("alp cen" → "alpha centauri").
            const words = name.split(' ');
            if (tokens.every((t) => words.some((w) => w.startsWith(t)))) score = 2 + Math.min(0.9, name.length / 60);
            else if (name.includes(q)) score = 3;
          }
          if (score < best) {
            best = score;
            bestAlias = a;
          }
        }
        if (best < 99) {
          // Earlier chunks hold more famous objects: break ties in their favour.
          hits.push({ record: recs[k]!, matched: recs[k]!.names[bestAlias] ?? recs[k]!.names[0]!, score: best + ci * 0.08 + k * 1e-7 });
          if (hits.length >= cap && best >= 2) break;
        }
      }
    }
    hits.sort((x, y) => x.score - y.score);
    return hits.slice(0, limit);
  }
}
