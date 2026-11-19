/**
 * Names table builder.
 *
 * Every real object that has a name or catalogue designation gets one entry:
 * its searchable names plus the same quantised position codes that are stored
 * in its tile, so the app can fly straight to it and then recognise the
 * streamed object as "the same one".
 *
 * Entries are ordered by fame: chunk 0 (proper names, Bayer letters, Messier
 * objects, planet hosts …) ships with the first-launch download; the long
 * tail of HIP/HD/NGC/IC designations loads lazily when search is first used.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zlibSync } from 'fflate';
import { OUT_DIR } from './http';

/** Kind codes: s = star, g = galaxy, q = quasar, d = deep-sky object (index into dso list). */
export type NameKind = 's' | 'g' | 'q' | 'd';

export interface NameEntry {
  kind: NameKind;
  /** Display name first, then aliases. */
  names: string[];
  /** Position codes in the owning dataset's quantisation (ra, dec, distance-or-redshift). */
  a: number;
  b: number;
  c: number;
  /** 0 = famous, 1 = notable, 2 = long tail. */
  priority: number;
  /** Small extras shown on info cards (e.g. catalogued spectral type). */
  extra?: Record<string, string | number>;
  /** Dataset id the object lives in ('stars', 'galaxies', 'sdss', 'quasars', 'dso'). */
  ds: string;
}

/** Serialised row: [kind, "name|alias|…", a, b, c, ds, extra?]. */
export type NameRow = [NameKind, string, number, number, number, string, Record<string, string | number>?];

export class NameRegistry {
  private readonly entries: NameEntry[] = [];
  private finalIds: Int32Array | null = null;

  /** Register an entry; returns a temporary handle (use `finalId` after `finalize`). */
  add(entry: NameEntry): number {
    if (this.finalIds) throw new Error('NameRegistry already finalised');
    entry.names = [...new Set(entry.names.map((n) => n.trim()).filter(Boolean))];
    if (entry.names.length === 0) throw new Error('name entry without names');
    this.entries.push(entry);
    return this.entries.length - 1;
  }

  get(handle: number): NameEntry {
    return this.entries[handle]!;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Assign final ids: sorted by priority, then by registration order (deterministic). */
  finalize(): void {
    const order = this.entries.map((_, i) => i).sort((x, y) => this.entries[x]!.priority - this.entries[y]!.priority || x - y);
    this.finalIds = new Int32Array(this.entries.length);
    order.forEach((handle, id) => {
      this.finalIds![handle] = id;
    });
  }

  finalId(handle: number): number {
    if (!this.finalIds) throw new Error('NameRegistry not finalised');
    return handle < 0 ? -1 : this.finalIds[handle]!;
  }

  /** Write the compressed chunks and return their manifest entries. */
  write(chunkSize = 50_000): Array<{ file: string; count: number; bytes: number }> {
    if (!this.finalIds) this.finalize();
    const sorted = new Array<NameEntry>(this.entries.length);
    this.entries.forEach((e, handle) => {
      sorted[this.finalIds![handle]!] = e;
    });
    const firstCount = sorted.filter((e) => e.priority <= 1).length;
    const bounds = [0, firstCount];
    while (bounds[bounds.length - 1]! < sorted.length) bounds.push(Math.min(sorted.length, bounds[bounds.length - 1]! + chunkSize));
    mkdirSync(join(OUT_DIR, 'names'), { recursive: true });
    const out: Array<{ file: string; count: number; bytes: number }> = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const rows: NameRow[] = sorted.slice(bounds[i], bounds[i + 1]).map((e) => {
        const row: NameRow = [e.kind, e.names.join('|'), e.a, e.b, e.c, e.ds];
        if (e.extra && Object.keys(e.extra).length) row.push(e.extra);
        return row;
      });
      const bytes = zlibSync(new TextEncoder().encode(JSON.stringify(rows)), { level: 9, mem: 12 });
      const file = `names/n${i}.bin`;
      writeFileSync(join(OUT_DIR, file), bytes);
      out.push({ file, count: rows.length, bytes: bytes.byteLength });
    }
    console.info(`  ✓ names: ${sorted.length.toLocaleString('en-US')} entries in ${out.length} chunks (${(out.reduce((s, c) => s + c.bytes, 0) / 1e6).toFixed(2)} MB; first-launch chunk ${firstCount})`);
    return out;
  }
}

