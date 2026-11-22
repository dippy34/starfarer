import { readFileSync } from 'node:fs';
import { DataTexture, Vector3 } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PC } from '../src/core/units';
import { GalaxyModel, lookFor } from '../src/render/GalaxiesLayer';
import { type GalaxyForWorker, galaxyForWorker, galaxyInWorker, generateGalaxyCell, INTERIOR, InteriorFrame } from '../src/render/GalaxyInterior';
import { noise3D } from '../src/render/Noise3D';
import { ProceduralStarLayer, STAR_BUDGET, starsWithin, wantOrder } from '../src/render/ProceduralStarLayer';
import { CHUNK, POOL_VERT, StarPool } from '../src/render/StarPool';
import { BlackHole } from '../src/universe/BlackHoles';
import { Galaxy } from '../src/universe/Galaxies';
import { BANDS, cellIndex, cellSize, generateCell, reach } from '../src/universe/ProceduralStars';

describe('star pool (one draw call for all procedural stars)', () => {
  it('stores cells in chunks, frees them and keeps the draw range tight', () => {
    const p = new StarPool(10 * CHUNK, 64);
    const pos = new Float32Array(300 * 3).fill(1), mt = new Uint16Array(300).fill(7);
    const a = p.add(pos, mt, 300)!;
    expect(a.chunks.length).toBe(3);
    expect(p.used).toBe(300);
    const b = p.add(pos, mt, 100)!;
    expect(p.geometry.drawRange.count).toBe(4 * CHUNK);
    // the unused tail of a cell's last chunk is on the hidden slot 0
    const cell = p.geometry.attributes.aCell.array as Uint16Array;
    expect(cell[a.chunks[2] * CHUNK + 299 - 2 * CHUNK]).toBe(a.slot);
    expect(cell[a.chunks[2] * CHUNK + 300 - 2 * CHUNK]).toBe(0);
    p.remove(b);
    expect(p.geometry.drawRange.count).toBe(3 * CHUNK);
    p.remove(a);
    expect(p.used).toBe(0);
    expect(p.geometry.drawRange.count).toBe(0);
  });

  it('refuses a cell when full, and reuses freed room', () => {
    const p = new StarPool(4 * CHUNK, 64);
    const n = 3 * CHUNK;
    const a = p.add(new Float32Array(n * 3), new Uint16Array(n), n)!;
    expect(p.add(new Float32Array(n * 3), new Uint16Array(n), n)).toBeNull();
    p.remove(a);
    expect(p.add(new Float32Array(n * 3), new Uint16Array(n), n)).not.toBeNull();
  });

  it('slot texture: shown cells carry offset, magnitudes and reach; hidden ones are culled', () => {
    const p = new StarPool(CHUNK, 64);
    p.show(5, 1, 2, 3, 0.5, 400);
    const d = p.slots.image.data as Float32Array;
    expect([...d.subarray(40, 45)]).toEqual([1, 2, 3, 0.5, 400]);
    p.hide(5);
    expect(d[43]).toBeGreaterThan(50);
    expect(d[3]).toBeGreaterThan(50);  // slot 0 is always hidden
  });

  it('the shader is the star shader fed from the slot texture, with the reach fade', () => {
    expect(POOL_VERT).toContain('texelFetch(uSlots');
    expect(POOL_VERT).toContain('reachFade');
    expect(POOL_VERT).not.toContain('uOffset + aPos');
  });
});

describe('stars inside other galaxies', () => {
  const j = JSON.parse(readFileSync('public/data/galaxies.json', 'utf8'));
  const gs: Galaxy[] = j.galaxies.map((g: never, i: number) => new Galaxy(g, i));
  const frame = (name: string) => {
    const g = gs.find((x) => x.name === name)!;
    return new InteriorFrame(new GalaxyModel(g, lookFor(g, gs), noise3D().data), gs.indexOf(g));
  };
  const m31 = frame('Andromeda Galaxy');

  it('are deterministic per galaxy and cell', () => {
    const a = generateGalaxyCell(m31, 9, 30, 0, 0), b = generateGalaxyCell(m31, 9, 30, 0, 0);
    expect(a.count).toBeGreaterThan(0);
    expect(b.count).toBe(a.count);
    expect([...b.pos.subarray(0, 30)]).toEqual([...a.pos.subarray(0, 30)]);
    const m33 = frame('Triangulum Galaxy');
    expect(generateGalaxyCell(m33, 9, 30, 0, 0).key).not.toBe(a.key);
  });

  it('follow the galaxy: denser towards the centre, thin above the disc', () => {
    const k = 12, S = cellSize(k) / m31.rpc;
    const at = (x: number, z: number) => generateGalaxyCell(m31, k, Math.floor(x / S), 0, Math.floor(z / S)).count;
    expect(at(0.2, 0)).toBeGreaterThan(at(0.6, 0));
    expect(at(0.4, 0)).toBeGreaterThan(5 * at(0.4, 0.15));
  });

  it('at 0.4 radii, a Quest-sized limit fits the headset budget', () => {
    const cam = new Vector3(0.4, 0, 0.005).multiplyScalar(m31.rpc);
    let stars = 0;
    for (let k = 0; k < BANDS.length; k++) {
      const R = reach(BANDS[k].M, 7.1), S = cellSize(k);
      for (let ix = Math.floor((cam.x - R) / S); ix <= Math.floor((cam.x + R) / S); ix++)
        for (let iy = Math.floor(-R / S); iy <= Math.floor(R / S); iy++)
          for (let iz = Math.floor((cam.z - R) / S); iz <= Math.floor((cam.z + R) / S); iz++) {
            const dx = Math.max(ix * S - cam.x, 0, cam.x - (ix + 1) * S), dy = Math.max(iy * S, 0, -(iy + 1) * S), dz = Math.max(iz * S - cam.z, 0, cam.z - (iz + 1) * S);
            if (Math.hypot(dx, dy, dz) <= R) stars += generateGalaxyCell(m31, k, ix, iy, iz).count;
          }
    }
    expect(stars).toBeGreaterThan(20000);
    expect(stars).toBeLessThan(150000);
  }, 60000);
});

