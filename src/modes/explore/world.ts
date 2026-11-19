/**
 * ExploreWorld: decides what exists around the camera and keeps it loaded.
 *
 * Largest to smallest:
 *   universe  — real galaxy/quasar tiles + procedural cosmic-web cells (points),
 *               nearby galaxies as impostors, the current galaxy as a volume
 *   galaxy    — real star tiles (Milky Way) + procedural star cells, deep-sky objects
 *   system    — the star system the camera is in: stars, planets, moons, rings, belts
 *   planet    — terrain and atmosphere of the body being approached
 *
 * Everything is positioned in high-precision universe coordinates; renderers
 * receive camera-relative values.
 */
import * as THREE from 'three';
import { type UPos, uposAddInPlace, uposCopy, uposSub, uposZero } from '../../core/hp';
import { MPC, PC } from '../../core/units';
import type { Catalog } from '../../data/catalog';
import { CatalogStreamer } from '../../data/catalogStreamer';
import type { WorkerPool } from '../../data/workerPool';
import type { Engine } from '../../render/engine';
import { PointLayer } from '../../render/pointLayer';
import { DATASET_LOD, GALAXY_MAG_LIMIT, STAR_MAG_LIMIT } from '../../render/qualityTiers';
import type { Surroundings } from './cameraController';
import { DSO_KEY, DsoManager } from './dso';
import { GalaxyManager } from './galaxies';
import { type WorldTarget, bodyTarget, galaxyTarget } from './targets';
import { SystemManager } from './systems';

/** Point-layer brightness groups. */
export const GROUP_CATALOG = 0;
export const GROUP_PROCEDURAL = 1;
/** Cosmic-web glow (galaxy layer only): its group `floor` is the glow's overall visibility. */
export const GROUP_GLOW = 2;
/** Evenly sampled levels of the real galaxy surveys (galaxy layer only): stay visible as faint dots from afar. */
export const GROUP_SURVEY = 3;

export class ExploreWorld {
  /** Stars (unit = parsec): catalogue tiles + procedural cells. */
  readonly starLayer: PointLayer;
  /** Galaxies and quasars (unit = megaparsec): catalogue tiles + procedural cosmic web. */
  readonly galaxyLayer: PointLayer;
  readonly streams: CatalogStreamer[] = [];
  readonly galaxies: GalaxyManager;
  readonly systems: SystemManager;
  readonly dso: DsoManager;
  /** Simulation time, seconds since J2000. */
  simTime = 0;

  private readonly sun = uposZero();
  private readonly lastCam = uposZero();
  private readonly rel = { x: 0, y: 0, z: 0 };
  private streamTimer = 0;
  private starMagLimit = 7.5;
  private galaxyMagLimit = 14;
  private surveyFloor = 0;
  private webGlow = 0;
  private nearestDistance = PC;
  private starGain = 1;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();

  constructor(readonly engine: Engine, readonly catalog: Catalog, readonly pool: WorkerPool) {
    this.galaxyLayer = new PointLayer(engine.background, { unit: MPC, renderOrder: 0 });
    this.starLayer = new PointLayer(engine.background, { unit: PC, renderOrder: 20 });
    for (const [id, ds] of catalog.datasets) {
      const lod = DATASET_LOD[id];
      if (!lod) continue;
      this.streams.push(new CatalogStreamer(ds, catalog, pool, ds.manifest.kind === 'stars' ? this.starLayer : this.galaxyLayer, lod.magLimit ?? GALAXY_MAG_LIMIT.high, GROUP_CATALOG, lod.uniformFirst ? GROUP_SURVEY : null));
    }
    this.galaxies = new GalaxyManager(engine, catalog, pool, this.galaxyLayer, this.starLayer, this.streams);
    this.systems = new SystemManager(engine, pool, catalog, this.starLayer, this.streams.find((s) => s.ds.manifest.kind === 'stars'), this.galaxies);
    this.dso = new DsoManager(engine, catalog, this.starLayer, this.galaxyLayer);
    this.systems.compactInput = (index) => this.dso.systemInput(index);
    // Catalogued pulsars / black holes become systems when approached…
    this.systems.providers.push((camPos) => {
      const list = catalog.dso;
      for (let i = 0; i < list.length; i++) {
        const t = list[i]!.t;
        if (t !== 'psr' && t !== 'bh') continue;
        uposSub(this.dso.positions[i]!, camPos, this.rel);
        if (Math.hypot(this.rel.x, this.rel.y, this.rel.z) < this.dso.enterDistance(i)) return this.dso.systemInput(i);
      }
      return null;
    });
    // …and so does the central black hole of whichever galaxy we are in (the Milky Way's is Sagittarius A*, in the list above).
    this.systems.providers.push((camPos) => {
      const g = this.galaxies.current;
      if (!g || g.model.id === 'mw') return null;
      uposSub(g.center, camPos, this.rel);
      const rs = 2953 * g.model.smbhMassSun;
      return Math.hypot(this.rel.x, this.rel.y, this.rel.z) < Math.max(0.05 * PC, rs * 4e4) ? this.galaxies.coreInput(g) : null;
    });
  }

