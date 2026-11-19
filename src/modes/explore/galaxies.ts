/**
 * Galaxy-scale world management:
 *   - procedural cosmic-web cells (galaxies + glow) around the camera
 *   - which galaxies are close enough to be drawn as resolved volumes
 *   - which galaxy the camera is inside, and that galaxy's procedural star cells
 */
import * as THREE from 'three';
import { DEG, raDecToUnit } from '../../core/astro';
import { hashInts } from '../../core/hash';
import { type UPos, uposAdd, uposFromMeters, uposSub, uposToMeters } from '../../core/hp';
import { KPC, MPC, PC } from '../../core/units';
import type { Catalog } from '../../data/catalog';
import type { CatalogStreamer } from '../../data/catalogStreamer';
import { galaxyAbsMag, galaxyPosition } from '../../data/decode';
import {
  GAL_BAND_K, GAL_BAND_MASK, GAL_FLAG_AGN, GAL_FLAG_STARBURST, GAL_MORPH_MASK, GAL_MORPH_SHIFT, dqGalColor, dqGalPa, dqGalRatio, dqGalSize, dqNameDec, dqNameRa, dqRedshift,
  jName, twoMassName,
} from '../../data/format/schema';
import { comovingDistanceMpc } from '../../core/cosmology';
import type { WorkerPool } from '../../data/workerPool';
import { GalaxyRenderer, type GalaxyView } from '../../render/galaxyRenderer';
import type { Engine } from '../../render/engine';
import type { PointLayer } from '../../render/pointLayer';
import { GALAXY_MAG_LIMIT, STAR_MAG_LIMIT } from '../../render/qualityTiers';
import { GAL_FLAG_QUASAR, type GalaxyCell, WEB_LEVELS, galaxyId, webLevelRadius } from '../../universe/cosmicWeb';
import { galaxyDensity, galaxyDensityBound, makeGalaxy, worldToGalaxy } from '../../universe/galaxy';
import { MILKY_WAY, MILKY_WAY_CENTER, milkyWaySuppression } from '../../universe/milkyWay';
import { STAR_LEVELS, STAR_LEVEL_TABLE, type StarBlock, expectedStarCount, levelRadius } from '../../universe/starfield';
import type { SystemInput } from '../../universe/system';
import type { GalaxyModel } from '../../universe/types';
import { CellGrid, type CellLevel } from './cellGrid';
import { GROUP_GLOW, GROUP_PROCEDURAL } from './world';

/** A galaxy the world currently knows in full (model + where it is). */
export interface GalaxyEntry {
  model: GalaxyModel;
  center: UPos;
  /** Point-layer key and row the entry came from ('' for the Milky Way). */
  key: string;
  index: number;
  /** Catalogue designation for real galaxies (e.g. "2MASX J00424433+4116074"). */
  designation?: string;
  /** Redshift for real galaxies. */
  redshift?: number;
  /** Catalogued heliocentric radial velocity, km/s (negative = approaching). */
  velocity?: number;
  /** How the distance was measured, when it is not simply the redshift (Updated Nearby Galaxy Catalog method code). */
  distMethod?: string;
}

/** Catalogue facts carried by a named galaxy's names-table record. */
function recordFacts(extra: Record<string, string | number> | undefined): { hubbleClass?: string; velocity?: number; distMethod?: string } {
  if (!extra) return {};
  return {
    hubbleClass: typeof extra.hubble === 'string' && extra.hubble ? extra.hubble : undefined,
    velocity: typeof extra.cz === 'number' ? extra.cz : undefined,
    distMethod: typeof extra.distMethod === 'string' && extra.distMethod ? extra.distMethod : undefined,
  };
}

const tmp = { x: 0, y: 0, z: 0 };
const WEB_PREFIX = 'web:';
const STAR_PREFIX = 'sc:';
/** Star-grid level ids pack the magnitude level and the block size (in cells): id = level × STAR_K + k. */
const STAR_K = 4096;
/** A star level's visibility radius is covered by blocks at most this many times smaller. */
const STAR_BLOCKS_PER_RADIUS = 1.25;

