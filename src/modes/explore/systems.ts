/**
 * Star-system management: notices when the camera comes close to a star,
 * generates that star's system (real Solar System, real exoplanet host, real
 * star with procedural planets, or fully procedural) and hands it to the
 * system renderer.
 */
import { raDecToUnit } from '../../core/astro';
import { hashInts } from '../../core/hash';
import { type UPos, uposDistance, uposFromMeters, uposZero } from '../../core/hp';
import { AU, PC } from '../../core/units';
import type { Catalog } from '../../data/catalog';
import type { CatalogStreamer } from '../../data/catalogStreamer';
import { starAbsMag, starPosition } from '../../data/decode';
import { STAR_FLAG_WD, dqStarColor, dqStarDec, dqStarRa } from '../../data/format/schema';
import type { WorkerPool } from '../../data/workerPool';
import type { Engine } from '../../render/engine';
import type { PointLayer } from '../../render/pointLayer';
import { SystemRenderer } from '../../render/systemRenderer';
import { starName } from '../../universe/names';
import { solarSystem } from '../../universe/solarSystem';
import { classifyByPhotometry, teffFromPhotometry } from '../../universe/star';
import { STAR_TYPE_CODES, starId } from '../../universe/starfield';
import { type SystemInput, generateSystem } from '../../universe/system';
import type { SystemModel } from '../../universe/types';
import { DSO_KEY } from './dso';
import type { GalaxyManager } from './galaxies';

/** Distance at which a star's system is generated, and at which it is released again. */
const ENTER = 0.05 * PC;
const LEAVE = 0.08 * PC;

/** Where a system's star came from in the point layers (so its sprite can be hidden while the model is shown). */
export interface StarSource {
  key: string;
  index: number;
}

export class SystemManager {
  readonly renderer: SystemRenderer;
  /** The system the camera is in, if any. */
  active: SystemModel | null = null;
  private activeSource: StarSource | null = null;
  private readonly cache = new Map<string, SystemModel>();
  private scanTimer = 0;
  private readonly sunPos = uposZero();
  /** Describes a deep-sky compact object (pulsar / black hole) as a system; set by the world. */
  compactInput: ((index: number) => SystemInput | null) | null = null;
  /**
   * Extra system candidates that are not points of the star layer: catalogued compact objects and
   * the central black hole of the current galaxy. Each returns its input when the camera is in range.
   */
  readonly providers: Array<(camPos: UPos) => SystemInput | null> = [];
  /** A system that must stay loaded regardless of distance (autopilot destination). */
  private pinned: { model: SystemModel; source: StarSource | null } | null = null;

  constructor(
    engine: Engine,
    pool: WorkerPool,
    private readonly catalog: Catalog,
    private readonly starLayer: PointLayer,
    private readonly starStream: CatalogStreamer | undefined,
    private readonly galaxies: GalaxyManager,
  ) {
    this.renderer = new SystemRenderer(engine, pool);
  }

  /** Describe the star behind a point of the star layer. */
  inputFor(key: string, index: number): SystemInput | null {
    const chunk = this.starLayer.getChunk(key);
    if (!chunk) return null;
    if (this.galaxies.starGrid.owns(key)) {
      const block = this.galaxies.starGrid.cell(key);
      const host = this.galaxies.starHost;
      if (!block || !host) return null;
      const c = block.extra;
      const seed = c.seed[index]!;
      const [ix, iy, iz] = [c.cell[index * 3]!, c.cell[index * 3 + 1]!, c.cell[index * 3 + 2]!];
      return {
        id: starId(host.model.id, c.level, ix, iy, iz, c.index[index]!), name: starName(seed), seed,
        origin: this.galaxies.starPosition(host, c.level, ix, iy, iz, c.local[index * 3]!, c.local[index * 3 + 1]!, c.local[index * 3 + 2]!),
        star: { absMag: c.absMag[index]!, teff: c.teff[index]!, type: STAR_TYPE_CODES[c.type[index]!]!, real: false },
      };
    }
    if (key === DSO_KEY) return this.compactInput?.(index) ?? null;
    const tile = this.starStream?.chunk(key);
    if (!tile) return null;
    const col = tile.data.columns;
    const refAt = tile.data.refRows.indexOf(index);
    const named = refAt >= 0 ? this.catalog.names.peek(tile.data.refIds[refAt]!) : undefined;
    return this.inputFromCodes(col.ra![index]!, col.dec![index]!, col.dist![index]!, col.mag![index]!, col.color![index]!, col.flags![index]!, named?.names[0], named?.extra && typeof named.extra.sp === 'string' ? named.extra.sp : undefined);
  }