  /** True once the tiles needed for the current view have arrived. */
  get settled(): boolean {
    return this.streams.every((s) => s.settled);
  }

  get tilesLoaded(): number {
    return this.streams.reduce((n, s) => n + s.loadedTiles, 0);
  }

  get tilesPending(): number {
    return this.streams.reduce((n, s) => n + s.pendingTiles, 0);
  }

  /**
   * Advance the world. `camPos` and `camQuat` may be nudged: the camera is carried along by the
   * body it is next to (see SystemRenderer.update).
   */
  update(camPos: UPos, camQuat: THREE.Quaternion, dt: number): void {
    const engine = this.engine;
    uposCopy(this.lastCam, camPos);
    const tier = engine.tier;

    // Re-select catalogue tiles a few times per second (cheap, but no need to do it every frame).
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) {
      this.streamTimer = 0.2;
      uposSub(camPos, this.sun, this.rel);
      for (const s of this.streams) {
        const unit = s.ds.manifest.unit;
        const lod = DATASET_LOD[s.ds.manifest.id]!;
        // Around the camera, only galaxies bright enough to be drawn are worth loading (plus a margin for the fade).
        let budget = lod.share(tier);
        // Real and procedural stars share one allowance: whatever the procedural field is not using
        // (all of it near the Sun, where the catalogue is the whole sky) goes to catalogue stars.
        if (s.ds.manifest.kind === 'stars') budget += Math.floor(Math.max(0, tier.proceduralStars - this.galaxies.starGrid.points) / 16384) * 16384;
        s.update(this.rel.x / unit, this.rel.y / unit, this.rel.z / unit, budget, 0.2, lod.magLimit ?? GALAXY_MAG_LIMIT[tier.name] + 1);
      }
    }

    // Fade limits: never fainter than the tier's limit, never fainter than what streaming has actually delivered.
    let starCut = STAR_MAG_LIMIT[tier.name];
    const galCut = GALAXY_MAG_LIMIT[tier.name];
    for (const s of this.streams) if (s.ds.manifest.kind === 'stars') starCut = Math.min(starCut, s.cutoffMag);
    const k = Math.min(1, dt * 2);
    this.starMagLimit += (starCut - this.starMagLimit) * k;
    this.galaxyMagLimit += (galCut - this.galaxyMagLimit) * k;
    this.galaxies.update(camPos, dt);
    // Where both exist, catalogue stars and procedural stars share one limit, so the real neighbourhood
    // of the Sun blends into the procedural galaxy around it.
    const starLimit = this.galaxies.proceduralStars ? Math.min(this.starMagLimit, this.galaxies.starMagLimit) : this.starMagLimit;
    for (const g of this.starLayer.groups) g.magLimit = starLimit;
    // Far from any galaxy the real surveys stay visible as faint "survey dots" whatever their magnitude.
    const deep = Math.min(1, Math.max(0, (this.galaxies.nearestRatio - 1.5) / 6));
    this.surveyFloor += (deep * 0.45 - this.surveyFloor) * k;
    for (const g of this.galaxyLayer.groups) {
      g.magLimit = this.galaxyMagLimit;
      // Exposure for the deep sky: a galaxy one magnitude above the faintest drawn is a clear dot.
      g.magRef = 12;
      g.floor = 0;
    }
    this.galaxyLayer.groups[GROUP_SURVEY]!.floor = this.surveyFloor;
    // The web's glow belongs to intergalactic space: inside a galaxy its own light drowns it out.
    this.webGlow += (deep - this.webGlow) * k;
    this.galaxyLayer.groups[GROUP_GLOW]!.floor = this.webGlow;

