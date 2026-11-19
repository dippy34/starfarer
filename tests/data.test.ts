import { describe, expect, it } from 'vitest';
import { DEG } from '../src/core/astro';
import { comovingDistanceMpc } from '../src/core/cosmology';
import { uposDistance, uposFromMeters } from '../src/core/hp';
import { Rng } from '../src/core/rng';
import { LY, MPC, PC } from '../src/core/units';
import { STYLE_COMPACT, STYLE_GIANT, STYLE_STAR, decodeCatalogTile, galaxyPosition, starAbsMag, starPosition } from '../src/data/decode';
import {
  GALAXY_COLUMNS, QUASAR_COLUMNS, SDSS_COLUMNS, STAR_COLUMNS, STAR_FLAG_WD, type DatasetManifest,
  dqGalColor, dqGalMag, dqGalPa, dqGalRatio, dqGalSize, dqNameDec, dqNameRa, dqQsoMag, dqRedshift, dqStarColor, dqStarDec, dqStarDist, dqStarMag, dqStarRa,
  jName, parseJName, qGalColor, qGalMag, qGalPa, qGalRatio, qGalSize, qNameDec, qNameRa, qQsoMag, qRedshift, qStarColor, qStarDec, qStarDist, qStarMag, qStarRa, twoMassName,
} from '../src/data/format/schema';
import { type ColumnSpec, type Columns, type RawTile, decodeIds, decodeTile, encodeIds, encodeTile, packTile, unpackTile } from '../src/data/format/tileFormat';
import { buildNodeIndex, nodeApparentMag, nodeBrightness, nodeCube, selectNodes } from '../src/data/lod';
import { normalizeName } from '../src/data/names';
import { decodeView, encodeView } from '../src/modes/explore/links';
import { parseCoordinates, seedPosition } from '../src/modes/explore/search';
import { UNIVERSE_RADIUS_MPC } from '../src/universe/cosmicWeb';
import { type DatasetInput, buildOctree } from '../scripts/build-catalogs/lib/tree';

const MAX: Record<string, number> = { u8: 0xff, u16: 0xffff, u24: 0xffffff, u32: 0xffffffff };

/** A random tile that satisfies the format's rules (delta columns sorted). */
function randomTile(specs: ColumnSpec[], count: number, seed: number): RawTile {
  const rng = new Rng(seed);
  const columns: Columns = {};
  for (const spec of specs) {
    const arr = spec.type === 'u8' ? new Uint8Array(count) : spec.type === 'u16' ? new Uint16Array(count) : new Uint32Array(count);
    for (let i = 0; i < count; i++) arr[i] = Math.floor(rng.next() * (MAX[spec.type]! + 1));
    // Make sure the extremes are exercised.
    if (count > 2) {
      arr[0] = 0;
      arr[1] = MAX[spec.type]!;
    }
    if (spec.delta) arr.sort();
    columns[spec.name] = arr;
  }
  const refCount = Math.min(count, 7);
  const refRows = Uint32Array.from({ length: refCount }, (_, i) => Math.floor((i * count) / Math.max(1, refCount)));
  const refIds = Uint32Array.from({ length: refCount }, () => rng.u32());
  return { count, columns, refRows, refIds };
}

function expectSameTile(a: RawTile, b: RawTile, specs: ColumnSpec[]): void {
  expect(b.count).toBe(a.count);
  for (const s of specs) expect(Array.from(b.columns[s.name]!)).toEqual(Array.from(a.columns[s.name]!));
  expect(Array.from(b.refRows)).toEqual(Array.from(a.refRows));
  expect(Array.from(b.refIds)).toEqual(Array.from(a.refIds));
}