/** The galaxies as App places them: M87 moved onto its black hole (40 kpc beyond its catalogued distance). */
function placedGalaxies(): { gs: Galaxy[]; hole: BlackHole } {
  const gs: Galaxy[] = JSON.parse(readFileSync('public/data/galaxies.json', 'utf8')).galaxies.map((g: never, i: number) => new Galaxy(g, i));
  const holes = JSON.parse(readFileSync('public/data/blackholes.json', 'utf8')).blackholes as { name: string }[];
  const hole = new BlackHole(0, holes.find((h) => h.name === 'M87*') as never);
  gs.find((g) => g.name === 'M87')!.upos.copy(hole.upos);
  return { gs, hole };
}

describe('the galaxy-star workers place a galaxy where the main thread has it', () => {
  it('M87 on its black hole: the same frame and the same cells, star for star', () => {
    const { gs } = placedGalaxies();
    const i = gs.findIndex((g) => g.name === 'M87');
    const noise = noise3D().data;
    const main = new InteriorFrame(new GalaxyModel(gs[i], lookFor(gs[i], gs), noise), i);
    // (through structured cloning, as a worker receives it)
    const wg = galaxyInWorker(structuredClone(galaxyForWorker(gs[i])), i);
    const worker = new InteriorFrame(new GalaxyModel(wg, lookFor(wg, gs), noise), i);
    expect(worker.centre.toArray()).toEqual(main.centre.toArray());
    expect(worker.rpc).toBe(main.rpc);
    const a = generateGalaxyCell(main, 14, 0, 0, 0), b = generateGalaxyCell(worker, 14, 0, 0, 0);
    expect(a.count).toBeGreaterThan(1000);
    expect(b.centre.toArray()).toEqual(a.centre.toArray());
    expect([...b.pos]).toEqual([...a.pos]);
    expect([...b.absMag]).toEqual([...a.absMag]);
  });
});

describe('which stars go to the pool', () => {
  it('cells come by how bright their stars can look: the cell the eye is in, in every band, before far cells of bright bands', () => {
    // (reach at 7 mag: band 0, 15.8 kpc; band 9, 251 pc; band 21, 1 pc)
    const w = (k: number, d: number) => ({ k, ix: 0, iy: 0, iz: 0, d, q: d / reach(BANDS[k].M, 7), gi: 0 });
    const list = [w(0, 15000), w(2, 0), w(21, 0.5), w(15, 0), w(9, 200)];
    list.sort(wantOrder);
    expect(list.map((x) => x.k)).toEqual([2, 15, 21, 9, 0]);
  });

  it('a cell sends its stars within a radius of the eye', () => {
    // (the band-9 cell a kiloparsec from the Galactic centre, in the bulge)
    const c = generateCell(9, ...cellIndex(9, new Vector3(1000, 0, 0)));
    expect(c.count).toBeGreaterThan(50);
    const eye = [c.pos[0] + 3, c.pos[1], c.pos[2]];
    const out = new Uint32Array(c.count);
    const n = starsWithin(c, eye[0], eye[1], eye[2], 0.4 * c.size, out);
    let expected = 0;
    for (let i = 0; i < c.count; i++) if (Math.hypot(c.pos[i * 3] - eye[0], c.pos[i * 3 + 1] - eye[1], c.pos[i * 3 + 2] - eye[2]) <= 0.4 * c.size) expected++;
    expect(n).toBe(expected);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(c.count);
    for (let j = 1; j < n; j++) expect(out[j]).toBeGreaterThan(out[j - 1]);
  });
});