/** Angular-size proxy used to rank galaxies: physical radius (kpc) from luminosity, as in the point shader. */
const radiusFromMag = (absMag: number): number => 14 * Math.pow(10, -0.133 * (absMag + 21));

export class GalaxyManager {
  readonly renderer: GalaxyRenderer;
  /** The galaxy the camera is inside (or right next to), if any. */
  current: GalaxyEntry | null = null;
  /** Distance from the camera to the edge of the nearest galaxy, metres (≥ a small positive number). */
  nearestEdge = MPC;
  nearest: GalaxyEntry | null = null;
  /** Distance to the nearest galaxy's centre in units of its radius (< 1 = inside). */
  nearestRatio = 0;
  readonly milkyWay: GalaxyEntry = { model: MILKY_WAY, center: MILKY_WAY_CENTER, key: '', index: -1 };
  readonly webGrid: CellGrid<GalaxyCell>;
  readonly starGrid: CellGrid<StarBlock>;
  /** Current apparent-magnitude limit for procedural stars (adapts to local density). */
  starMagLimit = 7.5;
  /** False where the real catalogue covers every star that could be seen (around the Sun): nothing procedural is drawn. */
  proceduralStars = false;

  private readonly entries = new Map<string, GalaxyEntry>();
  private resolved: Array<{ entry: GalaxyEntry; px: number }> = [];
  private readonly views: GalaxyView[] = [];
  private heroView: GalaxyView | null = null;
  private heroFade = 0;
  private scanTimer = 0;
  private gridTimer = 0;
  private starGalaxy: GalaxyEntry | null = null;
  /** Feedback corrections that keep the points actually sent to the GPU within the tier's budgets. */
  private starAdjust = 0;
  private starCooldown = 0;
  private webScale = 1;
  private webCooldown = 0;
  private lssReady = false;
  private pinned: GalaxyEntry | null = null;
  private readonly suppression;

  constructor(
    private readonly engine: Engine,
    private readonly catalog: Catalog,
    private readonly pool: WorkerPool,
    private readonly galaxyLayer: PointLayer,
    starLayer: PointLayer,
    private readonly streams: CatalogStreamer[],
  ) {
    this.renderer = new GalaxyRenderer(engine.renderer, engine.background, engine.noise, engine.post.isHdr);
    const params = catalog.manifest.params ?? {};
    this.suppression = milkyWaySuppression(params.gaiaGLimit ?? 11.5, params.nearRadiusPc ?? 100);

    this.webGrid = new CellGrid<GalaxyCell>(
      {
        prefix: WEB_PREFIX,
        request: (level, ix, iy, iz) => {
          const job = this.pool.run('galaxyCell', { level, ix, iy, iz, real: this.lssReady }, { priority: 6 });
          return { promise: job.promise.then((r) => ({ chunk: r.chunk, extra: r.cell })), cancel: job.cancel };
        },
        anchor: (level, ix, iy, iz) => {
          const s = WEB_LEVELS[level]!.cell * MPC;
          return uposFromMeters((ix + 0.5) * s, (iy + 0.5) * s, (iz + 0.5) * s);
        },
        options: (level) => {
          const L = WEB_LEVELS[level]!;
          // Glow dots are small (1/40 of a cell) and live in a shell of distances: a sight line
          // crosses only a handful of them, which keeps the fill-rate cost of the whole web to a few screens.
          return { group: L.glow ? GROUP_GLOW : GROUP_PROCEDURAL, glowSize: L.glow ? L.cell / 40 : 1, maxDist: this.webRadius(level), trim: 1.14 };
        },
      },
      galaxyLayer,
    );

    this.starGrid = new CellGrid<StarBlock>(
      {
        prefix: STAR_PREFIX,
        request: (id, bx, by, bz) => {
          const g = this.starGalaxy!.model;
          const level = Math.floor(id / STAR_K);
          const k = id % STAR_K;
          const L = STAR_LEVEL_TABLE[level]!;
          const size = L.cell * k;
          // Skip blocks that are certainly empty without bothering a worker.
          const bound = galaxyDensityBound(g, ((bx + 0.5) * size) / 1000, ((by + 0.5) * size) / 1000, ((bz + 0.5) * size) / 1000, size / 2000, L.pop);
          if (g.density0 * L.fraction * bound * size * size * size < 0.002) return null;
          const job = this.pool.run('starBlock', { galaxy: g, level, k, bx, by, bz, suppress: g.id === 'mw' ? this.suppression : null }, { priority: 4 + level * 0.1 });
          return { promise: job.promise.then((r) => ({ chunk: r.chunk, extra: r.cell })), cancel: job.cancel };
        },
        anchor: (id, bx, by, bz) => {
          const s = STAR_LEVEL_TABLE[Math.floor(id / STAR_K)]!.cell * (id % STAR_K);
          return this.galaxyPoint(this.starGalaxy!, (bx + 0.5) * s, (by + 0.5) * s, (bz + 0.5) * s);
        },
        options: (id) => ({ group: GROUP_PROCEDURAL, glowSize: 1, maxDist: levelRadius(Math.floor(id / STAR_K), this.starMagLimit) }),
      },
      starLayer,
    );

    // Real large-scale structure (for galaxy suppression + density blending) arrives in the background.
    void catalog.lssBytes().then(async (bytes) => {
      if (!bytes) return;
      try {
        await this.pool.broadcast('setLss', { bytes, twoMrsLimit: (params.twoMrsKLimit ?? 11.75) + 2.7, avoidanceDeg: 8, sdssLimit: params.sdssRLimit ?? 17.77 });
        this.lssReady = true;
        // Cells near the Milky Way generated before the real data arrived are rebuilt with it.
        this.webGrid.clear();
      } catch (err) {
        console.warn('Starfarer: large-scale-structure data unavailable', err);
      }
    });
  }

