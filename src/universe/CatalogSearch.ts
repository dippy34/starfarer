/**
 * Search over the catalogue of real objects (public/data/catalog, pipeline/build_catalog.py):
 * ~200,000 stars, white and brown dwarfs, pulsars, TESS planet hosts, X-ray binaries, quasars,
 * galaxies, star clusters and nebulae, under ~357,000 names and designations.
 *
 * The index is a list of names sorted by their normalised key (`normKey`, identical to the
 * pipeline's `norm`), split into files of 4,000 lines whose first keys are in the manifest. A
 * query loads only the one to three files that can hold keys starting with it, so the first
 * results arrive after fetching ~60 kB. Records (positions and properties) are in per-category
 * files of 2,000 rows, fetched for the results that are shown.
 *
 * No DOM: usable in a worker and in tests (pass a fetch replacement).
 */

const GREEK: Record<string, string> = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota',
  'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'sigma',
  'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
};

/** Search key of a name: lower case, Greek letters spelled out, no accents, Gliese/Gl/GJ and Messier unified, only a-z0-9. */
export function normKey(s: string): string {
  let t = '';
  for (const c of s.toLowerCase()) t += GREEK[c] ?? c;
  t = t.normalize('NFKD').replace(/\p{M}/gu, '');
  t = t.replace(/^(gliese|gl|gj)[\s_.-]*(?=\d)/, 'gj').replace(/^messier[\s_.-]*(?=\d)/, 'm');
  return t.replace(/[^a-z0-9]/g, '');
}

/**
 * The constellation genitives people type ("Ceti", "Carinae"), and the catalogue's own abbreviation
 * for each: the standard IAU three letters, which is how the catalogue writes these names ("τ Cet",
 * "α1 Cen", "η Car"). Only a word that is a genitive of one constellation is here; where the same
 * word ends two constellations' genitives ("Ursae Majoris", "Ursae Minoris"), or where only the
 * whole phrase is the genitive ("Canum Venaticorum"), it is in `GENITIVE_PHRASES` instead.
 */
const GENITIVES: Record<string, string> = {
  andromedae: 'and', antliae: 'ant', apodis: 'aps', aquarii: 'aqr', aquilae: 'aql', arae: 'ara', arietis: 'ari',
  aurigae: 'aur', berenices: 'com', bootis: 'boo', borealis: 'crb', caeli: 'cae', camelopardalis: 'cam', cancri: 'cnc',
  capricorni: 'cap', carinae: 'car', cassiopeiae: 'cas', centauri: 'cen', cephei: 'cep', ceti: 'cet',
  chamaeleontis: 'cha', circini: 'cir', columbae: 'col', corvi: 'crv', crateris: 'crt', crucis: 'cru', cygni: 'cyg',
  delphini: 'del', doradus: 'dor', draconis: 'dra', equulei: 'equ', eridani: 'eri', fornacis: 'for', geminorum: 'gem',
  gruis: 'gru', herculis: 'her', horologii: 'hor', hydrae: 'hya', hydri: 'hyi', indi: 'ind', lacertae: 'lac',
  leonis: 'leo', leporis: 'lep', librae: 'lib', lupi: 'lup', lyncis: 'lyn', lyrae: 'lyr', majoris: 'cma', mensae: 'men',
  microscopii: 'mic', monocerotis: 'mon', muscae: 'mus', normae: 'nor', octantis: 'oct', ophiuchi: 'oph', orionis: 'ori',
  pavonis: 'pav', pegasi: 'peg', persei: 'per', phoenicis: 'phe', pictoris: 'pic', piscium: 'psc', austrini: 'psa',
  puppis: 'pup', pyxidis: 'pyx', reticuli: 'ret', sagittae: 'sge', sagittarii: 'sgr', scorpii: 'sco', sculptoris: 'scl',
  scuti: 'sct', serpentis: 'ser', sextantis: 'sex', tauri: 'tau', telescopii: 'tel', trianguli: 'tri', tucanae: 'tuc',
  velorum: 'vel', venaticorum: 'cvn', virginis: 'vir', volantis: 'vol', vulpeculae: 'vul',
};

/** Genitives a word alone cannot name: "minoris" ends both Canis Minoris and Leonis Minoris, "australis" three, and so on. */
const GENITIVE_PHRASES: Record<string, string> = {
  'canes venatici': 'cvn', 'canum venaticorum': 'cvn', 'canis major': 'cma', 'canis minor': 'cmi', 'canis majoris': 'cma', 'canis minoris': 'cmi',
  'coma berenices': 'com', 'comae berenices': 'com', 'corona australis': 'cra', 'coronae australis': 'cra', 'corona borealis': 'crb', 'coronae borealis': 'crb', 'leo minor': 'lmi',
  'leonis minoris': 'lmi', 'piscis austrinus': 'psa', 'piscis austrini': 'psa', 'triangulum australe': 'tra', 'trianguli australis': 'tra',
  'ursa major': 'uma', 'ursa minor': 'umi', 'ursae majoris': 'uma', 'ursae minoris': 'umi',
};