/**
 * Stand-in for the generating workers (there are none in Node): requests are queued and answered
 * between frames, on this thread, by the workers' own code, with the galaxies the layer sends.
 */
class TestWorker {
  static all: TestWorker[] = [];
  static frames = new Map<number, InteriorFrame>();
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private queue: { gi: number; k: number; ix: number; iy: number; iz: number }[] = [];
  private galaxies: Galaxy[] = [];
  constructor(private url: URL) { TestWorker.all.push(this); }
  postMessage(m: { galaxies?: GalaxyForWorker[]; add?: { gi: number; g: GalaxyForWorker }[]; gi: number; k: number; ix: number; iy: number; iz: number }): void {
    if (m.galaxies) this.galaxies = m.galaxies.map((g, i) => galaxyInWorker(structuredClone(g), i));
    else if (m.add) for (const a of m.add) this.galaxies[a.gi] = galaxyInWorker(structuredClone(a.g), a.gi);
    else this.queue.push(m);
  }
  run(n: number): void {
    for (; n > 0 && this.queue.length; n--) {
      const d = this.queue.shift()!;
      const c = this.url.href.includes('galaxyStars') ? generateGalaxyCell(this.frame(d.gi), d.k, d.ix, d.iy, d.iz) : generateCell(d.k, d.ix, d.iy, d.iz);
      this.onmessage?.({ data: { key: c.key, band: c.band, ix: c.ix, iy: c.iy, iz: c.iz, size: c.size, count: c.count,
        centre: [c.centre.x, c.centre.y, c.centre.z], gi: d.gi, pos: c.pos, absMag: c.absMag, teff: c.teff, cls: c.cls } });
    }
  }
  private frame(gi: number): InteriorFrame {
    let fr = TestWorker.frames.get(gi);
    if (!fr) {
      const g = this.galaxies[gi];
      fr = new InteriorFrame(new GalaxyModel(g, lookFor(g, this.galaxies), noise3D().data), gi);
      TestWorker.frames.set(gi, fr);
    }
    return fr;
  }
}

