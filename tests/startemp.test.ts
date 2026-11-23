import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { readTeffSource, type StarRef, type TeffSource } from '../src/universe/StarCatalog';
import { estimateStarRadius } from '../src/universe/StarRadii';
import { CatalogStar, R_V } from '../src/universe/Stars';

// A node's temperature-source file (pipeline/build_star_teff.py): records in slot order, uint16 slot,
// uint8 code, uint8 E(B-V) in hundredths; and Gaia's: uint16 slot, uint16 Teff (K).
function records(rows: [number, number, number][]): Uint8Array {
  const out = new Uint8Array(4 * rows.length), v = new DataView(out.buffer);
  rows.forEach(([a, b, c], k) => { v.setUint16(4 * k, a, true); out[4 * k + 2] = b; out[4 * k + 3] = c; });
  return out;
}
function gaiaRecords(rows: [number, number][]): Uint8Array {
  const out = new Uint8Array(4 * rows.length), v = new DataView(out.buffer);
  rows.forEach(([a, t], k) => { v.setUint16(4 * k, a, true); v.setUint16(4 * k + 2, t, true); });
  return out;
}

describe("where a star's temperature comes from", () => {
  // slot 2: Martins et al. (3); 5: Crowther et al. (4), reddened (16), E(B-V) 1.03; 7: flagged (8);
  // 9: the dwarfs' scale for a giant (2 | 32); 11: redder than its type (64); 12: composite, flagged (8 | 128)
  const t = records([[2, 3, 0], [5, 4 | 16, 103], [7, 8, 0], [9, 2 | 32, 0], [11, 64, 0], [12, 8 | 128, 0]]);

  it('is read from its node\'s file; a star with no record is from its colour', () => {
    expect(readTeffSource(t, 0)).toMatchObject({ source: 'colour', flagged: false, reddened: false, gaiaTeff: null });
    expect(readTeffSource(t, 2)).toMatchObject({ source: 'martins', reddened: false });
    expect(readTeffSource(t, 5)).toMatchObject({ source: 'crowther', reddened: true, ebv: 1.03 });
    expect(readTeffSource(t, 7)).toMatchObject({ source: 'colour', flagged: true });
    expect(readTeffSource(t, 9)).toMatchObject({ source: 'dwarfs', dwarfScale: true });
    expect(readTeffSource(t, 11)).toMatchObject({ source: 'colour', redder: true, flagged: false });
    expect(readTeffSource(t, 12)).toMatchObject({ source: 'colour', flagged: true, composite: true });
    expect(readTeffSource(t, 13).source).toBe('colour');
  });

  it("Gaia's, where it has one for the star", () => {
    const g = gaiaRecords([[4, 23150], [11, 18700]]);
    expect(readTeffSource(t, 4, g)).toMatchObject({ source: 'gaia', gaiaTeff: 23150 });
    expect(readTeffSource(t, 11, g)).toMatchObject({ source: 'gaia', gaiaTeff: 18700, redder: true });
    expect(readTeffSource(t, 2, g)).toMatchObject({ source: 'martins', gaiaTeff: null });
  });

  const card = (spect: string, teff: number, src: TeffSource | null, absMag = -5) => {
    const s = new CatalogStar('t', new Vector3(400, 0, 0), absMag, teff, spect, ['HIP 1'], { catalog: { source: 'AT-HYG v4.0', license: 'CC BY-SA 4.0' } as StarRef['catalog'], node: {} as StarRef['node'], slot: 0 });
    s.teffSource = src;
    return new Map(s.info());
  };
  const src = (over: Partial<TeffSource>): TeffSource => ({ source: 'colour', flagged: false, reddened: false, dwarfScale: false, redder: false, composite: false, ebv: 0, gaiaTeff: null, ...over });

  it('the card says which: its spectral type with the scale, its colour, or Gaia', () => {
    expect(card('O9.5 Ib', 30463, src({ source: 'martins' })).get('Temperature')).toBe('30,463 K (from its spectral type (Martins et al. 2005))');
    expect(card('B1 V', 26000, src({ source: 'dwarfs' })).get('Temperature')).toBe('26,000 K (from its spectral type (Pecaut & Mamajek 2013))');
    expect(card('B8 Ia', 12300, src({ source: 'dwarfs', dwarfScale: true })).get('Temperature')).toMatch(/dwarfs' scale .*none for its class here/);
    expect(card('K0 III', 4800, src({})).get('Temperature')).toBe('4,800 K (from its colour)');
    expect(card('', 18700, src({ source: 'gaia', gaiaTeff: 18700 })).get('Temperature')).toBe('18,700 K (Gaia DR3, from its spectrum)');
    // (not yet known: no claim)
    expect(card('K0 III', 4800, null).get('Temperature')).toBe('4,800 K');
  });

  it('a reddened star says so, with E(B-V), and is sized for the light the dust took', () => {
    const rows = card('B0IB', 27500, src({ source: 'crowther', reddened: true, ebv: 1.03 }));
    expect(rows.get('Temperature')).toBe('27,500 K (from its spectral type (Crowther et al. 2006); its light is reddened by dust, E(B−V) 1.03)');
    expect(rows.get('Radius')).toMatch(/with the light the dust took/);
  });

  it('a type that its colour does not bear out is flagged, not silently trusted', () => {
    expect(card('B8V', 4000, src({ flagged: true })).get('Spectral type')).toBe('B8V — does not match its colour or its brightness: not used');
    expect(card('F7V comp', 4601, src({ flagged: true, composite: true })).get('Spectral type')).toMatch(/composite spectrum.*not used$/);
    expect(card('G5IB', 3169, src({ redder: true })).get('Spectral type')).toMatch(/redder: dust, or a wrong type/);
    expect(card('O9.5 Ib', 30463, src({ source: 'martins' })).get('Spectral type')).toBe('O9.5 Ib');
  });

  it('once known: Gaia\'s temperature taken, and a reddened star\'s radius from its brightness before the dust', async () => {
    const make = (t: TeffSource) => new CatalogStar('t', new Vector3(2000, 0, 0), -2.92, 27500, 'B0IB', ['Cygnus X-1'],
      { catalog: { source: 'AT-HYG v4.0', license: 'CC BY-SA 4.0', teffSource: async () => t } as unknown as StarRef['catalog'], node: {} as StarRef['node'], slot: 0 });
    const reddened = make(src({ source: 'crowther', reddened: true, ebv: 1.03 }));
    await new Promise<void>((done) => reddened.describeTemperature(done));
    expect(reddened.radius).toBeCloseTo(estimateStarRadius(-2.92 - R_V * 1.03, 27500), 0);
    expect(reddened.radius).toBeGreaterThan(estimateStarRadius(-2.92, 27500) * 4);
    const gaia = make(src({ source: 'gaia', gaiaTeff: 31000 }));
    await new Promise<void>((done) => gaia.describeTemperature(done));
    expect(gaia.teff).toBe(31000);
  });
});