describe('tile format', () => {
  it('round-trips every dataset schema bit-exactly', () => {
    const schemas: Array<[string, ColumnSpec[]]> = [['stars', STAR_COLUMNS], ['galaxies', GALAXY_COLUMNS], ['sdss', SDSS_COLUMNS], ['quasars', QUASAR_COLUMNS]];
    for (const [, specs] of schemas) {
      for (const count of [0, 1, 2, 3, 257, 4096]) {
        const tile = randomTile(specs, count, 1000 + count);
        expectSameTile(tile, unpackTile(specs, packTile(specs, tile)), specs);
        expectSameTile(tile, decodeTile(specs, encodeTile(specs, tile)), specs);
      }
    }
  });

  it('compresses realistic tiles well below their raw size', () => {
    // Neighbouring stars in a small patch of sky: sorted RA, similar Dec — as in a real leaf tile.
    const n = 4096;
    const rng = new Rng(7);
    const ra = Uint32Array.from({ length: n }, () => qStarRa(120 + rng.next() * 0.5)).sort();
    const columns: Columns = {
      ra, dec: Uint32Array.from({ length: n }, () => qStarDec(-30 + rng.next() * 0.5)), dist: Uint16Array.from({ length: n }, () => qStarDist(300 + rng.next() * 60)),
      mag: Uint16Array.from({ length: n }, () => qStarMag(9 + rng.next() * 2.5)), color: Uint8Array.from({ length: n }, () => qStarColor(0.4 + rng.next())), flags: new Uint8Array(n),
    };
    const bytes = encodeTile(STAR_COLUMNS, { count: n, columns, refRows: new Uint32Array(0), refIds: new Uint32Array(0) });
    // 14 raw bytes per star; the format should need well under 11.
    expect(bytes.length / n).toBeLessThan(11);
  });

  it('rejects malformed input instead of returning garbage', () => {
    const tile = randomTile(STAR_COLUMNS, 50, 3);
    const packed = packTile(STAR_COLUMNS, tile);
    expect(() => unpackTile(STAR_COLUMNS, packed.subarray(0, packed.length - 1))).toThrow(/size mismatch/);
    const bad = packed.slice();
    bad[0] = 0x58;
    expect(() => unpackTile(STAR_COLUMNS, bad)).toThrow(/bad magic/);
    // A tile read with the wrong schema (different row size) is caught by the size check.
    expect(() => unpackTile(QUASAR_COLUMNS, packed)).toThrow(/size mismatch/);
    const unsorted = randomTile(STAR_COLUMNS, 50, 4);
    unsorted.columns.ra!.reverse();
    expect(() => packTile(STAR_COLUMNS, unsorted)).toThrow(/not sorted/);
    const overflow = randomTile(QUASAR_COLUMNS, 10, 5);
    overflow.columns.dec![3] = 0x1000000;
    expect(() => packTile(QUASAR_COLUMNS, overflow)).toThrow(/overflows/);
    expect(() => packTile(STAR_COLUMNS, { ...tile, columns: { ra: tile.columns.ra! } })).toThrow(/missing/);
  });

  it('round-trips 64-bit catalogue ids', () => {
    const ids = BigUint64Array.from([0n, 1n, 5853498713190525696n, 4472832130942575872n, 0xffffffffffffffffn, 118322n]);
    expect(Array.from(decodeIds(encodeIds(ids)))).toEqual(Array.from(ids));
    expect(decodeIds(encodeIds(new BigUint64Array(0))).length).toBe(0);
  });
});