/**
 * The keys a typed query answers to: its own key, and the same with every constellation genitive
 * replaced by the catalogue's abbreviation ("Tau Ceti" also as "tau cet", "Tau Ceti g" as
 * "tau cet g", since the catalogue writes "τ Cet"). The plain key is first: it is the one to
 * search when the words are names, not constellations.
 */
export function queryKeys(q: string): string[] {
  const k = normKey(q);
  const words = q.trim().split(/[\s_-]+/);
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    const w = words[i].toLowerCase();
    const next = i + 1 < words.length ? `${w} ${words[i + 1].toLowerCase()}` : '';
    const ab = GENITIVE_PHRASES[next] ?? GENITIVES[normKey(w)];
    if (ab) { out.push(ab); i += GENITIVE_PHRASES[next] ? 2 : 1; }
    else { out.push(w); i++; }
  }
  const kv = normKey(out.join(' '));
  return kv.length >= 2 && kv !== k ? [k, kv] : [k];
}

/**
 * How a name matches a typed query by normalised key: 0 exact ("η Car" against the keys of
 * "eta carinae"), else the typed key (of 3 letters or more) starting the name's key, else -1.
 */
export function normScore(name: string, keys: string[]): number {
  return scoreKey(normKey(name), keys);
}

/** The match of an already-normalised name key (`scoreKey(normKey(name), keys)`: `normScore`).
 *  Separate so a caller that keeps the keys of many names (App.searchItems, Systems.search) pays
 *  for `normKey` once per name, not once per keystroke. */
export function scoreKey(nk: string, keys: string[]): number {
  if (nk.length < 2) return -1;
  let best = -1;
  for (const k of keys) {
    if (nk === k) return 0;
    if (k.length >= 3 && nk.startsWith(k)) { const s = 1 + nk.length / 100; if (best < 0 || s < best) best = s; }
  }
  return best;
}

/**
 * What people type that the data answers to under other names. Every target is a real name in the
 * data (an app object, a catalogue designation); nothing here invents an object. Keyed by the
 * typed name's key: `App.searchItems` finds an alias hit and scores the real names as typed.
 */
export const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  sol: ['Sun'],                                          // "Sol", the Sun's Latin name: Solaris is another star
  iss: ['International Space Station'],
  alphacentauri: ['Rigil Kentaurus', 'Toliman'],         // α1 and α2 Cen, the catalogue's own names
  alphacen: ['Rigil Kentaurus', 'Toliman'],
};

export type CatCode = 's' | 'w' | 'd' | 'p' | 't' | 'x' | 'q' | 'g' | 'c' | 'n';

export interface CatalogCategory {
  name: string;
  label: string;
  count: number;
  chunk: number;
  files: number;
  fields: string[];
  credit: string;
  /** rows to show when browsing (the most notable first) */
  featured: number[];
}

export interface CatalogManifest {
  version: number;
  objects: number;
  keys: number;
  chunk: number;
  indexChunks: string[];
  distFlags: Record<string, string>;
  categories: Record<CatCode, CatalogCategory>;
}

export interface CatalogHit {
  /** the name that matched */
  label: string;
  code: CatCode;
  row: number;
  /** 0 = most notable .. 9 */
  rank: number;
  exact: boolean;
}

/** A record: field name -> text (fields per category, see the manifest). */
export type CatalogRecord = Record<string, string>;

type Fetch = (url: string) => Promise<{ ok: boolean; text(): Promise<string>; json(): Promise<unknown> }>;

interface IndexChunk { keys: string[]; labels: string[]; codes: CatCode[]; rows: Int32Array; ranks: Uint8Array }

const lowerBound = (a: string[], k: string): number => {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < k) lo = m + 1; else hi = m; }
  return lo;
};

export class CatalogSearch {
  manifest: CatalogManifest | null = null;
  private loading: Promise<CatalogManifest | null> | null = null;
  private idx = new Map<number, Promise<IndexChunk>>();
  private rec = new Map<string, Promise<CatalogRecord[]>>();
  private recReady = new Map<string, CatalogRecord[]>();
  private fetchFn: Fetch;

  constructor(readonly base: string, fetchFn?: Fetch) {
    this.fetchFn = fetchFn ?? ((u) => fetch(u));
  }