    this.dso.update(camPos, dt);

    // The star system we are in (bodies move with simulation time and may carry the camera along).
    this.systems.update(camPos, dt);
    const sysR = this.systems.renderer;
    sysR.update(camPos, engine.camera, this.simTime, dt, starLimit, { quat: camQuat });

    // A blazing sun or a daylit sky drowns out the background.
    const dim = 1 - 0.93 * sysR.skyDimming;
    this.starGain += (dim - this.starGain) * Math.min(1, dt * 3);
    this.starLayer.gain = this.starGain;
    this.galaxyLayer.gain = this.starGain;

    // Sprite size follows resolution so stars look the same on every screen.
    const px = Math.max(1.1, engine.renderHeight / 720);
    const focal = engine.pixelsPerRadian;
    this.galaxyLayer.update(camPos, engine.camera, dt, px, focal);
    this.starLayer.update(camPos, engine.camera, dt, px, focal);

    // Post effects driven by the world: black-hole lensing and the lens flare of the brightest sun.
    const post = engine.post.params;
    post.blackHole = sysR.blackHole;
    if (sysR.flare.strength > 0) {
      const v = this.tmpV.copy(sysR.flare.rel).applyQuaternion(this.tmpQ.copy(engine.camera.quaternion).invert());
      const tanY = Math.tan(engine.fovY / 2);
      const onScreen = v.z < 0 ? 1 : 0;
      post.flare.x = 0.5 + (v.x / -v.z / (tanY * engine.camera.aspect)) * 0.5;
      post.flare.y = 0.5 + (v.y / -v.z / tanY) * 0.5;
      const inFrame = Math.max(0, 1 - Math.max(Math.abs(post.flare.x - 0.5), Math.abs(post.flare.y - 0.5)) * 1.6);
      post.flare.visibility = onScreen * inFrame * sysR.flare.strength * this.sunVisible(sysR.flare.rel);
      post.flare.color.copy(sysR.flare.color);
    } else post.flare.visibility = 0;