  /** Interest radius (Mpc) of a cosmic-web level for the current tier. */
  private webRadius(level: number): number {
    const tier = this.engine.tier;
    const L = WEB_LEVELS[level]!;
    const cells = (tier.name === 'low' ? 1.3 : tier.name === 'medium' ? 1.9 : 2.5) * this.webScale;
    if (L.glow) return L.cell * (cells + 0.3);
    const magLimit = GALAXY_MAG_LIMIT[tier.name];
    return Math.max(L.cell * 0.6, Math.min(webLevelRadius(level, magLimit), L.cell * cells));
  }

  /** Universe position of a point given in a galaxy's own frame (parsecs). */
  galaxyPoint(entry: GalaxyEntry, lx: number, ly: number, lz: number): UPos {
    const b = entry.model.basis;
    return uposAdd(entry.center, { x: (b[0] * lx + b[3] * ly + b[6] * lz) * PC, y: (b[1] * lx + b[4] * ly + b[7] * lz) * PC, z: (b[2] * lx + b[5] * ly + b[8] * lz) * PC });
  }

  /**
   * Canonical universe position of a procedural star: the centre of its cell plus its offset
   * (world axes, parsecs) inside the cell. Independent of how cells are grouped for drawing.
   */
  starPosition(entry: GalaxyEntry, level: number, ix: number, iy: number, iz: number, ox: number, oy: number, oz: number): UPos {
    const s = STAR_LEVEL_TABLE[level]!.cell;
    const p = this.galaxyPoint(entry, (ix + 0.5) * s, (iy + 0.5) * s, (iz + 0.5) * s);
    return uposAdd(p, { x: ox * PC, y: oy * PC, z: oz * PC });
  }

  /** The galaxy whose procedural stars are currently loaded. */
  get starHost(): GalaxyEntry | null {
    return this.starGalaxy;
  }