  load(): Promise<CatalogManifest | null> {
    this.loading ??= this.fetchFn(`${this.base}/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<CatalogManifest>) : null))
      .then((m) => (this.manifest = m))
      .catch(() => null);
    return this.loading;
  }

  private chunk(i: number): Promise<IndexChunk> {
    let p = this.idx.get(i);
    if (!p) {
      p = this.fetchFn(`${this.base}/idx/${i}.txt`).then((r) => {
        if (!r.ok) throw new Error(`catalog index ${i}`);
        return r.text();
      }).then((t) => {
        const lines = t.split('\n').filter((l) => l);
        const c: IndexChunk = { keys: [], labels: [], codes: [], rows: new Int32Array(lines.length), ranks: new Uint8Array(lines.length) };
        lines.forEach((l, j) => {
          const f = l.split('\t');
          c.labels.push(f[0]);
          c.keys.push(normKey(f[0]));
          c.codes.push(f[1] as CatCode);
          c.rows[j] = parseInt(f[2], 36);
          c.ranks[j] = Number(f[3]) || 0;
        });
        return c;
      });
      p.catch(() => this.idx.delete(i));
      this.idx.set(i, p);
    }
    return p;
  }

  /**
   * The chunks whose key range can hold keys with prefix `k` scanned into `hits` (one hit per
   * object; `exact` true when the stored key is the prefix itself). `seen` keeps hits of an
   * earlier key of the same query out.
   */
  private async scan(m: CatalogManifest, k: string, hits: CatalogHit[], seen: Set<string>): Promise<void> {
    const first = m.indexChunks;
    // (equal keys may straddle a chunk boundary, so start one chunk before the first >= k)
    let i = Math.max(0, lowerBound(first, k) - 1);
    for (let n = 0; n < 3 && i < first.length; n++, i++) {
      if (n > 0 && !first[i].startsWith(k) && first[i] > k) break;
      const c = await this.chunk(i);
      for (let j = lowerBound(c.keys, k); j < c.keys.length && c.keys[j].startsWith(k); j++) {
        const id = `${c.codes[j]}:${c.rows[j]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        hits.push({ label: c.labels[j], code: c.codes[j], row: c.rows[j], rank: c.ranks[j], exact: c.keys[j] === k });
        if (hits.length > 600) return;
      }
      if (hits.length > 600) return;
    }
  }

  /**
   * Objects with a name starting with `q` (normalised), best first: exact names, then the more
   * notable, then shorter names. One hit per object. A query typed with a constellation genitive
   * ("Tau Ceti") is also looked up as the catalogue writes it ("τ Cet"): queryKeys.
   */
  async query(q: string, limit = 14): Promise<CatalogHit[]> {
    const m = await this.load();
    if (!m) return [];
    const hits: CatalogHit[] = [];
    const seen = new Set<string>();
    for (const k of queryKeys(q)) {
      if (k.length < 2) continue;
      await this.scan(m, k, hits, seen);
    }
    hits.sort((a, b) => Number(b.exact) - Number(a.exact) || a.rank - b.rank || a.label.length - b.label.length || (a.label < b.label ? -1 : 1));
    return hits.slice(0, limit);
  }

  private recKey(code: CatCode, file: number): string { return `${code}/${file}`; }

  /** The record of a row (null until its file has loaded: see `ensure`). */
  record(code: CatCode, row: number): CatalogRecord | null {
    const c = this.manifest?.categories[code];
    if (!c) return null;
    return this.recReady.get(this.recKey(code, Math.floor(row / c.chunk)))?.[row % c.chunk] ?? null;
  }

  /** Load the records of these rows. */
  async ensure(items: { code: CatCode; row: number }[]): Promise<void> {
    const m = await this.load();
    if (!m) return;
    const files = new Set<string>();
    for (const it of items) {
      const c = m.categories[it.code];
      if (c) files.add(this.recKey(it.code, Math.floor(it.row / c.chunk)));
    }
    await Promise.all([...files].map((f) => {
      let p = this.rec.get(f);
      if (!p) {
        const [code] = f.split('/') as [CatCode];
        const fields = m.categories[code].fields;
        p = this.fetchFn(`${this.base}/rec/${f}.tsv`).then((r) => {
          if (!r.ok) throw new Error(`catalog records ${f}`);
          return r.text();
        }).then((t) => t.split('\n').filter((l) => l).map((l) => {
          const v = l.split('\t');
          const o: CatalogRecord = {};
          fields.forEach((k, i) => { o[k] = v[i] ?? ''; });
          return o;
        }));
        p.then((rows) => this.recReady.set(f, rows)).catch(() => this.rec.delete(f));
        this.rec.set(f, p);
      }
      return p.catch(() => undefined);
    }));
  }
}