describe('quantisation', () => {
  it('stores star positions to a micro-degree and distances to 0.02 %', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 2000; i++) {
      const ra = rng.next() * 360;
      const dec = rng.range(-90, 90);
      const dist = 10 ** rng.range(-0.5, 5.2);
      const mag = rng.range(-1.5, 21);
      expect(Math.abs(dqStarRa(qStarRa(ra)) - ra)).toBeLessThanOrEqual(0.51e-6);
      expect(Math.abs(dqStarDec(qStarDec(dec)) - dec)).toBeLessThanOrEqual(0.51e-6);
      expect(Math.abs(dqStarDist(qStarDist(dist)) / dist - 1)).toBeLessThan(1.2e-4);
      expect(Math.abs(dqStarMag(qStarMag(mag)) - mag)).toBeLessThanOrEqual(0.00051);
    }
    expect(dqStarColor(qStarColor(null))).toBeNull();
    expect(dqStarColor(qStarColor(NaN))).toBeNull();
    expect(dqStarColor(qStarColor(0.82))).toBeCloseTo(0.82, 1);
    // RA wraps instead of overflowing.
    expect(qStarRa(360)).toBe(0);
    expect(qStarRa(-0.000001)).toBe(359_999_999);
  });

  it('decodes a star to where the catalogue says it is', () => {
    // Sirius: RA 101.287°, Dec −16.716°, 2.64 pc, G ≈ −1.09.
    const [x, y, z] = starPosition(qStarRa(101.287155), qStarDec(-16.716116), qStarDist(2.6371));
    const c = Math.cos(-16.716116 * DEG);
    expect(x).toBeCloseTo(2.6371 * c * Math.cos(101.287155 * DEG), 3);
    expect(y).toBeCloseTo(2.6371 * c * Math.sin(101.287155 * DEG), 3);
    expect(z).toBeCloseTo(2.6371 * Math.sin(-16.716116 * DEG), 3);
    expect(starAbsMag(qStarMag(-1.09), qStarDist(2.6371))).toBeCloseTo(-1.09 - 5 * Math.log10(0.26371), 2);
  });

  it('keeps extragalactic coordinates inside their IAU-name truncation bin', () => {
    const rng = new Rng(13);
    for (let i = 0; i < 2000; i++) {
      const ra = rng.next() * 360;
      const dec = rng.range(-90, 90);
      // RA bin: 0.01 s of time = 0.15″; Dec bin: 0.1″. Decoded to bin centres.
      expect(Math.abs(dqNameRa(qNameRa(ra)) - ra)).toBeLessThanOrEqual(0.5 / 24_000 + 1e-9);
      expect(Math.abs(dqNameDec(qNameDec(dec)) - dec)).toBeLessThanOrEqual(0.5 / 36_000 + 1e-9);
      const codes = parseJName(jName(qNameRa(ra), qNameDec(dec)));
      expect(codes).toEqual({ ra: qNameRa(ra), dec: qNameDec(dec) });
      expect(parseJName(twoMassName(qNameRa(ra), qNameDec(dec)))).toEqual(codes);
    }
  });

  it('regenerates survey designations from position alone', () => {
    // 12h 29m 06.6997s, +02° 03′ 08.598″ → truncated, never rounded (IAU convention).
    expect(jName(qNameRa(187.2779154), qNameDec(2.0523883))).toBe('122906.69+020308.5');
    expect(twoMassName(qNameRa(187.2779154), qNameDec(2.0523883))).toBe('12290669+0203085');
    expect(jName(qNameRa(0), qNameDec(-0.5))).toBe('000000.00-003000.0');
    expect(jName(qNameRa(359.99999), qNameDec(-89.99999))).toBe('235959.99-895959.9');
    expect(parseJName('J122906.69+020308.5')).toEqual({ ra: qNameRa(187.2779154), dec: qNameDec(2.0523883) });
    expect(parseJName('not a name')).toBeNull();
  });

  it('stores redshifts finely nearby and handles missing photometry', () => {
    for (const z of [0, 0.0001, 0.003, 0.02, 0.1, 0.7, 2.5, 7.5]) {
      const back = dqRedshift(qRedshift(z));
      // Cubic scale: the step is 24·z^(2/3)/65535, i.e. ≈ 2.7e-5 at z = 0.02.
      expect(Math.abs(back - z)).toBeLessThanOrEqual((12 * Math.cbrt(z / 8) ** 2) / 65535 + 2e-11);
    }
    expect(dqRedshift(qRedshift(99))).toBe(8);
    expect(dqRedshift(qRedshift(-1))).toBe(0);
    for (const [q, dq] of [[qGalMag, dqGalMag], [qGalColor, dqGalColor], [qGalSize, dqGalSize], [qGalRatio, dqGalRatio], [qGalPa, dqGalPa], [qQsoMag, dqQsoMag]] as Array<[(v: number | null) => number, (c: number) => number | null]>) {
      expect(dq(q(null))).toBeNull();
      expect(dq(q(NaN))).toBeNull();
    }
    expect(dqGalMag(qGalMag(11.37))).toBeCloseTo(11.4, 5);
    expect(dqGalColor(qGalColor(0.73))).toBeCloseTo(0.73, 5);
    expect(dqGalSize(qGalSize(2.5))! / 2.5).toBeCloseTo(1, 1);
    expect(dqGalRatio(qGalRatio(0.62))).toBeCloseTo(0.62, 2);
    expect(dqGalPa(qGalPa(-45))).toBeCloseTo(135, 0);
    expect(dqQsoMag(qQsoMag(19.24))).toBeCloseTo(19.2, 5);
    expect(dqQsoMag(qQsoMag(0))).toBeNull();
    // A galaxy at z = 0.023 lands at its comoving distance in megaparsecs.
    const [x, y, z] = galaxyPosition(qNameRa(194.95), qNameDec(27.98), qRedshift(0.0231));
    expect(Math.hypot(x, y, z)).toBeCloseTo(comovingDistanceMpc(0.0231), 0);
  });

  it('decodes a whole star tile relative to its node centre', () => {
    const stars = [
      { ra: 10.0, dec: 20.0, dist: 50, g: 8.2, c: 0.8 }, // Sun-like dwarf
      { ra: 10.1, dec: 20.1, dist: 300, g: 6.0, c: 1.4 }, // red giant (M_G ≈ −1.4)
      { ra: 10.2, dec: 19.9, dist: 20, g: 14.5, c: 0.1 }, // white dwarf (M_G ≈ 13)
    ];
    const columns: Columns = {
      ra: Uint32Array.from(stars, (s) => qStarRa(s.ra)), dec: Uint32Array.from(stars, (s) => qStarDec(s.dec)), dist: Uint16Array.from(stars, (s) => qStarDist(s.dist)),
      mag: Uint16Array.from(stars, (s) => qStarMag(s.g)), color: Uint8Array.from(stars, (s) => qStarColor(s.c)), flags: Uint8Array.from([0, 0, STAR_FLAG_WD]),
    };
    const bytes = encodeTile(STAR_COLUMNS, { count: 3, columns, refRows: Uint32Array.from([1]), refIds: Uint32Array.from([42]) });
    const chunk = decodeCatalogTile('stars', STAR_COLUMNS, bytes, 40, 8, 17, 64);
    expect(chunk.count).toBe(3);
    const [x, y, z] = starPosition(columns.ra![0]!, columns.dec![0]!, columns.dist![0]!);
    expect(chunk.positions[0]).toBeCloseTo(x - 40, 3);
    expect(chunk.positions[1]).toBeCloseTo(y - 8, 3);
    expect(chunk.positions[2]).toBeCloseTo(z - 17, 3);
    expect(chunk.absMag[0]).toBeCloseTo(8.2 - 5 * Math.log10(5), 2);
    expect([chunk.colors[3], chunk.colors[7], chunk.colors[11]]).toEqual([STYLE_STAR, STYLE_GIANT, STYLE_COMPACT]);
    // The giant is redder than the white dwarf.
    expect(chunk.colors[4 + 2]!).toBeLessThan(chunk.colors[8 + 2]!);
    expect(Array.from(chunk.refRows)).toEqual([1]);
    expect(Array.from(chunk.refIds)).toEqual([42]);
  });
});