  /** Build (and cache) the full model for a galaxy point in the galaxy layer. */
  entryFor(key: string, index: number): GalaxyEntry | null {
    const id = `${key}#${index}`;
    const hit = this.entries.get(id);
    if (hit) return hit;
    let entry: GalaxyEntry | null = null;
    if (this.webGrid.owns(key)) {
      const cell = this.webGrid.cell(key);
      const chunk = this.galaxyLayer.getChunk(key);
      if (!cell || !chunk || WEB_LEVELS[cell.id]!.glow) return null;
      const c = cell.extra;
      const model = makeGalaxy(galaxyId(cell.id, cell.ix, cell.iy, cell.iz, c.index[index]!), c.seed[index]!, c.absMag[index]!, { real: false, quasar: (c.flags[index]! & GAL_FLAG_QUASAR) !== 0 });
      entry = { model, key, index, center: uposAdd(chunk.anchor, { x: c.pos[index * 3]! * MPC, y: c.pos[index * 3 + 1]! * MPC, z: c.pos[index * 3 + 2]! * MPC }) };
    } else {
      const stream = this.streams.find((s) => key.startsWith(`${s.ds.manifest.id}:`));
      const tile = stream?.chunk(key);
      if (!stream || !tile) return null;
      const col = tile.data.columns;
      const ra = col.ra![index]!;
      const dec = col.dec![index]!;
      const zc = col.z![index]!;
      const quasar = stream.ds.manifest.kind === 'quasars';
      const flags = col.flags ? col.flags[index]! : 0;
      const z = dqRedshift(zc);
      const dMpc = comovingDistanceMpc(z);
      const sizeArcmin = col.size ? dqGalSize(col.size[index]!) : null;
      const note = this.catalog.galaxyNote(ra, dec, zc);
      const nameId = tile.data.refRows.indexOf(index);
      const named = nameId >= 0 ? this.catalog.names.peek(tile.data.refIds[nameId]!) : undefined;
      const designation = quasar || stream.ds.manifest.id === 'sdss' ? `SDSS J${jName(ra, dec)}` : `2MASX J${twoMassName(ra, dec)}`;
      const [x, y, zz] = galaxyPosition(ra, dec, zc);
      const los = raDecToUnit(dqNameRa(ra), dqNameDec(dec));
      const facts = recordFacts(named?.extra);
      const model = makeGalaxy(`${quasar ? 'qso' : stream.ds.manifest.id}:J${jName(ra, dec)}`, hashInts(0x9a1, ra, dec, zc), tile.data.absMag[index]!, {
        real: true, name: named?.names[0] ?? designation, morph: (flags >> GAL_MORPH_SHIFT) & GAL_MORPH_MASK, hubbleClass: facts.hubbleClass,
        color: col.color ? dqGalColor(col.color[index]!) : null, colorBand: (flags & GAL_BAND_MASK) === GAL_BAND_K ? 'jk' : 'gr',
        // Angular size → physical size at the galaxy's (angular-diameter) distance.
        diameterKpc: sizeArcmin ? ((sizeArcmin / 60) * DEG * dMpc * 1000) / (1 + z) : null,
        axisRatio: col.ratio ? dqGalRatio(col.ratio[index]!) : null, positionAngle: col.pa ? dqGalPa(col.pa[index]!) : null, lineOfSight: los,
        agn: (flags & GAL_FLAG_AGN) !== 0, starburst: (flags & GAL_FLAG_STARBURST) !== 0, quasar,
        smbhMassSun: note?.smbhMassSun, jet: note ? note.jet === 1 : undefined,
      });
      entry = { model, key, index, center: uposFromMeters(x * MPC, y * MPC, zz * MPC), designation, redshift: z, velocity: facts.velocity, distMethod: facts.distMethod };
    }
    if (this.entries.size > 400) this.entries.clear();
    this.entries.set(id, entry);
    return entry;
  }

