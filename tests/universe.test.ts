import { describe, expect, it } from 'vitest';
import { uposZero } from '../src/core/hp';
import { AU, C, G, L_SUN, M_EARTH, M_JUP, M_SUN, R_EARTH, R_JUP, R_SUN } from '../src/core/units';
import { GALAXY_LEVELS, UNIVERSE_RADIUS_MPC, WEB_LEVELS, galaxyId, generateGalaxyCell, parseGalaxyId, webDensity } from '../src/universe/cosmicWeb';
import { galaxyDensity, galaxyDensityBound, makeGalaxy } from '../src/universe/galaxy';
import { MILKY_WAY, SUN_LOCAL_PC, milkyWaySuppression } from '../src/universe/milkyWay';
import { equilibriumTemperature, massFromRadius, radiusFromMass } from '../src/universe/planet';
import { solarSystem } from '../src/universe/solarSystem';
import { classifyByPhotometry, makeStar, mainSequenceTeff, parseSpectralType } from '../src/universe/star';
import { STAR_LEVELS, STAR_LEVEL_TABLE, generateStarBlock, generateStarCell, parseStarId, starId } from '../src/universe/starfield';
import { bodyPositions, generateSystem } from '../src/universe/system';
import { buildTerrainPatch, cubeToSphere, surfaceElevation, terrainIndices } from '../src/universe/terrain';
import type { PlanetBody, StarBody, StarType } from '../src/universe/types';

const sysInput = (seed: number, absMag = 4.8, teff = 5700, type: StarType = 'main') => ({ id: `test:${seed}`, name: 'Test', seed, origin: uposZero(), star: { absMag, teff, type, real: false } });