describe('level of detail', () => {
  /** A three-level synthetic octree: root, 8 children, 64 grandchildren, each level 3 mag fainter. */
  function syntheticDataset(): DatasetManifest {
    const path: string[] = [''];
    for (let a = 0; a < 8; a++) path.push(String(a));
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) path.push(`${a}${b}`);
    return {
      id: 'test', kind: 'stars', title: 'Synthetic', unit: PC, rootHalf: 1024, capacity: 1000, count: path.length * 1000, hasIds: false, columns: STAR_COLUMNS,
      nodes: { path, count: path.map(() => 1000), mag: path.map((p) => -6 + 3 * p.length), bytes: path.map(() => 9000) },
    };
  }

  it('maps octant paths to cubes', () => {
    expect(nodeCube(1024, '')).toEqual({ cx: 0, cy: 0, cz: 0, half: 1024 });
    expect(nodeCube(1024, '7')).toEqual({ cx: 512, cy: 512, cz: 512, half: 512 });
    expect(nodeCube(1024, '70')).toEqual({ cx: 256, cy: 256, cz: 256, half: 256 });
    expect(nodeCube(1024, '1')).toEqual({ cx: 512, cy: -512, cz: -512, half: 512 });
    expect(nodeCube(1024, '1', [10, 20, 30])).toEqual({ cx: 522, cy: -492, cz: -482, half: 512 });
  });

  it('keeps the Sun a third of a cell from every cell wall when the root is shifted by a third', () => {
    // The galaxy trees are built this way: our neighbourhood then sits in ONE chain of nested tiles.
    const half = 4096;
    const center: [number, number, number] = [half / 3, half / 3, half / 3];
    let path = '';
    for (let level = 1; level <= 14; level++) {
      // Descend into the child that contains the Sun (the origin).
      const parent = nodeCube(half, path, center);
      path += String((0 >= parent.cx ? 1 : 0) | (0 >= parent.cy ? 2 : 0) | (0 >= parent.cz ? 4 : 0));
      const c = nodeCube(half, path, center);
      const toWall = c.half - Math.max(Math.abs(c.cx), Math.abs(c.cy), Math.abs(c.cz));
      expect(toWall / (2 * c.half)).toBeCloseTo(1 / 3, 6);
    }
    // Without the shift the Sun is on a corner shared by eight cells of every level.
    expect(nodeCube(half, '7').cx - nodeCube(half, '7').half).toBe(0);
  });

  it('samples a luminosity-ordered survey evenly first, then adds the tiles around the camera', () => {
    const nodes = buildNodeIndex(syntheticDataset());
    expect(nodes[9]!.parent).toBe(1);
    expect(nodes[1]!.children.length).toBe(8);
    let previous = 0;
    for (const budget of [500, 1000, 4000, 9000, 30000, 1e6]) {
      const sel = selectNodes(nodes, 300, 300, 300, { budget, magLimit: 30, tenPc: 10 });
      expect(sel.nodes[0]).toBe(0); // the root is always drawn
      expect(sel.points).toBeLessThanOrEqual(Math.max(1000, budget));
      expect(sel.points).toBeGreaterThanOrEqual(previous);
      previous = sel.points;
      expect(new Set(sel.nodes).size).toBe(sel.nodes.length);
      expect(sel.points).toBe(sel.nodes.length * 1000);
    }
    // Budget for the root and all eight children, plus a little: both levels complete, then the camera's surroundings.
    const sel = selectNodes(nodes, 300, 300, 300, { budget: 12_500, magLimit: 30, tenPc: 10 });
    expect(sel.uniform).toBe(9);
    expect(sel.nodes.slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sel.points).toBe(12_000);
    // The three extra tiles are the grandchildren nearest the camera (inside octant '7'), the one it is in first.
    expect(nodes[sel.nodes[9]!]!.path).toBe('70');
    for (const id of sel.nodes.slice(9)) expect(nodes[id]!.path.startsWith('7')).toBe(true);
    // Too small for the second level: only the root is "uniform". The rest goes to the tiles that could show
    // the brightest things from here, whatever their level — no need to load a tile's parents first.
    const small = selectNodes(nodes, 300, 300, 300, { budget: 3000, magLimit: 30, tenPc: 10 });
    expect(small.uniform).toBe(1);
    expect(small.nodes.map((i) => nodes[i]!.path)).toEqual(['', '7', '70']);
    // A reserve for the camera's surroundings holds the whole levels back.
    const reserved = selectNodes(nodes, 300, 300, 300, { budget: 12_500, magLimit: 30, tenPc: 10, nearReserve: 5000 });
    expect(reserved.uniform).toBe(1);
    expect(reserved.points).toBe(12_000);
    expect(reserved.nodes.map((i) => nodes[i]!.path)).toContain('70');
    // Around the camera nothing fainter than the limit is fetched; whole levels are, as far as they fit.
    const strict = selectNodes(nodes, 300, 300, 300, { budget: 1e6, magLimit: -100, tenPc: 10 });
    expect(strict.nodes.length).toBe(73);
    expect(strict.uniform).toBe(73);
    const strictSmall = selectNodes(nodes, 300, 300, 300, { budget: 5000, magLimit: -100, tenPc: 10 });
    expect(strictSmall.nodes).toEqual([0]);
    // A tile that contains the camera looks brighter than the same tile seen from outside.
    const inside = nodes.find((n) => n.path === '70')!;
    expect(nodeApparentMag(inside, 300, 300, 300, 10)).toBeLessThan(nodeApparentMag(inside, -300, 300, 300, 10));
    // Same question, same answer.
    expect(selectNodes(nodes, 12, -7, 99, { budget: 20000, magLimit: 30, tenPc: 10 })).toEqual(selectNodes(nodes, 12, -7, 99, { budget: 20000, magLimit: 30, tenPc: 10 }));
  });

  it('keeps the sky complete to one magnitude when tiles are ordered by apparent brightness', () => {
    // A star catalogue as the pipeline writes it: every node records the brightest apparent magnitude of
    // its stars seen from the Sun (`app`) and their median distance from the Sun (`med`).
    const ds = syntheticDataset();
    const rng = new Rng(5);
    const cubes = ds.nodes.path.map((p) => nodeCube(ds.rootHalf, p));
    // Stars of each node: somewhere inside its cube, so at least as far from the Sun as the cube is.
    const nearest = cubes.map((c) => Math.hypot(Math.max(0, Math.abs(c.cx) - c.half), Math.max(0, Math.abs(c.cy) - c.half), Math.max(0, Math.abs(c.cz) - c.half)) + 2 + rng.next() * 40);
    ds.nodes.med = nearest.map((d, i) => d + cubes[i]!.half * 0.6);
    // Brightest apparent magnitude: at best the node's most luminous star at its nearest distance, usually fainter.
    ds.nodes.app = ds.nodes.mag.map((m, i) => m + 5 * Math.log10(nearest[i]! / 10) + rng.next() * 3);
    const nodes = buildNodeIndex(ds);
    // From the Solar System (a few astronomical units from the Sun — 1e-5 pc).
    const cam: [number, number, number] = [1e-5, -2e-5, 0];
    const sel = selectNodes(nodes, ...cam, { budget: 20_000, magLimit: 30, tenPc: 10 });
    expect(sel.points).toBe(20_000);
    expect(sel.uniform).toBe(sel.nodes.length);
    const chosen = new Set(sel.nodes);
    const brightestLeftOut = Math.min(...nodes.filter((n) => !chosen.has(n.index)).map((n) => n.app!));
    // The cutoff is the brightest star that had to be left out, and every tile holding a brighter one is loaded:
    // drawing down to the cutoff shows a sky with no holes.
    expect(sel.cutoffMag).toBeCloseTo(brightestLeftOut, 3);
    for (const n of nodes) if (n.app! < sel.cutoffMag - 1e-6) expect(chosen.has(n.index)).toBe(true);
    // Seen from the Sun, a tile looks exactly as bright as the catalogue says.
    const some = nodes.find((n) => n.path === '0')!;
    expect(nodeBrightness(some, 0, 0, 0, 10).sky).toBeCloseTo(some.app!, 6);
    // A little way from the Sun the answer barely changes (no sudden loss of stars when you leave home)…
    const near = selectNodes(nodes, 3, 1, -2, { budget: 20_000, magLimit: 30, tenPc: 10 });
    expect(near.cutoffMag).toBeGreaterThan(sel.cutoffMag - 1.5);
    // …and far away the tile around the camera matters, however faint its stars look from home.
    const far = selectNodes(nodes, 700, 700, 700, { budget: 3000, magLimit: 30, tenPc: 10 });
    expect(far.nodes.map((i) => nodes[i]!.path)).toContain('77');
    expect(nodeBrightness(nodes.find((n) => n.path === '77')!, 700, 700, 700, 10).local).toBeLessThan(nodeBrightness(nodes.find((n) => n.path === '77')!, 700, 700, 700, 10).sky);
    // Only cubes small enough to be filled by their objects are judged by local density.
    expect(nodeBrightness(nodes.find((n) => n.path === '77')!, 700, 700, 700, 10, 100).local).toBe(Infinity);
  });

  it('reports the cutoff magnitude where the budget ran out', () => {
    const nodes = buildNodeIndex(syntheticDataset());
    const tight = selectNodes(nodes, 0, 0, 0, { budget: 4000, magLimit: 30, tenPc: 10 });
    const loose = selectNodes(nodes, 0, 0, 0, { budget: 1e6, magLimit: 30, tenPc: 10 });
    expect(tight.cutoffMag).toBeLessThan(30);
    expect(loose.cutoffMag).toBe(30);
    expect(Number.isFinite(tight.cutoffMag)).toBe(true);
  });
});