  /** Build the entry of a named real galaxy straight from its names-table record (search results). */
  entryFromRecord(record: { names: string[]; a: number; b: number; c: number; ds: string; extra?: Record<string, string | number> }): GalaxyEntry {
    const id = `rec:${record.a}-${record.b}-${record.c}`;
    const hit = this.entries.get(id);
    if (hit) return hit;
    const q = typeof record.extra?.q === 'string' ? record.extra.q.split(',').map(Number) : [255, 255, 0, 255, 255, 255];
    const [magCode, colorCode, flags, sizeCode, ratioCode, paCode] = q as [number, number, number, number, number, number];
    const z = dqRedshift(record.c);
    const dMpc = comovingDistanceMpc(z);
    const sizeArcmin = dqGalSize(sizeCode);
    const note = this.catalog.galaxyNote(record.a, record.b, record.c);
    const [x, y, zz] = galaxyPosition(record.a, record.b, record.c);
    const facts = recordFacts(record.extra);
    const model = makeGalaxy(`galaxies:J${jName(record.a, record.b)}`, hashInts(0x9a1, record.a, record.b, record.c), galaxyAbsMag(magCode, flags, record.c), {
      real: true, name: record.names[0], morph: (flags >> GAL_MORPH_SHIFT) & GAL_MORPH_MASK, hubbleClass: facts.hubbleClass, color: dqGalColor(colorCode), colorBand: (flags & GAL_BAND_MASK) === GAL_BAND_K ? 'jk' : 'gr',
      diameterKpc: sizeArcmin ? ((sizeArcmin / 60) * DEG * dMpc * 1000) / (1 + z) : null, axisRatio: dqGalRatio(ratioCode), positionAngle: dqGalPa(paCode),
      lineOfSight: raDecToUnit(dqNameRa(record.a), dqNameDec(record.b)), agn: (flags & GAL_FLAG_AGN) !== 0, starburst: (flags & GAL_FLAG_STARBURST) !== 0,
      smbhMassSun: note?.smbhMassSun, jet: note ? note.jet === 1 : undefined,
    });
    const entry: GalaxyEntry = { model, key: '', index: -1, center: uposFromMeters(x * MPC, y * MPC, zz * MPC), designation: `2MASX J${twoMassName(record.a, record.b)}`, redshift: z, velocity: facts.velocity, distMethod: facts.distMethod };
    this.entries.set(id, entry);
    return entry;
  }

  /** The central black hole of a galaxy as a star-system input (visited like any other system). */
  coreInput(entry: GalaxyEntry): SystemInput {
    const g = entry.model;
    return {
      id: `${g.id}/core`, name: `${g.name} central black hole`, seed: hashInts(g.seed, 0xc02e), origin: entry.center,
      star: { absMag: 6, teff: 0, type: 'blackhole', real: g.real },
      compact: { massSun: g.smbhMassSun, accretion: Math.max(0.14, g.activity), jet: g.jet },
      noPlanets: true,
    };
  }

  /** Force a specific galaxy into the resolved set (autopilot destination), so it is modelled before we arrive. */
  pin(entry: GalaxyEntry | null): void {
    this.pinned = entry;
  }

  update(camPos: UPos, dt: number): void {
    const engine = this.engine;
    const tier = engine.tier;
    const focal = engine.pixelsPerRadian;

    // ---- Cosmic-web cells.
    this.gridTimer -= dt;
    if (this.gridTimer <= 0) {
      this.gridTimer = 0.35;
      // Keep the web's share of the point budget: thin its reach a little if too much reached the GPU.
      this.webCooldown -= 0.35;
      if (this.webCooldown <= 0) {
        const points = this.webGrid.points;
        // Out between the galaxies there are no stars to draw, so their share of the point budget goes to the web.
        const idle = Math.min(1, Math.max(0, (this.nearestRatio - 1.5) / 4));
        const budget = tier.proceduralGalaxies + idle * (tier.proceduralStars + 0.5 * tier.catalogStars);
        if (points > budget * 1.1 && this.webScale > 0.6) {
          this.webScale -= 0.06;
          this.webCooldown = 1.5;
        } else if (points < budget * 0.6 && this.webScale < 1 && this.webGrid.pending === 0) {
          this.webScale = Math.min(1, this.webScale + 0.06);
          this.webCooldown = 1.5;
        }
      }
      const levels: CellLevel[] = WEB_LEVELS.map((L, i) => ({ id: i, size: L.cell, radius: this.webRadius(i) }));
      uposToMeters(camPos, tmp);
      this.webGrid.update(levels, tmp.x / MPC, tmp.y / MPC, tmp.z / MPC);
      this.updateStars(camPos);
    }

    // ---- Which galaxies are resolved? Scan the point layer a couple of times per second.
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.4;
      const found: Array<{ key: string; index: number; px: number; ratio: number }> = [];
      const minPx = 5;
      this.galaxyLayer.forEachChunk((key, _anchor, data, cam) => {
        // Chunk-level reject: even the largest galaxy (~60 kpc radius) would be unresolved from this far.
        const dc = Math.hypot(cam[0], cam[1], cam[2]) - data.radius;
        if (dc > 0 && (0.06 / dc) * focal < minPx) return;
        const pos = data.positions;
        const mag = data.absMag;
        const style = data.colors;
        for (let i = 0; i < data.count; i++) {
          const st = style[i * 4 + 3]!;
          if (st !== 3 && st !== 4) continue;
          const d = Math.hypot(pos[i * 3]! - cam[0], pos[i * 3 + 1]! - cam[1], pos[i * 3 + 2]! - cam[2]);
          const rKpc = radiusFromMag(mag[i]!);
          const px = ((rKpc * 1e-3) / Math.max(d, 1e-9)) * focal;
          if (px >= minPx) found.push({ key, index: i, px, ratio: (d * 1000) / rKpc });
        }
      });
      found.sort((a, b) => b.px - a.px);
      const resolved: Array<{ entry: GalaxyEntry; px: number }> = [];
      for (const f of found.slice(0, tier.galaxyImpostors)) {
        const entry = this.entryFor(f.key, f.index);
        if (entry) resolved.push({ entry, px: f.px });
      }
      this.resolved = resolved;
    }