describe('determinism: same coordinates, same universe', () => {
  it('galaxy cells are identical when regenerated', () => {
    for (const [level, x, y, z] of [[2, 3, -7, 11], [5, 100, 200, -300], [GALAXY_LEVELS + 1, -4, 2, 9]] as number[][]) {
      const a = generateGalaxyCell(level!, x!, y!, z!, null);
      const b = generateGalaxyCell(level!, x!, y!, z!, null);
      expect(a.count).toBe(b.count);
      expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
      expect(Array.from(a.seed)).toEqual(Array.from(b.seed));
      expect(Array.from(a.absMag)).toEqual(Array.from(b.absMag));
    }
  });

  it('neighbouring cells differ', () => {
    const a = generateGalaxyCell(4, 10, 10, 10, null);
    const b = generateGalaxyCell(4, 11, 10, 10, null);
    expect(Array.from(a.seed).slice(0, 5)).not.toEqual(Array.from(b.seed).slice(0, 5));
  });

  it('star cells, systems and terrain are reproducible', () => {
    const g = makeGalaxy('g:test', 777, -20.5);
    const a = generateStarCell(g, 12, 3, -2, 0, null);
    const b = generateStarCell(g, 12, 3, -2, 0, null);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    expect(Array.from(a.teff)).toEqual(Array.from(b.teff));
    expect(JSON.stringify(generateSystem(sysInput(4242)))).toBe(JSON.stringify(generateSystem(sysInput(4242))));
    expect(JSON.stringify(generateSystem(sysInput(4242)))).not.toBe(JSON.stringify(generateSystem(sysInput(4243))));
    const sys = generateSystem(sysInput(99));
    const solid = sys.bodies.find((p) => p.kind !== 'star' && (p as PlanetBody).type !== 'gasgiant' && (p as PlanetBody).type !== 'icegiant') as PlanetBody | undefined;
    if (solid) {
      const params = { radius: solid.radius, type: solid.type, surface: solid.surface, tSurface: solid.tSurface };
      const p1 = buildTerrainPatch({ params, face: 2, level: 3, x: 5, y: 1, res: 17 });
      const p2 = buildTerrainPatch({ params, face: 2, level: 3, x: 5, y: 1, res: 17 });
      expect(Array.from(p1.positions)).toEqual(Array.from(p2.positions));
      expect(Array.from(p1.colors)).toEqual(Array.from(p2.colors));
    }
  });

  it('star blocks hold exactly the stars of their cells, whatever the block size', () => {
    const g = makeGalaxy('g:blocks', 4711, -21);
    const level = 13;
    const size = STAR_LEVEL_TABLE[level]!.cell;
    // A patch of disc a few kiloparsecs from the centre: cells 384…387 on x, 0…3 on y and z.
    const base = 384;
    const cells = new Map<string, ReturnType<typeof generateStarCell>>();
    const cellAt = (ix: number, iy: number, iz: number): ReturnType<typeof generateStarCell> => {
      const key = `${ix},${iy},${iz}`;
      let c = cells.get(key);
      if (!c) cells.set(key, (c = generateStarCell(g, level, ix, iy, iz, null)));
      return c;
    };
    const b = g.basis;
    const idsByBlockSize: string[][] = [];
    // The same 4 × 4 × 4 cells generated as one block, as eight blocks and as sixty-four.
    for (const k of [4, 2, 1]) {
      const ids: string[] = [];
      const n = 4 / k;
      for (let bx = 0; bx < n; bx++) for (let by = 0; by < n; by++) for (let bz = 0; bz < n; bz++) {
        const block = generateStarBlock(g, level, k, base / k + bx, by, bz, null);
        for (let i = 0; i < block.count; i++) {
          const [ix, iy, iz] = [block.cell[i * 3]!, block.cell[i * 3 + 1]!, block.cell[i * 3 + 2]!];
          const cell = cellAt(ix, iy, iz);
          const j = Array.from(cell.index).indexOf(block.index[i]!);
          expect(j).toBeGreaterThanOrEqual(0);
          expect(block.seed[i]).toBe(cell.seed[j]);
          expect(block.absMag[i]).toBe(cell.absMag[j]);
          // The canonical offset is the cell's own, bit for bit.
          expect([block.local[i * 3], block.local[i * 3 + 1], block.local[i * 3 + 2]]).toEqual([cell.pos[j * 3], cell.pos[j * 3 + 1], cell.pos[j * 3 + 2]]);
          // Drawing position = cell centre relative to the block centre (galaxy frame → world axes) + that offset.
          const centre = (c: number, bc: number): number => (c + 0.5) * size - (bc + 0.5) * k * size;
          const [cx, cy, cz] = [centre(ix, block.bx), centre(iy, block.by), centre(iz, block.bz)];
          expect(block.pos[i * 3]).toBeCloseTo(b[0] * cx + b[3] * cy + b[6] * cz + cell.pos[j * 3]!, 3);
          expect(block.pos[i * 3 + 1]).toBeCloseTo(b[1] * cx + b[4] * cy + b[7] * cz + cell.pos[j * 3 + 1]!, 3);
          expect(block.pos[i * 3 + 2]).toBeCloseTo(b[2] * cx + b[5] * cy + b[8] * cz + cell.pos[j * 3 + 2]!, 3);
          ids.push(starId(g.id, level, ix, iy, iz, block.index[i]!));
        }
      }
      idsByBlockSize.push(ids.sort());
    }
    expect(idsByBlockSize[0]!.length).toBeGreaterThan(20);
    expect(new Set(idsByBlockSize[0]).size).toBe(idsByBlockSize[0]!.length);
    expect(idsByBlockSize[1]).toEqual(idsByBlockSize[0]);
    expect(idsByBlockSize[2]).toEqual(idsByBlockSize[0]);
  });

  it('stable ids round-trip', () => {
    expect(parseGalaxyId(galaxyId(3, -12, 4, 7, 41))).toEqual({ level: 3, ix: -12, iy: 4, iz: 7, index: 41 });
    expect(parseStarId(starId('g:3:-12:4:7:41', 9, 1, -2, 3, 17))).toEqual({ galaxyId: 'g:3:-12:4:7:41', level: 9, ix: 1, iy: -2, iz: 3, index: 17 });
    expect(parseStarId(starId('mw', 0, 0, 0, 0, 0))?.galaxyId).toBe('mw');
  });

  it('pins a known sample of the universe (guards against accidental generator changes)', () => {
    const cell = generateGalaxyCell(3, 40, -25, 12, null);
    const sys = generateSystem(sysInput(20261119));
    // Snapshot of structural facts; update deliberately if the generators are ever changed on purpose.
    expect({ galaxies: cell.count, firstSeed: cell.seed[0], bodies: sys.bodies.length, kinds: sys.bodies.map((b) => b.kind[0]).join('') }).toMatchSnapshot();
  });
});