describe('catalogue octree builder', () => {
  /** A clumpy synthetic catalogue: most objects near the origin, a tail far out, random luminosities. */
  function catalogue(count: number, extra: Partial<DatasetInput> = {}): DatasetInput {
    const rng = new Rng(77);
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    const z = new Float64Array(count);
    const lodMag = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 600 * rng.next() ** 3;
      const [ux, uy, uz] = rng.unitVector();
      x[i] = ux * r;
      y[i] = uy * r;
      z[i] = uz * r;
      lodMag[i] = -24 + 8 * rng.next();
    }
    return { id: 'test', kind: 'galaxies', title: 'Synthetic', unit: MPC, rootHalf: 1024, capacity: 256, count, x, y, z, lodMag, columns: [], data: {}, nameId: new Int32Array(count).fill(-1), ...extra };
  }
  const parentOf = (path: string): string => path.slice(0, -1);

  it('fills tiles brightest-first, keeps children fainter than their parent and loses nothing', () => {
    const input = catalogue(20_000);
    const nodes = buildOctree(input);
    const seen = new Uint8Array(input.count);
    for (const [path, node] of nodes) {
      expect(node.rows.length).toBeGreaterThan(0);
      expect(node.rows.length).toBeLessThanOrEqual(input.capacity);
      const cube = nodeCube(input.rootHalf, path);
      let brightest = Infinity;
      for (const r of node.rows) {
        seen[r]!++;
        brightest = Math.min(brightest, input.lodMag[r]!);
        // Every object lies inside its tile's cube.
        expect(Math.max(Math.abs(input.x[r]! - cube.cx), Math.abs(input.y[r]! - cube.cy), Math.abs(input.z[r]! - cube.cz))).toBeLessThanOrEqual(cube.half);
      }
      expect(node.brightest).toBe(brightest);
      if (path.length > 0) {
        const parent = nodes.get(parentOf(path))!;
        // A node only overflows into its children once it is full, and then with fainter objects only.
        expect(parent.rows.length).toBe(input.capacity);
        expect(brightest).toBeGreaterThanOrEqual(Math.max(...parent.rows.map((r) => input.lodMag[r]!)));
      }
    }
    expect(seen.every((n) => n === 1)).toBe(true);
    // Same catalogue, same tree.
    expect([...buildOctree(catalogue(20_000)).keys()]).toEqual([...nodes.keys()]);
  });

  it('merges sparse branches into their parents without losing or duplicating objects', () => {
    const plain = buildOctree(catalogue(20_000));
    const input = catalogue(20_000, { mergeSparse: true });
    const merged = buildOctree(input);
    expect(merged.size).toBeLessThan(plain.size * 0.8);
    const seen = new Uint8Array(input.count);
    const below = new Map<string, number>();
    for (const [path, node] of merged) {
      expect(node.rows.length).toBeLessThanOrEqual(2 * input.capacity);
      for (const r of node.rows) seen[r]!++;
      for (let p = path; p.length > 0; p = parentOf(p)) below.set(parentOf(p), (below.get(parentOf(p)) ?? 0) + node.rows.length);
      if (path.length > 0) {
        // Parents exist and still hold the brighter objects.
        expect(merged.has(parentOf(path))).toBe(true);
        expect(node.brightest).toBeGreaterThanOrEqual(merged.get(parentOf(path))!.brightest);
      }
    }
    expect(seen.every((n) => n === 1)).toBe(true);
    // No branch survives that would have fitted into a single tile.
    for (const total of below.values()) expect(total).toBeGreaterThan(input.capacity);
  });

  it('orders by apparent brightness when asked to, and honours a shifted root cube', () => {
    const base = catalogue(8000);
    const apparent = new Float32Array(base.count);
    for (let i = 0; i < base.count; i++) apparent[i] = base.lodMag[i]! + 5 * Math.log10(Math.max(Math.hypot(base.x[i]!, base.y[i]!, base.z[i]!), 1e-9) / 1e-5);
    const center: [number, number, number] = [1024 / 3, 1024 / 3, 1024 / 3];
    const nodes = buildOctree({ ...base, orderKey: apparent, tenPc: 1e-5, center });
    const root = nodes.get('')!;
    // The root tile is "the brightest objects of our sky".
    const sorted = Array.from(apparent).sort((a, b) => a - b);
    expect(root.app).toBeCloseTo(sorted[0]!, 3);
    expect(Math.max(...root.rows.map((r) => apparent[r]!))).toBeCloseTo(sorted[base.capacity - 1]!, 3);
    let total = 0;
    for (const [path, node] of nodes) {
      total += node.rows.length;
      const cube = nodeCube(base.rootHalf, path, center);
      for (const r of node.rows) expect(Math.max(Math.abs(base.x[r]! - cube.cx), Math.abs(base.y[r]! - cube.cy), Math.abs(base.z[r]! - cube.cz))).toBeLessThanOrEqual(cube.half);
      if (path.length > 0) expect(node.app).toBeGreaterThanOrEqual(nodes.get(parentOf(path))!.app);
    }
    expect(total).toBe(base.count);
    // With the shift, the origin's neighbourhood is one chain of nested tiles: one tile per level touches it.
    const touching = new Map<number, number>();
    for (const path of nodes.keys()) {
      const c = nodeCube(base.rootHalf, path, center);
      if (Math.max(Math.abs(c.cx), Math.abs(c.cy), Math.abs(c.cz)) <= c.half) touching.set(path.length, (touching.get(path.length) ?? 0) + 1);
    }
    for (const n of touching.values()) expect(n).toBe(1);
  });
});