    // ---- Per-frame: distances, current galaxy, hero and impostor views.
    let nearest: GalaxyEntry | null = null;
    let nearestRatio = Infinity;
    let nearestEdge = Infinity;
    const consider = (entry: GalaxyEntry): number => {
      uposSub(entry.center, camPos, tmp);
      const d = Math.hypot(tmp.x, tmp.y, tmp.z);
      const r = entry.model.radius * KPC;
      const ratio = d / r;
      if (ratio < nearestRatio) {
        nearestRatio = ratio;
        nearest = entry;
      }
      nearestEdge = Math.min(nearestEdge, Math.max(d - r, r * 0.02));
      return d;
    };
    consider(this.milkyWay);
    this.views.length = 0;
    let heroCandidate: GalaxyEntry | null = null;
    let heroPx = 0;
    const list = [...this.resolved];
    if (!list.some((r) => r.entry === this.milkyWay)) list.push({ entry: this.milkyWay, px: 0 });
    if (this.pinned && !list.some((r) => r.entry.model.id === this.pinned!.model.id)) list.push({ entry: this.pinned, px: 0 });
    for (const r of list) {
      const d = consider(r.entry);
      const radius = r.entry.model.radius * KPC;
      const px = (radius / Math.max(d, radius * 0.05)) * focal;
      if (px < 3) continue;
      // The galaxy that looms largest becomes the hero once it is big on screen or we are inside it.
      if (px > heroPx && (d < radius * 2.6 || px > engine.renderHeight * 0.3)) {
        heroPx = px;
        heroCandidate = r.entry;
      }
    }
    for (const r of list) {
      if (r.entry === heroCandidate) continue;
      uposSub(r.entry.center, camPos, tmp);
      const d = Math.hypot(tmp.x, tmp.y, tmp.z);
      const radius = r.entry.model.radius * KPC;
      const px = (radius / Math.max(d, 1)) * focal;
      if (px < 3 || d < radius * 1.2) continue;
      this.views.push({ model: r.entry.model, rel: new THREE.Vector3(tmp.x, tmp.y, tmp.z), opacity: Math.min(1, (px - 3) / 6) });
    }
    this.nearest = nearest;
    this.nearestEdge = nearestEdge;
    this.nearestRatio = nearestRatio;
    const inside = nearest !== null && nearestRatio < 1.25;
    this.current = inside ? nearest : null;