/** Greek-letter abbreviations used by the HD–Bayer cross index (IV/27A) and the IAU name list. */
export const GREEK: Record<string, [string, string]> = {
  alf: ['α', 'Alpha'], bet: ['β', 'Beta'], gam: ['γ', 'Gamma'], del: ['δ', 'Delta'], eps: ['ε', 'Epsilon'], zet: ['ζ', 'Zeta'],
  eta: ['η', 'Eta'], the: ['θ', 'Theta'], tet: ['θ', 'Theta'], iot: ['ι', 'Iota'], kap: ['κ', 'Kappa'], lam: ['λ', 'Lambda'],
  mu: ['μ', 'Mu'], nu: ['ν', 'Nu'], ksi: ['ξ', 'Xi'], xi: ['ξ', 'Xi'], omi: ['ο', 'Omicron'], pi: ['π', 'Pi'], rho: ['ρ', 'Rho'],
  sig: ['σ', 'Sigma'], tau: ['τ', 'Tau'], ups: ['υ', 'Upsilon'], phi: ['φ', 'Phi'], chi: ['χ', 'Chi'], psi: ['ψ', 'Psi'], ome: ['ω', 'Omega'],
};

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/** IAU constellation abbreviations → [name, genitive]. */
export const CONSTELLATIONS: Record<string, [string, string]> = {
  And: ['Andromeda', 'Andromedae'], Ant: ['Antlia', 'Antliae'], Aps: ['Apus', 'Apodis'], Aqr: ['Aquarius', 'Aquarii'], Aql: ['Aquila', 'Aquilae'],
  Ara: ['Ara', 'Arae'], Ari: ['Aries', 'Arietis'], Aur: ['Auriga', 'Aurigae'], Boo: ['Boötes', 'Boötis'], Cae: ['Caelum', 'Caeli'],
  Cam: ['Camelopardalis', 'Camelopardalis'], Cnc: ['Cancer', 'Cancri'], CVn: ['Canes Venatici', 'Canum Venaticorum'], CMa: ['Canis Major', 'Canis Majoris'],
  CMi: ['Canis Minor', 'Canis Minoris'], Cap: ['Capricornus', 'Capricorni'], Car: ['Carina', 'Carinae'], Cas: ['Cassiopeia', 'Cassiopeiae'],
  Cen: ['Centaurus', 'Centauri'], Cep: ['Cepheus', 'Cephei'], Cet: ['Cetus', 'Ceti'], Cha: ['Chamaeleon', 'Chamaeleontis'], Cir: ['Circinus', 'Circini'],
  Col: ['Columba', 'Columbae'], Com: ['Coma Berenices', 'Comae Berenices'], CrA: ['Corona Australis', 'Coronae Australis'],
  CrB: ['Corona Borealis', 'Coronae Borealis'], Crv: ['Corvus', 'Corvi'], Crt: ['Crater', 'Crateris'], Cru: ['Crux', 'Crucis'], Cyg: ['Cygnus', 'Cygni'],
  Del: ['Delphinus', 'Delphini'], Dor: ['Dorado', 'Doradus'], Dra: ['Draco', 'Draconis'], Equ: ['Equuleus', 'Equulei'], Eri: ['Eridanus', 'Eridani'],
  For: ['Fornax', 'Fornacis'], Gem: ['Gemini', 'Geminorum'], Gru: ['Grus', 'Gruis'], Her: ['Hercules', 'Herculis'], Hor: ['Horologium', 'Horologii'],
  Hya: ['Hydra', 'Hydrae'], Hyi: ['Hydrus', 'Hydri'], Ind: ['Indus', 'Indi'], Lac: ['Lacerta', 'Lacertae'], Leo: ['Leo', 'Leonis'],
  LMi: ['Leo Minor', 'Leonis Minoris'], Lep: ['Lepus', 'Leporis'], Lib: ['Libra', 'Librae'], Lup: ['Lupus', 'Lupi'], Lyn: ['Lynx', 'Lyncis'],
  Lyr: ['Lyra', 'Lyrae'], Men: ['Mensa', 'Mensae'], Mic: ['Microscopium', 'Microscopii'], Mon: ['Monoceros', 'Monocerotis'], Mus: ['Musca', 'Muscae'],
  Nor: ['Norma', 'Normae'], Oct: ['Octans', 'Octantis'], Oph: ['Ophiuchus', 'Ophiuchi'], Ori: ['Orion', 'Orionis'], Pav: ['Pavo', 'Pavonis'],
  Peg: ['Pegasus', 'Pegasi'], Per: ['Perseus', 'Persei'], Phe: ['Phoenix', 'Phoenicis'], Pic: ['Pictor', 'Pictoris'], Psc: ['Pisces', 'Piscium'],
  PsA: ['Piscis Austrinus', 'Piscis Austrini'], Pup: ['Puppis', 'Puppis'], Pyx: ['Pyxis', 'Pyxidis'], Ret: ['Reticulum', 'Reticuli'],
  Sge: ['Sagitta', 'Sagittae'], Sgr: ['Sagittarius', 'Sagittarii'], Sco: ['Scorpius', 'Scorpii'], Scl: ['Sculptor', 'Sculptoris'], Sct: ['Scutum', 'Scuti'],
  Ser: ['Serpens', 'Serpentis'], Sex: ['Sextans', 'Sextantis'], Tau: ['Taurus', 'Tauri'], Tel: ['Telescopium', 'Telescopii'],
  Tri: ['Triangulum', 'Trianguli'], TrA: ['Triangulum Australe', 'Trianguli Australis'], Tuc: ['Tucana', 'Tucanae'], UMa: ['Ursa Major', 'Ursae Majoris'],
  UMi: ['Ursa Minor', 'Ursae Minoris'], Vel: ['Vela', 'Velorum'], Vir: ['Virgo', 'Virginis'], Vol: ['Volans', 'Volantis'], Vul: ['Vulpecula', 'Vulpeculae'],
};

