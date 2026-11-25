import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Systems, wellStudied } from '../src/app/Systems';
import { CatalogSearch, normKey, normScore, queryKeys, SEARCH_ALIASES } from '../src/universe/CatalogSearch';
import { CatalogStar } from '../src/universe/Stars';

const ROOT = join(__dirname, '..', 'public', 'data', 'catalog');
const has = existsSync(join(ROOT, 'manifest.json'));
let fetches = 0;
const diskFetch = async (url: string) => {
  fetches++;
  const p = join(ROOT, url.replace(/^disk:\/\/catalog\//, ''));
  const ok = existsSync(p);
  const t = ok ? readFileSync(p, 'utf8') : '';
  return { ok, text: async () => t, json: async () => JSON.parse(t) as unknown };
};

describe('what people type', () => {
  it('also offers keys with a constellation genitive as its abbreviation', () => {
    // the plain key stays, plus one variant per genitive word
    expect(queryKeys('Tau Ceti')).toContain('taucet');
    expect(queryKeys('Tau Ceti')).toContain('tauceti');
    expect(queryKeys('Eta Carinae')).toContain('etacar');
    expect(queryKeys('Eta Carinae')).toContain('etacarinae');
    expect(queryKeys('Alpha Centauri')).toContain('alphacen');
    expect(queryKeys('Alpha Centauri')).toContain('alphacentauri');
    expect(queryKeys('Omega Centauri')).toContain('omegacentauri');
    expect(queryKeys('Omega Centauri')).toContain('omegacen');
    expect(queryKeys('Tau Ceti g')).toContain('taucetg');
    // digits and one-letter words get no variant
    expect(queryKeys('HD 209458')).toEqual(['hd209458']);
    expect(queryKeys('Vega b')).toEqual(['vegab']);
  });

  it('scores an exact name 0, a prefix close, a miss -1', () => {
    expect(normScore('τ Cet', queryKeys('Tau Ceti'))).toBe(0);
    expect(normScore('η Car', queryKeys('Eta Carinae'))).toBe(0);
    expect(normScore('HD 209458', queryKeys('HD 209458'))).toBe(0);
    expect(normScore('Vega', queryKeys('Vega b'))).toBe(-1);
  });

  it('maps what people type to real names of the app', () => {
    expect(SEARCH_ALIASES[normKey('Sol')]).toEqual(['Sun']);
    expect(SEARCH_ALIASES[normKey('ISS')]).toEqual(['International Space Station']);
    expect(SEARCH_ALIASES[normKey('Alpha Centauri')]).toEqual(['Rigil Kentaurus', 'Toliman']);
    // the abbreviated form lands on the same stars
    expect(SEARCH_ALIASES[normKey('Alpha Cen')]).toEqual(['Rigil Kentaurus', 'Toliman']);
  });
});

describe('the 88 constellations', () => {
  // the IAU genitive and three-letter abbreviation of each: what a person types against what the catalogue writes
  const IAU: [string, string][] = [['Andromedae','and'],['Antliae','ant'],['Apodis','aps'],['Aquarii','aqr'],['Aquilae','aql'],['Arae','ara'],['Arietis','ari'],['Aurigae','aur'],['Bootis','boo'],['Caeli','cae'],['Camelopardalis','cam'],['Cancri','cnc'],['Canum Venaticorum','cvn'],['Canis Majoris','cma'],['Canis Minoris','cmi'],['Capricorni','cap'],['Carinae','car'],['Cassiopeiae','cas'],['Centauri','cen'],['Cephei','cep'],['Ceti','cet'],['Chamaeleontis','cha'],['Circini','cir'],['Columbae','col'],['Comae Berenices','com'],['Coronae Australis','cra'],['Coronae Borealis','crb'],['Corvi','crv'],['Crateris','crt'],['Crucis','cru'],['Cygni','cyg'],['Delphini','del'],['Doradus','dor'],['Draconis','dra'],['Equulei','equ'],['Eridani','eri'],['Fornacis','for'],['Geminorum','gem'],['Gruis','gru'],['Herculis','her'],['Horologii','hor'],['Hydrae','hya'],['Hydri','hyi'],['Indi','ind'],['Lacertae','lac'],['Leonis','leo'],['Leonis Minoris','lmi'],['Leporis','lep'],['Librae','lib'],['Lupi','lup'],['Lyncis','lyn'],['Lyrae','lyr'],['Mensae','men'],['Microscopii','mic'],['Monocerotis','mon'],['Muscae','mus'],['Normae','nor'],['Octantis','oct'],['Ophiuchi','oph'],['Orionis','ori'],['Pavonis','pav'],['Pegasi','peg'],['Persei','per'],['Phoenicis','phe'],['Pictoris','pic'],['Piscium','psc'],['Piscis Austrini','psa'],['Puppis','pup'],['Pyxidis','pyx'],['Reticuli','ret'],['Sagittae','sge'],['Sagittarii','sgr'],['Scorpii','sco'],['Sculptoris','scl'],['Scuti','sct'],['Serpentis','ser'],['Sextantis','sex'],['Tauri','tau'],['Telescopii','tel'],['Trianguli','tri'],['Trianguli Australis','tra'],['Tucanae','tuc'],['Ursae Majoris','uma'],['Ursae Minoris','umi'],['Velorum','vel'],['Virginis','vir'],['Volantis','vol'],['Vulpeculae','vul']];
  it('has every genitive turn into its abbreviation', () => {
    expect(IAU.length).toBe(88);
    for (const [g, ab] of IAU) expect(queryKeys('Alpha ' + g), g).toContain('alpha' + ab);
  });
});

// reads the real catalogue on disk: only when it has been built
describe.skipIf(!has)('the catalogue', { timeout: 30000 }, () => {
  const search = new CatalogSearch('disk://catalog', diskFetch);

  it('finds a star typed with its constellation genitive, and by designation', async () => {
    const tau = (await search.query('Tau Ceti', 5))[0];
    expect(tau.label).toBe('τ Cet');
    expect(tau.exact).toBe(true);
    const hd = (await search.query('HD 10700', 5))[0];
    expect(hd.label).toBe('HD 10700');
    expect(hd.exact).toBe(true);
  });

  it('a query fetches only a few index files', async () => {
    const s = new CatalogSearch('disk://catalog', diskFetch);
    await s.load();
    fetches = 0;
    await s.query('HD 10700', 5);
    expect(fetches).toBeLessThanOrEqual(3);
  });
});

// Systems fetches the archive itself: read the real file from public/data instead
const dataFetch = async (url: string) => {
  const p = join(process.cwd(), 'public/data', url.replace(/^disk:\/\/data\//, ''));
  const t = readFileSync(p, 'utf8');
  return { ok: true, text: async () => t, json: async () => JSON.parse(t) as unknown };
};
globalThis.fetch = dataFetch as unknown as typeof fetch;

// like App.searchItems: exact, then prefix, then substring
const scoreFor = (q: string) => {
  const n = q.toLowerCase();
  return (name: string): number => {
    const l = name.toLowerCase();
    if (l === n) return 0;
    if (l.startsWith(n)) return 1 + l.length / 100;
    if (l.includes(n)) return 2 + l.length / 100;
    return -1;
  };
};

describe('the exoplanet archive', () => {
  const systems = new Systems();
  beforeAll(async () => {
    await systems.load('disk://data');
  });

  it('finds the archive host of a star typed the usual way', () => {
    expect(systems.search('Tau Ceti', scoreFor('Tau Ceti')).map((h) => h.label)).toContain('tau Cet');
  });

  it('has nothing for a made-up name', () => {
    expect(systems.search('no such system zzz', scoreFor('no such system zzz'))).toEqual([]);
  });

  it('answers "<star> <letter>" with the generated planet, unless the star has a real system or is well studied', () => {
    // Gl 9848, as the catalogue has it: 56 pc away, magnitude 11 from Earth, no planet found: the engine makes some up,
    // the first is "Gl 9848 b", and typing its name finds that very planet
    const named = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'data', 'stars', 'named.json'), 'utf8'));
    const L: string[] = named.layout;
    const row = named.stars.find((r: unknown[]) => (r[L.indexOf('names')] as string[]).includes('Gl 9848'));
    const at = (k: string) => row[L.indexOf(k)];
    const gl = new CatalogStar(`star:athyg:${at('node')}:${at('slot')}`, new Vector3(at('x_pc'), at('y_pc'), at('z_pc')), at('absMag'), at('teff'), at('spect'), at('names'), null);
    const planets = systems.of(gl)?.planets ?? [];
    expect(planets.length).toBeGreaterThan(0);
    expect(planets[0].name).toBe('Gl 9848 b');
    expect(planets[0].system.real).toBe(false);
    expect(systems.searchGenerated('Gl 9848 b', gl)).toBe(planets[0]);
    // Vega, 7.7 pc away and among the brightest stars of the sky: no planet found, so none made up either
    const vega = new CatalogStar('star:test:vega', new Vector3(7.68, 0, 0), 0.58, 9600, 'A0V', ['Vega'], null);
    expect(systems.of(vega)).toBeNull();
    expect(systems.searchGenerated('Vega b', vega)).toBeNull();
    // the archive has real candidates for tau Cet g, so nothing is generated
    const tauCet = new CatalogStar('star:test:taucet', new Vector3(1, 0, 0), 5, 5400, 'G8V', ['tau Cet'], null);
    expect(systems.searchGenerated('tau Cet g', tauCet)).toBeNull();
  });
});

describe('which stars are well studied (no made-up planets for them)', () => {
  it('those seen by eye from Earth, and those within 10 parsecs', () => {
    expect(wellStudied({ posPc: new Vector3(7.68, 0, 0), absMag: 0.58 })).toBe(true);    // Vega: near and bright
    expect(wellStudied({ posPc: new Vector3(0, 168, 0), absMag: -5.85 })).toBe(true);    // Betelgeuse: far, but bright
    expect(wellStudied({ posPc: new Vector3(0, 0, 2.55), absMag: 16.6 })).toBe(true);    // a faint red dwarf next door
    expect(wellStudied({ posPc: new Vector3(55.9, 0, 0), absMag: 7.6 })).toBe(false);    // Gl 9848: 56 pc, magnitude 11
    // the edges: magnitude 6.5 and 10 parsecs
    expect(wellStudied({ posPc: new Vector3(100, 0, 0), absMag: 1.5 })).toBe(true);      // magnitude 6.5 at 100 pc
    expect(wellStudied({ posPc: new Vector3(100, 0, 0), absMag: 1.6 })).toBe(false);     // magnitude 6.6
    expect(wellStudied({ posPc: new Vector3(10, 0, 0), absMag: 15 })).toBe(true);
  });
});