describe('share links and search', () => {
  it('restores the exact place, direction and time from a link', () => {
    // 9.8 billion light-years out, to the millimetre.
    const pos = uposFromMeters(6.1e25 + 1234.567, -4.2e25 - 0.25, 3.3e25 + 99.125);
    const s = Math.SQRT1_2;
    const link = encodeView({ pos, quat: [0.5, -0.5, s * s * 2 * 0.5, 0.5], time: 843_912_345, focus: 3, name: 'Somewhere far' });
    const back = decodeView(`#${link}`)!;
    expect(uposDistance(back.pos, pos)).toBeLessThan(0.002);
    expect(back.time).toBe(843_912_345);
    expect(back.focus).toBe(3);
    expect(back.name).toBe('Somewhere far');
    for (let i = 0; i < 4; i++) expect(back.quat[i]).toBeCloseTo([0.5, -0.5, 0.5, 0.5][i]!, 6);
    // Encoding is stable: decode → encode gives the same link.
    expect(encodeView(back)).toBe(link);
  });

  it('ignores broken or foreign links', () => {
    for (const bad of ['', '#', '#v=2&p=1.2.3.4.5.6&q=1.0.0.0&t=0', '#v=1&p=zz&q=1.0.0.0&t=0', '#v=1&p=1.2.3.4.5.6&q=0.0.0.0&t=0', '#v=1&p=1.2.3.4.5.6&q=1.0.0&t=0', '#hello']) {
      expect(decodeView(bad)).toBeNull();
    }
  });

  it('parses sky coordinates in the usual notations', () => {
    const a = parseCoordinates('10h 08m 22.3s +11° 58′ 02″ 79 ly')!;
    expect(a.ra).toBeCloseTo((10 + 8 / 60 + 22.3 / 3600) * 15, 9);
    expect(a.dec).toBeCloseTo(11 + 58 / 60 + 2 / 3600, 9);
    expect(a.dist).toBeCloseTo(79 * LY, -3);
    const b = parseCoordinates('RA 187.70, Dec −12.39, 16.5 Mpc')!;
    expect([b.ra, b.dec]).toEqual([187.7, -12.39]);
    expect(b.dist).toBeCloseTo(16.5 * MPC, -10);
    const c = parseCoordinates('05h 35m -05d 23m')!;
    expect(c.ra).toBeCloseTo(83.75, 9);
    expect(c.dec).toBeCloseTo(-(5 + 23 / 60), 9);
    expect(c.dist).toBe(100 * LY);
    expect(parseCoordinates('400 12')).toBeNull();
    expect(parseCoordinates('12 95')).toBeNull();
    expect(parseCoordinates('andromeda')).toBeNull();
  });

  it('maps a seed word to one fixed place inside the universe', () => {
    const p = seedPosition('  Hello World ');
    expect(uposDistance(p, seedPosition('hello world'))).toBe(0);
    expect(uposDistance(p, seedPosition('hello world!'))).toBeGreaterThan(MPC);
    for (const word of ['a', 'starfarer', '42', 'ünïcödé']) {
      expect(uposDistance(seedPosition(word), uposFromMeters(0, 0, 0))).toBeLessThan(UNIVERSE_RADIUS_MPC * MPC);
    }
  });

  it('normalises names for matching', () => {
    expect(normalizeName('  Alpha  CENTAURI ')).toBe('alpha centauri');
    expect(normalizeName('ξ Boötis')).toBe('ξ bootis');
    expect(normalizeName('M 31')).toBe('m 31');
    expect(normalizeName('TRAPPIST-1 e')).toBe('trappist-1 e');
    expect(normalizeName('Sgr A*')).toBe('sgr a*');
  });
});