describe('cosmic web', () => {
  it('has unit mean density, deep voids and dense knots', () => {
    let sum = 0;
    let min = Infinity;
    let max = 0;
    let voids = 0;
    const n = 40000;
    for (let i = 0; i < n; i++) {
      // Low-discrepancy scan of a (3 Gpc)³ box.
      const rho = webDensity(((i * 0.618034) % 1) * 3000 - 1500, ((i * 0.754878) % 1) * 3000 - 1500, ((i * 0.569840) % 1) * 3000 - 1500);
      sum += rho;
      min = Math.min(min, rho);
      max = Math.max(max, rho);
      if (rho < 0.3) voids++;
    }
    expect(sum / n).toBeGreaterThan(0.93);
    expect(sum / n).toBeLessThan(1.07);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThan(8);
    // Most of the volume is void, as in the real universe.
    expect(voids / n).toBeGreaterThan(0.45);
    // Coarser callers see a smoother field with the same mean, so every level of detail holds the same light.
    for (const detail of [20, 100, 300]) {
      let s = 0;
      for (let i = 0; i < n; i++) s += webDensity(((i * 0.618034) % 1) * 3000 - 1500, ((i * 0.754878) % 1) * 3000 - 1500, ((i * 0.569840) % 1) * 3000 - 1500, detail);
      expect(s / n).toBeGreaterThan(0.93);
      expect(s / n).toBeLessThan(1.07);
    }
  });

  it('keeps every galaxy inside the observable universe with sane magnitudes', () => {
    const edge = Math.floor(UNIVERSE_RADIUS_MPC / WEB_LEVELS[1]!.cell) - 1;
    for (const [level, ix] of [[1, edge], [1, edge + 2], [6, 30]] as number[][]) {
      const c = generateGalaxyCell(level!, ix!, 0, 0, null);
      const size = WEB_LEVELS[level!]!.cell;
      for (let i = 0; i < c.count; i++) {
        const x = (ix! + 0.5) * size + c.pos[i * 3]!;
        const y = 0.5 * size + c.pos[i * 3 + 1]!;
        const z = 0.5 * size + c.pos[i * 3 + 2]!;
        expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(UNIVERSE_RADIUS_MPC + 1e-6);
        expect(c.absMag[i]).toBeGreaterThanOrEqual(WEB_LEVELS[level!]!.magLo);
        expect(c.absMag[i]).toBeLessThanOrEqual(WEB_LEVELS[level!]!.magHi);
      }
    }
    expect(generateGalaxyCell(1, edge + 40, 0, 0, null).count).toBe(0);
  });
});