describe('procedural stars round the eye inside a giant elliptical (the heart of M87)', () => {
  const { gs, hole } = placedGalaxies();
  const saved = { ...INTERIOR, frames: new Map(INTERIOR.frames) };
  const realWorker = (globalThis as { Worker?: unknown }).Worker;
  beforeAll(() => {
    const noise = noise3D().data;
    INTERIOR.galaxies = gs;
    INTERIOR.models = new Map(['M87', 'M60'].map((n) => { const g = gs.find((x) => x.name === n)!; return [g, new GalaxyModel(g, lookFor(g, gs), noise)]; }));
    INTERIOR.frames.clear();
    (globalThis as { Worker?: unknown }).Worker = TestWorker;
  });
  afterAll(() => {
    Object.assign(INTERIOR, saved);
    (globalThis as { Worker?: unknown }).Worker = realWorker;
  });

  /** `k` radii from the galaxy's centre, 35° off its axis (as ?target=<galaxy>&dist=<k> arrives) */
  const at = (name: string, k: number) => {
    const g = gs.find((x) => x.name === name)!;
    const c = g.upos.toVector3().multiplyScalar(1 / PC);
    return c.addScaledVector(g.viewDir(c.clone().negate()), (k * g.radius) / PC);
  };
  const M_LIM = 7.2;
  /** frames until every cell wanted is made and the budget has settled (`from`: the layer's first worker) */
  const settle = (layer: ProceduralStarLayer, cam: Vector3, from: number) => {
    let still = 0, last = NaN;
    for (let f = 0; f < 800 && still < 40; f++) {
      layer.update(cam, M_LIM, 0.02, 4);
      const cut = M_LIM + 0.3 - layer.mGen;
      still = layer.pending === 0 && cut === last ? still + 1 : 0;
      last = cut;
      for (const w of TestWorker.all.slice(from)) w.run(4);
    }
    return { cut: M_LIM + 0.3 - layer.mGen, ...layer.reachStats(cam) };
  };
  const make = (vr: boolean) => {
    const from = TestWorker.all.length;
    return { layer: new ProceduralStarLayer({}, new DataTexture(), vr), from };
  };
  // (?target=M87*&dist=5470: 5470 radii of the hole from it, 3.4 pc)
  const besideHole = (5470 * hole.radius) / gs.find((g) => g.name === 'M87')!.radius;

  // (the layer as it was, whole cells sorted brightest band first, settled with 89 to 376 stars within
  // reach in these places on either budget, the budget's cut at its 6 magnitudes)
  for (const [place, name, k] of [['the heart of M87', 'M87', 0.0177], ['beside M87*', 'M87', besideHole], ['the heart of M60', 'M60', 0.003]] as const) {
    for (const vr of [true, false]) {
      it(`${place}, ${vr ? 'a phone or headset' : 'a desktop'} budget: a full star field, every star within reach in the pool`, () => {
        const { layer, from } = make(vr);
        const cam = at(name, k);
        const s = settle(layer, cam, from);
        expect(layer.pool.capacity).toBeLessThanOrEqual((vr ? STAR_BUDGET.vr : STAR_BUDGET.desktop) + CHUNK);
        expect(s.inReach).toBeGreaterThan(vr ? 40_000 : 100_000);
        expect(s.inPool).toBe(s.inReach);
        expect(s.cut).toBeLessThan(vr ? 2.5 : 1.5);
        // the nearest cells drawn are round the eye
        expect(Math.min(...layer.visible.map((e) => e.cell.centre.distanceTo(cam)))).toBeLessThan(5);
      }, 120_000);
    }
  }

  it('leaving for another galaxy and coming back: the stars round the eye are sent again', () => {
    const { layer, from } = make(true);
    const home = at('M87', 0.0177);
    const first = settle(layer, home, from);
    // (M60's cells take the pool from M87's)
    settle(layer, at('M60', 0.003), from);
    const again = settle(layer, home, from);
    expect(again.inPool).toBe(again.inReach);
    expect(again.inReach).toBeGreaterThan(0.8 * first.inReach);
  }, 120_000);

  it('flying through it, what is sent keeps up with the reach', () => {
    const { layer, from } = make(true);
    const cam = at('M87', 0.0177);
    settle(layer, cam, from);
    const workers = TestWorker.all.slice(from);
    let worst = 1;
    for (let f = 0; f < 120; f++) {
      // a light year a frame, through the heart of the galaxy
      cam.x += 0.3;
      layer.update(cam, M_LIM, 0.02, 4);
      const s = layer.reachStats(cam);
      if (s.inReach) worst = Math.min(worst, s.inPool / s.inReach);
      for (const w of workers) w.run(4);
    }
    expect(worst).toBeGreaterThan(0.95);
  }, 120_000);

  it('a star drawn from part of a cell is the same star: its designation is its place in the whole cell', () => {
    const { layer, from } = make(true);
    const cam = at('M87', 0.0177);
    settle(layer, cam, from);
    // stars of cells sent in part (those reaching past MARGIN times the reach from the eye)
    const partial = new Set(layer.visible.filter((e) => !e.whole).map((e) => e.cell.key));
    expect(partial.size).toBeGreaterThan(20);
    const stars: ReturnType<ProceduralStarLayer['star']>[] = [];
    layer.forEachVisible(cam, M_LIM, (_rel, _m, star) => {
      const s = star();
      if (stars.length < 40 && partial.has(s.key.replace(/^ps:|:\d+$/g, ''))) stars.push(s);
    });
    expect(stars.length).toBe(40);
    const gi = gs.findIndex((g) => g.name === 'M87');
    const fr = new InteriorFrame(INTERIOR.models!.get(gs[gi])!, gi);
    for (const s of stars) {
      const [k, ix, iy, iz, i] = /^PS G\d+\.(\d+)\.(-?\d+)\.(-?\d+)\.(-?\d+)-(\d+)$/.exec(s.name)!.slice(1).map(Number);
      // made afresh from the designation alone
      const c = generateGalaxyCell(fr, k, ix, iy, iz);
      const p = new Vector3(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]).add(c.centre);
      expect(p.distanceTo(s.posPc)).toBeLessThan(1e-3);
      expect(s.absMag).toBe(c.absMag[i]);
    }
  }, 120_000);
});

describe('procedural stars in the Milky Way: the same as whole cells, in less room', () => {
  const realWorker = (globalThis as { Worker?: unknown }).Worker;
  beforeAll(() => { (globalThis as { Worker?: unknown }).Worker = TestWorker; });
  afterAll(() => { (globalThis as { Worker?: unknown }).Worker = realWorker; });

  it('towards the Galactic centre (verify scene 17): every star within reach, no cut', () => {
    const from = TestWorker.all.length;
    const layer = new ProceduralStarLayer({}, new DataTexture(), true);
    const cam = new Vector3(603, -2659, 22);
    for (let f = 0; f < 400; f++) {
      layer.update(cam, 7.2, 0.02, 4);
      for (const w of TestWorker.all.slice(from)) w.run(4);
    }
    expect(layer.pending).toBe(0);
    const s = layer.reachStats(cam);
    expect(s.inReach).toBeGreaterThan(5000);
    expect(s.inPool).toBe(s.inReach);
    expect(layer.mGen).toBeCloseTo(7.5, 5);
    // (whole cells took about three times the room)
    const whole = layer.visible.reduce((n, e) => n + e.cell.count, 0);
    expect(layer.drawnStars).toBeLessThan(0.6 * whole);
  }, 120_000);
});