/**
 * Expand a Bayer code such as "alf", "kap01", "pi.03" with a constellation
 * abbreviation into display + search forms:
 *   ["α Canis Majoris", "Alpha Canis Majoris", "α CMa", "alf CMa"].
 */
export function bayerNames(code: string, cst: string): string[] {
  const m = /^([a-z]+)\.?\s*(\d+)?$/i.exec(code.trim());
  const con = CONSTELLATIONS[cst];
  if (!m || !con) return [];
  const greek = GREEK[m[1]!.toLowerCase()];
  const n = m[2] ? Number(m[2]) : 0;
  if (!greek) {
    // Latin-letter Bayer designations (e.g. "b", "A") are rare; keep them plain.
    return [`${m[1]}${n || ''} ${con[1]}`, `${m[1]}${n || ''} ${cst}`];
  }
  const sup = n ? String(n).split('').map((d) => SUPERSCRIPT[Number(d)]).join('') : '';
  return [`${greek[0]}${sup} ${con[1]}`, `${greek[1]}${n ? ` ${n}` : ''} ${con[1]}`, `${greek[0]}${sup} ${cst}`, `${m[1]}${n ? String(n).padStart(2, '0') : ''} ${cst}`];
}

export function flamsteedNames(fl: string, cst: string): string[] {
  const con = CONSTELLATIONS[cst];
  if (!fl.trim() || !con) return [];
  return [`${fl.trim()} ${con[1]}`, `${fl.trim()} ${cst}`];
}