describe('galaxies and star fields', () => {
  it('generates physically plausible galaxies', () => {
    const types = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const absMag = -24 + (seed % 12);
      const g = makeGalaxy(`g:${seed}`, seed * 7919, absMag);
      types.add(g.type);
      expect(g.radius).toBeGreaterThan(0.2);
      expect(g.radius).toBeLessThan(200);
      expect(g.starCount).toBeGreaterThan(1e5);
      expect(g.starCount).toBeLessThan(1e13);
      expect(g.smbhMassSun).toBeGreaterThan(1e3);
      expect(g.density0).toBeGreaterThan(0);
      // Orientation must be a rotation (orthonormal rows).
      const b = g.basis;
      expect(b[0] * b[0] + b[1] * b[1] + b[2] * b[2]).toBeCloseTo(1, 9);
      expect(b[0] * b[3] + b[1] * b[4] + b[2] * b[5]).toBeCloseTo(0, 9);
      // The rejection-sampling bound really bounds the density.
      for (const [x, y, z] of [[0.1, 0.2, 0.01], [g.hR, -g.hR, 0.05], [g.radius * 0.5, 0, -0.1]] as number[][]) {
        for (let pop = 0; pop < 3; pop++) expect(galaxyDensity(g, x!, y!, z!, pop)).toBeLessThanOrEqual(galaxyDensityBound(g, x!, y!, z!, 0.001, pop) * 1.0001);
      }
    }
    for (const t of ['spiral', 'barred', 'elliptical', 'lenticular', 'irregular', 'dwarf']) expect(types.has(t)).toBe(true);
  });

  it('the Milky Way model has a realistic solar neighbourhood', () => {
    const [x, y, z] = SUN_LOCAL_PC;
    expect(Math.hypot(x, y)).toBeGreaterThan(8200);
    expect(Math.hypot(x, y)).toBeLessThan(8350);
    expect(Math.abs(z)).toBeLessThan(60);
    // Stars per cubic parsec near the Sun: observed ≈ 0.1.
    const rho = MILKY_WAY.density0 * galaxyDensity(MILKY_WAY, x / 1000, y / 1000, z / 1000, 2);
    expect(rho).toBeGreaterThan(0.03);
    expect(rho).toBeLessThan(0.5);
    const total = STAR_LEVEL_TABLE.reduce((s, l) => s + l.fraction, 0);
    expect(total).toBeGreaterThan(0.6);
    expect(total).toBeLessThan(1.2);
    expect(STAR_LEVEL_TABLE.length).toBe(STAR_LEVELS);
  });

  it('never generates a procedural star that the real catalogues already contain', () => {
    const sup = milkyWaySuppression(11.5, 100);
    let checked = 0;
    for (const level of [8, 14, 20, 23]) {
      const L = STAR_LEVEL_TABLE[level]!;
      const size = L.cell;
      const ix = Math.floor(SUN_LOCAL_PC[0] / size);
      const iy = Math.floor(SUN_LOCAL_PC[1] / size);
      const iz = Math.floor(SUN_LOCAL_PC[2] / size);
      // Walk outward along x until we are well past the distance where catalogue completeness ends.
      const reach = Math.max(100, 10 * 10 ** ((11.5 - L.magLo) / 5));
      const steps = Math.ceil(reach / size) + 3;
      const b = MILKY_WAY.basis;
      for (let d = -steps; d <= steps; d++) {
        const cell = generateStarCell(MILKY_WAY, level, ix + d, iy, iz, sup);
        for (let i = 0; i < cell.count; i++) {
          // World-axis offset → galaxy-local → distance from the Sun.
          const [wx, wy, wz] = [cell.pos[i * 3]!, cell.pos[i * 3 + 1]!, cell.pos[i * 3 + 2]!];
          const lx = (ix + d + 0.5) * size + b[0] * wx + b[1] * wy + b[2] * wz - SUN_LOCAL_PC[0];
          const ly = (iy + 0.5) * size + b[3] * wx + b[4] * wy + b[5] * wz - SUN_LOCAL_PC[1];
          const lz = (iz + 0.5) * size + b[6] * wx + b[7] * wy + b[8] * wz - SUN_LOCAL_PC[2];
          const dist = Math.hypot(lx, ly, lz);
          expect(dist).toBeGreaterThanOrEqual(100 - 0.01);
          expect(cell.absMag[i]! + 5 * Math.log10(dist / 10)).toBeGreaterThanOrEqual(11.5 - 1e-3);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('stars', () => {
  it('reproduces the Sun from its magnitude and temperature', () => {
    const sun = makeStar(4.67, 5772, 'main', 1);
    expect(sun.luminosity / L_SUN).toBeGreaterThan(0.93);
    expect(sun.luminosity / L_SUN).toBeLessThan(1.07);
    expect(sun.radius / R_SUN).toBeGreaterThan(0.95);
    expect(sun.radius / R_SUN).toBeLessThan(1.05);
    expect(sun.mass / M_SUN).toBeGreaterThan(0.9);
    expect(sun.mass / M_SUN).toBeLessThan(1.1);
    expect(sun.spectral.startsWith('G')).toBe(true);
  });

  it('keeps every star type within physical ranges', () => {
    const cases: Array<[number, number, StarType]> = [[-6, 30000, 'supergiant'], [-5, 3600, 'supergiant'], [0.5, 4700, 'giant'], [1.4, 9900, 'main'], [8, 4000, 'main'], [13, 3000, 'main'], [12, 12000, 'whitedwarf'], [11, 0, 'neutron'], [11, 0, 'pulsar'], [11, 0, 'blackhole'], [19, 1500, 'browndwarf']];
    for (const [m, t, type] of cases) {
      for (let seed = 1; seed < 20; seed++) {
        const s = makeStar(m, t, type, seed);
        expect(s.mass).toBeGreaterThan(0.01 * M_SUN);
        expect(s.mass).toBeLessThan(200 * M_SUN);
        expect(s.radius).toBeGreaterThan(5000);
        expect(s.radius).toBeLessThan(2500 * R_SUN);
        if (type === 'whitedwarf') expect(s.radius).toBeLessThan(4 * R_EARTH);
        if (type === 'neutron' || type === 'pulsar') expect(s.radius).toBeLessThan(20_000);
        if (type === 'blackhole') expect(s.schwarzschildRadius).toBeCloseTo((2 * G * s.mass) / (C * C), 3);
        if (type === 'supergiant') expect(s.radius).toBeGreaterThan(8 * R_SUN);
      }
    }
    expect(mainSequenceTeff(4.67)).toBeCloseTo(5772, -1);
    expect(classifyByPhotometry(12.5, 0.2, false)).toBe('whitedwarf');
    expect(classifyByPhotometry(0.6, 1.2, false)).toBe('giant');
    expect(classifyByPhotometry(4.7, 0.82, false)).toBe('main');
    expect(classifyByPhotometry(-6, 0.1, false)).toBe('supergiant');
  });
});

describe('catalogued spectral types', () => {
  it('give temperature and luminosity class, whatever dust has done to the colour', () => {
    expect(parseSpectralType('G2V')).toEqual({ teff: 5798, type: 'main' });
    expect(parseSpectralType('B0Ib')!.type).toBe('supergiant');
    expect(parseSpectralType('B0Ib')!.teff).toBeGreaterThan(28000);
    expect(parseSpectralType('M2Iab')!.type).toBe('supergiant');
    expect(parseSpectralType('M2Iab')!.teff).toBeCloseTo(3540, -1);
    const arcturus = parseSpectralType('K1.5III')!;
    expect(arcturus.type).toBe('giant');
    expect(arcturus.teff).toBeGreaterThan(4200);
    expect(arcturus.teff).toBeLessThan(4700);
    expect(parseSpectralType('A0m...')).toEqual({ teff: 9700, type: null });
    expect(parseSpectralType('sdB5')!.teff).toBeCloseTo(20550, -1);
    expect(parseSpectralType('DA2')).toBeNull();
    expect(parseSpectralType('')).toBeNull();
  });

  it('are used for real stars: a reddened blue supergiant is modelled as one', () => {
    // Colour alone says "cool giant" (as for the donor star of Cygnus X-1, seen through 2 kpc of dust).
    const byColour = generateSystem({ ...sysInput(1, -3.15, 4692, 'giant'), star: { absMag: -3.15, teff: 4692, type: 'giant', real: true } });
    const byType = generateSystem({ ...sysInput(1, -3.15, 4692, 'giant'), star: { absMag: -3.15, teff: 4692, type: 'giant', real: true, spectral: 'B0Ib' } });
    const a = (byColour.bodies[0] as StarBody).star;
    const b = (byType.bodies[0] as StarBody).star;
    expect(a.type).toBe('giant');
    expect(b.type).toBe('supergiant');
    expect(b.teff).toBeGreaterThan(28000);
    expect(b.spectral).toBe('B0Ib');
    // Procedural stars are never second-guessed.
    const proc = generateSystem({ ...sysInput(1, -3.15, 4692, 'giant'), star: { absMag: -3.15, teff: 4692, type: 'giant', real: false, spectral: 'B0Ib' } });
    expect((proc.bodies[0] as StarBody).star.type).toBe('giant');
  });
});

describe('planetary systems', () => {
  it('follows the mass–radius relation and its inverse', () => {
    expect(radiusFromMass(1)).toBeCloseTo(1, 1);
    expect(radiusFromMass(318)).toBeGreaterThan(9);
    expect(radiusFromMass(318)).toBeLessThan(16);
    for (const r of [0.5, 1, 3, 8]) expect(radiusFromMass(massFromRadius(r))).toBeCloseTo(r, 4);
    expect(equilibriumTemperature(1, 1, 0.3)).toBeGreaterThan(245);
    expect(equilibriumTemperature(1, 1, 0.3)).toBeLessThan(265);
  });

  it('generates believable systems', () => {
    let withPlanets = 0;
    let binaries = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const absMag = 2 + (seed % 12);
      const sys = generateSystem(sysInput(seed * 104729, absMag, mainSequenceTeff(absMag)));
      const stars = sys.bodies.filter((b) => b.kind === 'star') as StarBody[];
      const planets = sys.bodies.filter((b) => b.kind === 'planet') as PlanetBody[];
      if (planets.length) withPlanets++;
      if (stars.length > 1) binaries++;
      expect(stars.length).toBeGreaterThanOrEqual(1);
      expect(stars.length).toBeLessThanOrEqual(3);
      expect(planets.length).toBeLessThanOrEqual(10);
      // Parents always precede children; orbits are bound and ordered outward.
      sys.bodies.forEach((b, i) => expect(b.parent).toBeLessThan(i));
      let last = 0;
      for (const p of planets) {
        const o = p.orbit!;
        expect(o.e).toBeGreaterThanOrEqual(0);
        expect(o.e).toBeLessThan(0.98);
        expect(o.a).toBeGreaterThan(last);
        last = o.a;
        expect(o.a).toBeGreaterThan(stars[0]!.radius);
        expect(o.a).toBeLessThan(2000 * AU);
        // Kepler's third law. Circumbinary planets (parent −1) circle the close inner pair of stars.
        const host = p.parent >= 0 ? sys.bodies[p.parent]!.mass : stars[0]!.mass + stars[1]!.mass;
        expect(o.period / (2 * Math.PI * Math.sqrt(o.a ** 3 / (G * (host + p.mass))))).toBeCloseTo(1, 6);
        expect(p.mass).toBeGreaterThan(1e-4 * M_EARTH);
        expect(p.mass).toBeLessThan(15 * M_JUP);
        expect(p.radius).toBeGreaterThan(200_000);
        expect(p.radius).toBeLessThan(2.2 * R_JUP);
        expect(p.gravity).toBeGreaterThan(0.01);
        expect(p.teq).toBeGreaterThan(3);
        expect(p.teq).toBeLessThan(8000);
        expect(p.habitableZone).toBe(o.a >= sys.hzInner && o.a <= sys.hzOuter);
        if (p.rings) expect(p.rings.inner).toBeGreaterThan(p.radius);
      }
      for (const m of sys.bodies.filter((b) => b.kind === 'moon') as PlanetBody[]) {
        const parent = sys.bodies[m.parent] as PlanetBody;
        expect(m.mass).toBeLessThan(parent.mass * 0.05);
        expect(m.orbit!.a).toBeGreaterThan(parent.radius * 2);
        // Inside the parent's Hill sphere.
        expect(m.orbit!.a).toBeLessThan(parent.orbit!.a * Math.cbrt(parent.mass / (3 * stars[0]!.mass)));
      }
      const pos = bodyPositions(sys, 1e7, new Float64Array(sys.bodies.length * 3));
      for (const v of pos) expect(Number.isFinite(v)).toBe(true);
    }
    expect(withPlanets).toBeGreaterThan(250);
    expect(binaries).toBeGreaterThan(60);
    expect(binaries).toBeLessThan(300);
  });

  it('the real Solar System is where it should be', () => {
    const sol = solarSystem();
    const names = sol.bodies.map((b) => b.name);
    for (const n of ['Sun', 'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Moon', 'Titan', 'Io']) expect(names).toContain(n);
    const earth = sol.bodies.find((b) => b.name === 'Earth')!;
    const moon = sol.bodies.find((b) => b.name === 'Moon')!;
    expect(earth.orbit!.period / 86400).toBeCloseTo(365.256, 2);
    expect(moon.orbit!.period / 86400).toBeCloseTo(27.3217, 3);
    expect(earth.radius).toBeCloseTo(6.371e6, -4);
    // Earth–Sun distance stays between perihelion and aphelion; Moon–Earth near 384,400 km.
    const pos = bodyPositions(sol, 8.4e8, new Float64Array(sol.bodies.length * 3));
    const ei = sol.bodies.indexOf(earth);
    const mi = sol.bodies.indexOf(moon);
    const dSun = Math.hypot(pos[ei * 3]!, pos[ei * 3 + 1]!, pos[ei * 3 + 2]!) / AU;
    expect(dSun).toBeGreaterThan(0.98);
    expect(dSun).toBeLessThan(1.02);
    const dMoon = Math.hypot(pos[mi * 3]! - pos[ei * 3]!, pos[mi * 3 + 1]! - pos[ei * 3 + 1]!, pos[mi * 3 + 2]! - pos[ei * 3 + 2]!);
    expect(dMoon).toBeGreaterThan(3.5e8);
    expect(dMoon).toBeLessThan(4.1e8);
  });
});

describe('terrain', () => {
  const params = { radius: 6.371e6, type: 'ocean' as const, tSurface: 288, surface: (solarSystem().bodies.find((b) => b.name === 'Earth') as PlanetBody).surface };

  it('maps the cube onto the unit sphere', () => {
    const d: [number, number, number] = [0, 0, 0];
    for (let face = 0; face < 6; face++) {
      for (const [u, v] of [[-1, -1], [0, 0], [0.3, -0.8], [1, 1]] as number[][]) {
        cubeToSphere(face, u!, v!, d);
        expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12);
      }
    }
  });

  it('builds watertight, finite patches whose edges meet their neighbours', () => {
    const a = buildTerrainPatch({ params, face: 0, level: 4, x: 3, y: 5, res: 17 });
    const b = buildTerrainPatch({ params, face: 0, level: 4, x: 4, y: 5, res: 17 });
    for (const v of a.positions) expect(Number.isFinite(v)).toBe(true);
    expect(a.maxHeight - a.minHeight).toBeLessThan(params.surface.relief * 1.5);
    // Right edge of A == left edge of B (same vertices in planet coordinates).
    for (let j = 0; j < 17; j++) {
      const ia = (j * 17 + 16) * 3;
      const ib = j * 17 * 3;
      for (let c = 0; c < 3; c++) expect(a.positions[ia + c]! + a.origin[c]!).toBeCloseTo(b.positions[ib + c]! + b.origin[c]!, 1);
    }
    const idx = terrainIndices(17);
    expect(Math.max(...idx)).toBe(17 * 17 + 4 * 17 - 1);
    expect(idx.length % 3).toBe(0);
  });

  it('gives Earth about the right share of ocean and sane elevations', () => {
    let sea = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const z = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - z * z);
      const phi = i * 2.399963;
      const h = surfaceElevation(params, r * Math.cos(phi), r * Math.sin(phi), z, 8);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(30_000);
      if (h === 0) sea++;
    }
    expect(sea / n).toBeGreaterThan(0.5);
    expect(sea / n).toBeLessThan(0.88);
  });
});