  /**
   * Describe a catalogue star from its quantised codes. The tile path and the names-table path
   * (search results) both come through here, so they produce the identical system.
   */
  inputFromCodes(ra: number, dec: number, dist: number, magCode: number, colorCode: number, flags: number, name?: string, spectral?: string): SystemInput {
    const absMag = starAbsMag(magCode, dist);
    const bpRp = dqStarColor(colorCode);
    const [x, y, z] = starPosition(ra, dec, dist);
    return {
      id: `star:${ra}-${dec}-${dist}`, name: name ?? this.catalog.exoHost(ra, dec, dist)?.name ?? 'Unnamed star', seed: hashInts(0x57a7, ra, dec, dist),
      origin: uposFromMeters(x * PC, y * PC, z * PC),
      star: { absMag, teff: teffFromPhotometry(absMag, bpRp), type: classifyByPhotometry(absMag, bpRp, (flags & STAR_FLAG_WD) !== 0), real: true, spectral },
      lineOfSight: raDecToUnit(dqStarRa(ra), dqStarDec(dec)),
      exo: this.catalog.exoHost(ra, dec, dist),
      companion: this.catalog.companion(ra, dec, dist),
    };
  }

  /** Generate (or fetch from the small cache) the system for an input. */
  build(input: SystemInput): SystemModel {
    let model = this.cache.get(input.id);
    if (!model) {
      model = generateSystem(input);
      if (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(input.id, model);
    }
    return model;
  }

  /** Keep a system loaded while flying to it. Pass null to release. */
  pin(model: SystemModel | null, source: StarSource | null = null): void {
    this.pinned = model ? { model, source } : null;
  }

  private activate(model: SystemModel | null, source: StarSource | null): void {
    if (model === this.active) return;
    if (this.activeSource) this.starLayer.setHidden(this.activeSource.key, -1);
    this.active = model;
    this.activeSource = source;
    if (source) this.starLayer.setHidden(source.key, source.index);
    this.renderer.setSystem(model);
  }

  update(camPos: UPos, dt: number): void {
    this.scanTimer -= dt;
    if (this.scanTimer > 0) return;
    this.scanTimer = 0.25;

    // Stay in the current system until we are well clear of it (hysteresis).
    if (this.active) {
      const d = uposDistance(camPos, this.active.origin);
      if (d < Math.max(LEAVE, this.active.extent * 3)) return;
    }
    // The Solar System is always known.
    const sol = solarSystem();
    if (uposDistance(camPos, this.sunPos) < ENTER) {
      this.activate(sol, null);
      return;
    }
    if (this.pinned && uposDistance(camPos, this.pinned.model.origin) < Math.max(ENTER, this.pinned.model.extent * 2)) {
      this.activate(this.pinned.model, this.pinned.source);
      return;
    }
    for (const provider of this.providers) {
      const input = provider(camPos);
      if (input) {
        this.activate(this.build(input), null);
        return;
      }
    }
    // Otherwise: the nearest star point within range.
    let best: StarSource | null = null;
    let bestD = ENTER / PC;
    this.starLayer.forEachChunk((key, _anchor, data, cam) => {
      const dc = Math.hypot(cam[0], cam[1], cam[2]) - data.radius;
      if (dc > bestD) return;
      const pos = data.positions;
      for (let i = 0; i < data.count; i++) {
        const d = Math.hypot(pos[i * 3]! - cam[0], pos[i * 3 + 1]! - cam[1], pos[i * 3 + 2]! - cam[2]);
        if (d < bestD) {
          bestD = d;
          best = { key, index: i };
        }
      }
    });
    if (best) {
      const src = best as StarSource;
      const input = this.inputFor(src.key, src.index);
      if (input) {
        this.activate(this.build(input), src);
        return;
      }
    }
    this.activate(null, null);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

export const SYSTEM_ENTER_AU = ENTER / AU;