    if (heroCandidate) {
      if (!this.heroView || this.heroView.model !== (heroCandidate as GalaxyEntry).model) {
        this.heroView = { model: (heroCandidate as GalaxyEntry).model, rel: new THREE.Vector3(), opacity: 0 };
        this.heroFade = this.heroView.model.id === 'mw' && this.heroFade === 0 ? 1 : 0;
      }
      uposSub((heroCandidate as GalaxyEntry).center, camPos, tmp);
      this.heroView.rel.set(tmp.x, tmp.y, tmp.z);
      this.heroFade = Math.min(1, this.heroFade + dt * 1.5);
      this.heroView.opacity = this.heroFade;
    } else if (this.heroView) {
      this.heroFade -= dt * 2;
      if (this.heroFade <= 0) this.heroView = null;
      else this.heroView.opacity = this.heroFade;
    }
    this.renderer.update(this.heroView, this.views, engine.camera, engine.renderWidth, engine.renderHeight, tier);
    this.galaxyLayer.resolvePx = 6;
    // Leaving a galaxy drops its procedural stars at once (the next grid update repopulates).
    if (this.current !== this.starGalaxy && !this.current) this.updateStars(camPos);
  }

  /** Procedural stars of the galaxy we are in (called at the grid cadence). */
  private updateStars(camPos: UPos): void {
    const host = this.current;
    if (host !== this.starGalaxy) {
      this.starGrid.clear();
      this.starGalaxy = host;
      this.starAdjust = 0;
      this.starCooldown = 0;
    }
    if (!host) {
      this.proceduralStars = false;
      return;
    }
    const g = host.model;
    uposSub(camPos, host.center, tmp);
    const local = worldToGalaxy(g, tmp);
    const lx = local.x / PC;
    const ly = local.y / PC;
    const lz = local.z / PC;
    // Pick the magnitude limit that fits the procedural-star budget at the local density…
    const tier = this.engine.tier;
    const cap = STAR_MAG_LIMIT[tier.name];
    const rho = Math.max(galaxyDensity(g, lx / 1000, ly / 1000, lz / 1000, 1), 1e-9);
    let limit = cap;
    while (limit > 1 && expectedStarCount(g, rho, limit) > tier.proceduralStars) limit -= 0.25;
    // …then correct it by what really reached the GPU (the estimate knows nothing of arms or cluster cores).
    this.starCooldown -= 0.35;
    if (this.starCooldown <= 0) {
      const points = this.starGrid.points;
      if (points > tier.proceduralStars * 1.1 && this.starAdjust > -4) {
        this.starAdjust -= 0.25;
        this.starCooldown = 1.5;
      } else if (points < tier.proceduralStars * 0.5 && this.starAdjust < 0 && this.starGrid.pending === 0) {
        this.starAdjust += 0.25;
        this.starCooldown = 1.5;
      }
    }
    limit = Math.max(1, limit + this.starAdjust);
    this.starMagLimit = limit;

    // In the Milky Way the real catalogues already hold every star brighter than their limit as
    // seen from the Sun, and everything within the volume-complete sphere around it.
    const sup = g.id === 'mw' ? this.suppression : null;
    const fromSun = sup ? Math.hypot(lx - sup.sunX, ly - sup.sunY, lz - sup.sunZ) : Infinity;
    const levels: CellLevel[] = [];
    for (let l = 0; l < STAR_LEVELS; l++) {
      const L = STAR_LEVEL_TABLE[l]!;
      const r = levelRadius(l, limit);
      if (sup) {
        // Every star of this level that could be seen from here is a catalogue star: nothing to generate.
        const covered = Math.max(sup.nearRadius, 10 * Math.pow(10, (sup.gLimit - L.magHi) / 5));
        if (fromSun + r < covered) continue;
      }
      // Skip levels that cannot put even a fraction of a star within sight.
      const bound = galaxyDensityBound(g, lx / 1000, ly / 1000, lz / 1000, r / 1000, L.pop);
      if (g.density0 * L.fraction * bound * 4.19 * r * r * r < 0.04) continue;
      const k = Math.min(STAR_K - 1, Math.max(1, Math.ceil(r / (STAR_BLOCKS_PER_RADIUS * L.cell))));
      levels.push({ id: l * STAR_K + k, size: L.cell * k, radius: r });
    }
    this.proceduralStars = levels.length > 0;
    this.starGrid.update(levels, lx, ly, lz);
  }

  dispose(): void {
    this.webGrid.clear();
    this.starGrid.clear();
    this.renderer.dispose();
  }
}