    const sysNearest = sysR.nearestIndex >= 0 ? Math.max(sysR.nearestAltitude, 1) : Infinity;
    this.nearestDistance = Math.max(0.5, Math.min(this.starLayer.nearestDistance(50), this.galaxies.nearestEdge, this.dso.nearestEdge, sysNearest));
  }

  /** Is the line of sight to a point (relative to the camera) free of planets? Used to hide the lens flare during eclipses. */
  private sunVisible(sunRel: THREE.Vector3): number {
    const sysR = this.systems.renderer;
    const sys = sysR.system;
    if (!sys) return 1;
    const dir = this.tmpV2.copy(sunRel);
    const dist = dir.length();
    dir.multiplyScalar(1 / dist);
    for (let i = 0; i < sys.bodies.length; i++) {
      const body = sys.bodies[i]!;
      if (body.kind === 'star') continue;
      const rel = sysR.bodyRel(i);
      if (!rel) continue;
      const along = rel.dot(dir);
      if (along <= 0 || along >= dist) continue;
      const off2 = rel.lengthSq() - along * along;
      if (off2 < body.radius * body.radius) return 0;
    }
    return 1;
  }

  /** What the flight controller needs to know about the neighbourhood. */
  surroundings(): Surroundings {
    const sysR = this.systems.renderer;
    const sys = sysR.system;
    const body = sys && sysR.nearestIndex >= 0 ? sys.bodies[sysR.nearestIndex]! : null;
    // Level the horizon only when low over a solid surface.
    const ratio = body ? sysR.nearestAltitude / body.radius : Infinity;
    const levelling = body && body.kind !== 'star' ? Math.min(1, Math.max(0, (0.35 - ratio) / 0.3)) : 0;
    return {
      nearest: this.nearestDistance,
      up: levelling > 0 ? sysR.nearestUp : null,
      levelling,
      collide: (pos) => {
        // Stay a couple of metres above the ground (and out of stars).
        const fix = sysR.resolveCollision(2);
        if (!fix) return false;
        uposAddInPlace(pos, fix.x, fix.y, fix.z);
        return true;
      },
    };
  }

  /**
   * A catalogued deep-sky object as a destination. Pulsars and black holes are places you can go
   * right up to, so they resolve to their (single-body) system; nebulae and clusters to their extent.
   */
  dsoTarget(index: number): WorldTarget | null {
    const input = this.dso.systemInput(index);
    if (input) return bodyTarget(this.systems.build(input), 0, () => this.simTime);
    return this.dso.target(index);
  }

  /**
   * What is under a tap? Bodies of the current system first, then stars, deep-sky objects and galaxies.
   * @param ndcX,ndcY normalised device coordinates (−1…1, y up)
   */
  pick(ndcX: number, ndcY: number): WorldTarget | null {
    const engine = this.engine;
    const cam = engine.camera;
    const focal = engine.pixelsPerRadian;
    const tanY = Math.tan(engine.fovY / 2);
    const tolerance = 22 * (engine.renderHeight / Math.max(1, engine.canvas.clientHeight));
    const sysR = this.systems.renderer;
    if (sysR.system) {
      const dir = this.tmpV.set(ndcX * tanY * cam.aspect, ndcY * tanY, -1).normalize().applyQuaternion(cam.quaternion);
      const hit = sysR.pick(dir, focal, tolerance);
      if (hit >= 0) return bodyTarget(sysR.system, hit, () => this.simTime);
    }
    const star = this.starLayer.pick(cam, ndcX, ndcY, engine.renderWidth, engine.renderHeight, tolerance);
    const gal = this.galaxyLayer.pick(cam, ndcX, ndcY, engine.renderWidth, engine.renderHeight, tolerance);
    // A star and a galaxy under the same finger: take whichever is closer to the tap.
    if (star && (!gal || star.pixels <= gal.pixels + 4)) {
      if (star.key === DSO_KEY) return this.dsoTarget(star.index);
      if (star.key.startsWith('dsoc:')) return this.dsoTarget(Number(star.key.slice(5)));
      const input = this.systems.inputFor(star.key, star.index);
      if (input) return bodyTarget(this.systems.build(input), 0, () => this.simTime, { key: star.key, index: star.index });
    }
    if (gal) {
      if (gal.key === DSO_KEY) return this.dsoTarget(gal.index);
      const entry = this.galaxies.entryFor(gal.key, gal.index);
      if (entry) return galaxyTarget(entry);
    }
    // Tapping the glow of the galaxy we are looking at from outside selects it.
    const near = this.galaxies.nearest;
    if (near && !this.galaxies.current) {
      uposSub(near.center, this.lastCam, this.rel);
      const dir = this.tmpV.set(ndcX * tanY * cam.aspect, ndcY * tanY, -1).normalize().applyQuaternion(cam.quaternion);
      const c = this.tmpV2.set(this.rel.x, this.rel.y, this.rel.z);
      const along = c.dot(dir);
      if (along > 0 && Math.sqrt(Math.max(0, c.lengthSq() - along * along)) < near.model.radius * 3.0857e19 * 0.6) return galaxyTarget(near);
    }
    return null;
  }

  get pointCount(): number {
    return this.starLayer.pointCount + this.galaxyLayer.pointCount;
  }

  dispose(): void {
    for (const s of this.streams) s.dispose();
    this.galaxies.dispose();
    this.systems.dispose();
    this.dso.dispose();
    this.starLayer.dispose();
    this.galaxyLayer.dispose();
  }
}
