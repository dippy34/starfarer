/**
 * Explore mode: free exploration of the universe.
 *
 * Wires together the world (what exists around the camera), the flight
 * controller, input, and the UI actions: select, fly to, land, search,
 * bookmarks, share links, photo mode, time control.
 */
import * as THREE from 'three';
import { hashString } from '../../core/hash';
import { type UPos, uposClone, uposCopy, uposDistance, uposFromMeters, uposSub, uposZero } from '../../core/hp';
import { J2000_UNIX, MPC, PC } from '../../core/units';
import { Catalog } from '../../data/catalog';
import { STAR_SRC_HIP, STAR_SRC_MASK } from '../../data/format/schema';
import { WorkerPool } from '../../data/workerPool';
import { GestureInput } from '../../input/gestures';
import { type AmbientScene, platform } from '../../platform';
import { type SavedPlace, type ScaleLevel, type SelectionInfo, addBookmark, addRecent, appState, showToast } from '../../state/appState';
import { type SearchResult, setActions } from '../../ui/actions';
import { WEB_LEVELS, galaxyId, parseGalaxyId } from '../../universe/cosmicWeb';
import { makeGalaxy } from '../../universe/galaxy';
import { solarSystem } from '../../universe/solarSystem';
import { STAR_TYPE_CODES, parseStarId } from '../../universe/starfield';
import { starName } from '../../universe/names';
import { bodyPositions } from '../../universe/system';
import { modes } from '../registry';
import type { ModeContext, ModeInstance } from '../types';
import { CameraController, type CameraTarget } from './cameraController';
import type { GalaxyEntry } from './galaxies';
import { type DynamicLabel, Labels, type Occluder } from './labels';
import { type ViewLink, decodeView, encodeView } from './links';
import { SearchIndex, type SearchPayload, seedPosition } from './search';
import { type WorldTarget, blockedBy, bodyTarget, galaxyTarget } from './targets';
import { ExploreWorld } from './world';

const SCENE_FOR_SCALE: Record<ScaleLevel, AmbientScene> = { surface: 'surface', planet: 'planet', system: 'system', galaxy: 'galaxy', cluster: 'space', universe: 'cosmic' };
const SURPRISES = ['Saturn', 'Sagittarius A*', 'Orion Nebula', 'Andromeda Galaxy', 'Crab Pulsar', 'Betelgeuse', 'TRAPPIST-1 e', 'Pleiades', 'Cygnus X-1', 'Ring Nebula', 'Omega Centauri', 'Whirlpool Galaxy', 'Sombrero Galaxy', 'Titan', 'Vega', 'Helix Nebula', 'Crab Nebula', 'Io', 'Proxima Cen b', 'Sirius'];

class ExploreMode implements ModeInstance {
  private pool!: WorkerPool;
  private catalog!: Catalog;
  private world!: ExploreWorld;
  private camera!: CameraController;
  private input!: GestureInput;
  private labels!: Labels;
  private search!: SearchIndex;
  private selection: WorldTarget | null = null;
  private selectionExtra: SelectionInfo['rows'] = [];
  private selectionPending = false;
  private focusTarget: WorldTarget | null = null;
  private pendingFocus: number | null = null;
  private hudTimer = 0;
  private hashTimer = 0;
  private lastHash = '';
  private fade = 0;
  private fadeTarget = 0;
  private flash = 0;
  private afterFade: (() => void) | null = null;
  private readonly renderQuat = new THREE.Quaternion();
  private readonly scratchPos = uposZero();
  private readonly tmpV = new THREE.Vector3();
  private readonly disposers: Array<() => void> = [];
  private scale: ScaleLevel = 'system';

  constructor(private readonly ctx: ModeContext) {}

  async enter(): Promise<void> {
    const { engine } = this.ctx;
    this.pool = new WorkerPool();
    this.catalog = await Catalog.load(this.pool, (f, status) => appState.set({ loadProgress: f, loadStatus: status }));
    appState.set({ dataTotals: this.catalog.manifest.totals, loadProgress: 0.7, loadStatus: 'Lighting the stars…' });
    this.world = new ExploreWorld(engine, this.catalog, this.pool);
    this.world.simTime = Date.now() / 1000 - J2000_UNIX;
    this.camera = new CameraController(uposZero());
    this.search = new SearchIndex(this.catalog);
    this.labels = new Labels(this.ctx.uiRoot, engine, this.catalog);

    this.input = new GestureInput(engine.canvas, {
      look: (dx, dy) => {
        const k = engine.fovY / Math.max(1, engine.canvas.clientHeight);
        this.camera.look(dx * k, dy * k);
      },
      pinch: (f) => this.camera.zoom(f),
      twist: (a) => this.camera.roll(a),
      tap: (x, y) => this.onTap(x, y, false),
      doubleTap: (x, y) => this.onTap(x, y, true),
      interact: () => {
        platform.audio.unlock();
      },
      key: (code) => this.onKey(code),
    });

    this.bindActions();
    const s0 = appState.get().settings;
    engine.setQualitySetting(s0.quality);
    platform.audio.setEnabled(s0.sound);
    this.disposers.push(
      appState.select((s) => s.settings.quality, (q) => engine.setQualitySetting(q)),
      appState.select((s) => s.settings.sound, (on) => platform.audio.setEnabled(on)),
      appState.select((s) => s.settings.orbits, (on) => {
        this.world.systems.renderer.showOrbits = on;
      }),
      platform.lifecycle.onVisibilityChange((visible) => platform.audio.setSuspended(!visible)),
      platform.lifecycle.onOnlineChange((online) => appState.set({ online })),
      platform.links.onHashChange((hash) => {
        // A link pasted into the address bar while the app is open.
        if (hash && hash !== this.lastHash) this.openLink(hash, true);
      }),
      engine.onContextChange((lost) => showToast(lost ? 'Graphics were interrupted — restoring…' : 'Back in business!')),
    );
    appState.set({ online: platform.lifecycle.isOnline() });

    // Start where the link says, or in orbit around home.
    const link = decodeView(platform.links.getHash());
    if (link) this.applyView(link);
    else this.startNearEarth();

    // Hold the loading screen until the first sky has streamed in (or a few seconds have passed).
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const check = (): void => {
        const waited = performance.now() - t0;
        appState.set({ loadProgress: Math.min(0.98, 0.7 + 0.28 * Math.min(1, waited / 2500)), loadStatus: 'Lighting the stars…' });
        if (this.world.settled || waited > 6000) resolve();
        else setTimeout(check, 120);
      };
      check();
    });
    appState.set({ loadProgress: 1, loadStatus: 'Ready', screen: 'start' });
  }

  // ------------------------------------------------------------------ UI actions

  private bindActions(): void {
    setActions({
      start: (modeId) => {
        if (modeId !== 'explore') return;
        platform.audio.unlock();
        platform.lifecycle.requestWakeLock();
        platform.audio.playEffect('flyArrive');
        appState.set({ screen: 'explore' });
      },
      userGesture: () => platform.audio.unlock(),
      setThrottle: (v) => {
        this.camera.throttle = v;
        if (v !== 0) this.camera.cancelFlight();
        appState.set({ throttle: v });
      },
      setTimeRate: (rate) => appState.set({ timeRate: rate }),
      flyToSelection: () => {
        if (this.selection) this.flyTo(this.selection);
      },
      landOnSelection: () => {
        if (this.selection?.canLand) this.flyTo(this.selection, true);
      },
      clearSelection: () => this.select(null),
      bookmarkSelection: () => this.bookmark(this.selection?.name),
      bookmarkView: () => this.bookmark(),
      shareView: () => void this.share(),
      releaseFocus: () => {
        this.camera.releaseFocus();
        this.focusTarget = null;
      },
      cancelFlight: () => this.camera.cancelFlight(),
      search: (query, onResults) => this.search.search(query, onResults),
      openResult: (result) => void this.openResult(result),
      openPlace: (place) => this.openLink(place.link, true),
      enterPhoto: () => {
        this.select(null);
        appState.set({ screen: 'photo', panel: 'none' });
        showToast('Photo mode');
      },
      exitPhoto: () => appState.set({ screen: 'explore' }),
      takePhoto: () => void this.takePhoto(),
      goHome: () => {
        const sol = solarSystem();
        this.flyTo(bodyTarget(sol, sol.bodies.findIndex((b) => b.id === 'sol:earth'), () => this.world.simTime));
      },
      surpriseMe: () => {
        const pick = SURPRISES[Math.floor(Math.random() * SURPRISES.length)]!;
        this.search.search(pick, (results, done) => {
          if (!done) return;
          const first = results.find((r) => (r.payload as SearchPayload).kind !== 'seed') ?? results[0];
          if (first) void this.openResult(first);
        });
      },
    });
  }

  private onKey(code: string): void {
    const s = appState.get();
    if (s.screen !== 'explore' && s.screen !== 'photo') return;
    switch (code) {
      case 'space':
        this.camera.throttle = 0;
        this.camera.cancelFlight();
        appState.set({ throttle: 0 });
        break;
      case 'keyg':
        if (this.selection) this.flyTo(this.selection);
        break;
      case 'keyl':
        if (this.selection?.canLand) this.flyTo(this.selection, true);
        break;
      case 'escape':
        if (s.screen === 'photo') appState.set({ screen: 'explore' });
        else if (this.camera.flying) this.camera.cancelFlight();
        else if (this.selection) this.select(null);
        else if (this.camera.focus) {
          this.camera.releaseFocus();
          this.focusTarget = null;
        }
        break;
      case 'keyp':
        appState.set({ screen: s.screen === 'photo' ? 'explore' : 'photo', panel: 'none' });
        break;
      case 'slash':
        appState.set({ panel: 'search' });
        break;
      case 'bracketright':
      case 'bracketleft': {
        const steps = [0, 1, 3600, 86_400, 2_592_000];
        const i = Math.max(0, steps.indexOf(s.timeRate));
        appState.set({ timeRate: steps[Math.max(0, Math.min(steps.length - 1, i + (code === 'bracketright' ? 1 : -1)))]! });
        break;
      }
    }
  }

  // ------------------------------------------------------------ selection & travel

  private onTap(x: number, y: number, fly: boolean): void {
    const s = appState.get();
    if (s.screen !== 'explore') return;
    const canvas = this.ctx.engine.canvas;
    const target = this.world.pick((x / canvas.clientWidth) * 2 - 1, 1 - (y / canvas.clientHeight) * 2);
    if (!target) {
      if (!fly) this.select(null);
      return;
    }
    this.select(target);
    if (fly) this.flyTo(target);
  }

  private select(target: WorldTarget | null): void {
    const changed = target?.id !== this.selection?.id;
    this.selection = target;
    this.selectionExtra = [];
    this.selectionPending = false;
    if (!target) {
      appState.set({ selection: null });
      return;
    }
    if (changed) {
      platform.audio.playEffect('select');
      if (appState.get().settings.haptics) platform.haptics.fire('select');
    }
    this.publishSelection();
    // Real stars: fetch the catalogue id (Gaia DR3 source id or Hipparcos number) from the tile's id sidecar.
    const src = target.source;
    if (src && src.key.startsWith('stars:') && target.bodyIndex === 0) {
      const path = src.key.slice('stars:'.length);
      const tile = this.world.streams.find((st) => st.ds.manifest.id === 'stars')?.chunk(src.key);
      const flags = tile?.data.columns.flags?.[src.index] ?? 0;
      this.selectionPending = true;
      this.catalog
        .ids('stars', path)
        .then((ids) => {
          if (this.selection !== target) return;
          const id = ids[src.index] ?? 0n;
          if (id > 0n) this.selectionExtra = [{ label: 'Catalogue', value: (flags & STAR_SRC_MASK) === STAR_SRC_HIP ? `HIP ${id}` : `Gaia DR3 ${id}` }];
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.selection === target) {
            this.selectionPending = false;
            this.publishSelection();
          }
        });
    }
  }

  private publishSelection(): void {
    const t = this.selection;
    if (!t) return;
    const info = t.info();
    const d = uposDistance(this.camera.pos, t.position(this.scratchPos));
    const idRow = appState.get().settings.showData ? [{ label: 'Starfarer id', value: t.id }] : [];
    appState.set({ selection: { ...info, distance: Math.max(0, d - t.radius), rows: [...info.rows, ...this.selectionExtra, ...idRow], pending: this.selectionPending, canLand: t.canLand } });
  }

  /** Cinematic flight to a target; `land` continues down to just above the surface. */
  private flyTo(target: WorldTarget, land = false): void {
    const world = this.world;
    // Make sure the destination exists in full before we get there.
    if (target.system) world.systems.pin(target.system, target.source ?? null);
    if (target.galaxy) world.galaxies.pin(target.galaxy);
    // Landing: fly to just above the highest ground the world can have, then settle onto the real terrain.
    const body = land && target.system && target.bodyIndex !== undefined ? target.system.bodies[target.bodyIndex] : undefined;
    const relief = body && body.kind !== 'star' ? body.surface.relief : 0;
    const arrive = land ? target.radius + relief * 0.75 + Math.min(8000, Math.max(800, target.radius * 0.001)) : target.arrive;
    this.focusTarget = land ? null : target;
    this.camera.flyTo({
      target, arriveDistance: arrive, focusOnArrival: !land, approach: this.sunlitApproach(target, land), levelOut: land ? this.sunlitApproach(target, land, true) : undefined,
      settleAltitude: land ? Math.min(900, Math.max(120, target.radius * 0.0004)) : undefined,
      onArrive: () => {
        platform.audio.playEffect('flyArrive');
        if (appState.get().settings.haptics) platform.haptics.fire('arrive');
        this.flash = 0.12;
        addRecent(this.savedPlace(target.name));
      },
    });
    // If a planet sits on the straight line, arc around it.
    const sys = world.systems.renderer.system;
    if (sys) {
      const positions = bodyPositions(sys, world.simTime, new Float64Array(sys.bodies.length * 3));
      const blocker = blockedBy(sys, positions, this.camera.pos, target.position(this.scratchPos));
      if (blocker > 0) this.camera.setFlightBump(blocker * 2.5);
    }
    platform.audio.playEffect('flyStart');
    if (appState.get().settings.haptics) platform.haptics.fire('warp');
    appState.set({ throttle: 0 });
  }

  /**
   * For planets and moons: the direction (from the body) the flight should end in, so that we arrive
   * over the day side with the terminator in view — or, when landing, come down in daylight.
   * With `sunOnly` the callback returns the plain direction of the sun instead.
   */
  private sunlitApproach(target: WorldTarget, land: boolean, sunOnly = false): ((out: THREE.Vector3) => THREE.Vector3 | null) | undefined {
    const sys = target.system;
    const index = target.bodyIndex;
    if (!sys || index === undefined || sys.bodies[index]!.kind === 'star') return undefined;
    const scratch = new Float64Array(sys.bodies.length * 3);
    const up = new THREE.Vector3(sys.basis[6], sys.basis[7], sys.basis[8]);
    const side = new THREE.Vector3();
    return (out) => {
      bodyPositions(sys, this.world.simTime, scratch);
      // Brightest star as seen from the body.
      let best = -1;
      let bestFlux = 0;
      for (let i = 0; i < sys.bodies.length; i++) {
        const b = sys.bodies[i]!;
        if (b.kind !== 'star') continue;
        const d2 = (scratch[i * 3]! - scratch[index * 3]!) ** 2 + (scratch[i * 3 + 1]! - scratch[index * 3 + 1]!) ** 2 + (scratch[i * 3 + 2]! - scratch[index * 3 + 2]!) ** 2;
        const flux = b.star.luminosity / Math.max(d2, 1);
        if (flux > bestFlux) {
          bestFlux = flux;
          best = i;
        }
      }
      if (best < 0) return null;
      out.set(scratch[best * 3]! - scratch[index * 3]!, scratch[best * 3 + 1]! - scratch[index * 3 + 1]!, scratch[best * 3 + 2]! - scratch[index * 3 + 2]!).normalize();
      side.crossVectors(up, out);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      if (sunOnly) return out;
      // Landing: come down where the sun stands about 35° above the horizon, so shadows model the ground.
      return land ? out.multiplyScalar(0.57).addScaledVector(side, 0.82).normalize() : out.multiplyScalar(0.72).addScaledVector(side, 0.62).addScaledVector(up, 0.3).normalize();
    };
  }

  private async openResult(result: SearchResult): Promise<void> {
    const target = await this.resolve(result.payload as SearchPayload);
    if (!target) {
      showToast('Couldn’t find a way there — try another name');
      platform.audio.playEffect('error');
      return;
    }
    this.select(target);
    this.flyTo(target);
  }

  /** Turn a search payload into something to fly to. */
  private async resolve(p: SearchPayload): Promise<WorldTarget | null> {
    const world = this.world;
    const time = (): number => world.simTime;
    switch (p.kind) {
      case 'sol':
        return bodyTarget(solarSystem(), p.body, time);
      case 'name': {
        const r = p.record;
        if (r.kind === 'd') return world.dsoTarget(r.a);
        if (r.kind === 'g') return galaxyTarget(world.galaxies.entryFromRecord(r));
        if (r.kind === 's') {
          const q = typeof r.extra?.q === 'string' ? r.extra.q.split(',').map(Number) : null;
          if (!q || q.length < 3) return null;
          const input = world.systems.inputFromCodes(r.a, r.b, r.c, q[0]!, q[1]!, q[2]!, r.names[0], typeof r.extra?.sp === 'string' ? r.extra.sp : undefined);
          const sys = world.systems.build(input);
          // A star catalogued for its famous black-hole companion (Cygnus X-1, Gaia BH3): go to the black hole.
          const hole = input.companion ? sys.bodies.findIndex((b) => b.kind === 'star' && b.star.type === 'blackhole') : -1;
          return bodyTarget(sys, hole > 0 ? hole : 0, time);
        }
        return null;
      }
      case 'exo': {
        const host = this.catalog.exoHost(p.hostKey[0], p.hostKey[1], p.hostKey[2]);
        if (!host) return null;
        const input = world.systems.inputFromCodes(p.hostKey[0], p.hostKey[1], p.hostKey[2], host.star[0], host.star[1], host.star[2], host.name);
        const sys = world.systems.build(input);
        const name = host.planets[p.planet]?.name;
        const index = sys.bodies.findIndex((b) => b.name === name);
        return bodyTarget(sys, index >= 0 ? index : 0, time);
      }
      case 'point':
        return this.pointTarget(p.pos, p.label);
      case 'seed': {
        // A seed leads to a bright procedural galaxy near the spot the word hashes to.
        const pos = seedPosition(p.text);
        const level = 3;
        const size = WEB_LEVELS[level]!.cell * MPC;
        const m = uposSub(pos, uposZero());
        const base = [Math.floor(m.x / size), Math.floor(m.y / size), Math.floor(m.z / size)];
        for (let tries = 0; tries < 6; tries++) {
          const [ix, iy, iz] = [base[0]! + tries, base[1]!, base[2]!];
          const { cell } = await this.pool.run('galaxyCell', { level, ix, iy, iz, real: false }, { priority: 1 }).promise;
          if (cell.count === 0) continue;
          const i = hashString(p.text) % cell.count;
          return galaxyTarget(this.cellGalaxy(level, ix, iy, iz, cell.index[i]!, cell.seed[i]!, cell.absMag[i]!, cell.pos[i * 3]!, cell.pos[i * 3 + 1]!, cell.pos[i * 3 + 2]!));
        }
        return this.pointTarget(pos, `Seed “${p.text}”`);
      }
      case 'galaxyId': {
        if (p.id === 'mw') return galaxyTarget(world.galaxies.milkyWay);
        const entry = await this.galaxyById(p.id);
        return entry ? galaxyTarget(entry) : null;
      }
      case 'starId': {
        const s = parseStarId(p.id);
        if (!s) return null;
        const host = s.galaxyId === 'mw' ? world.galaxies.milkyWay : await this.galaxyById(s.galaxyId);
        if (!host) return null;
        // Regenerate the star's cell without catalogue suppression: ids are independent of the real-data limits.
        const { cell } = await this.pool.run('starCell', { galaxy: host.model, level: s.level, ix: s.ix, iy: s.iy, iz: s.iz, suppress: null }, { priority: 1 }).promise;
        const k = Array.from(cell.index).indexOf(s.index);
        if (k < 0) return null;
        const sys = world.systems.build({
          id: p.id, name: starName(cell.seed[k]!), seed: cell.seed[k]!,
          origin: world.galaxies.starPosition(host, s.level, s.ix, s.iy, s.iz, cell.pos[k * 3]!, cell.pos[k * 3 + 1]!, cell.pos[k * 3 + 2]!),
          star: { absMag: cell.absMag[k]!, teff: cell.teff[k]!, type: STAR_TYPE_CODES[cell.type[k]!]!, real: false },
        });
        return bodyTarget(sys, 0, time);
      }
    }
  }

  private cellGalaxy(level: number, ix: number, iy: number, iz: number, index: number, seed: number, absMag: number, x: number, y: number, z: number): GalaxyEntry {
    const size = WEB_LEVELS[level]!.cell * MPC;
    const model = makeGalaxy(galaxyId(level, ix, iy, iz, index), seed, absMag, { real: false });
    return { model, key: '', index: -1, center: uposFromMeters((ix + 0.5) * size + x * MPC, (iy + 0.5) * size + y * MPC, (iz + 0.5) * size + z * MPC) };
  }

  private async galaxyById(id: string): Promise<GalaxyEntry | null> {
    const g = parseGalaxyId(id);
    if (!g || !WEB_LEVELS[g.level] || WEB_LEVELS[g.level]!.glow) return null;
    const { cell } = await this.pool.run('galaxyCell', { level: g.level, ix: g.ix, iy: g.iy, iz: g.iz, real: false }, { priority: 1 }).promise;
    const k = Array.from(cell.index).indexOf(g.index);
    return k < 0 ? null : this.cellGalaxy(g.level, g.ix, g.iy, g.iz, g.index, cell.seed[k]!, cell.absMag[k]!, cell.pos[k * 3]!, cell.pos[k * 3 + 1]!, cell.pos[k * 3 + 2]!);
  }

  /** A bare position as a target (coordinates typed into search). */
  private pointTarget(pos: UPos, name: string): WorldTarget {
    const d = uposDistance(pos, uposZero());
    const radius = Math.max(0.02 * PC, d * 2e-4);
    return {
      id: `point:${name}`, kind: 'structure', name, real: false, radius, arrive: radius * 3, canLand: false,
      position: (out) => uposCopy(out, pos),
      info: () => ({ id: `point:${name}`, name, type: 'A place in space', description: 'Nothing in particular is charted here — which makes it yours to explore.', real: false, source: 'Coordinates', rows: [], pending: false, canLand: false }),
    };
  }

  // ------------------------------------------------------------- links & bookmarks

  private currentView(name?: string): ViewLink {
    const q = this.camera.quat;
    const focus = this.camera.focus && this.focusTarget?.bodyIndex !== undefined && this.focusTarget.system === this.world.systems.renderer.system ? this.focusTarget.bodyIndex : undefined;
    return { pos: uposClone(this.camera.pos), quat: [q.x, q.y, q.z, q.w], time: Math.round(this.world.simTime), focus, name };
  }

  private savedPlace(name?: string): SavedPlace {
    const s = appState.get();
    const label = name ?? this.camera.focus?.name ?? s.location[s.location.length - 1] ?? 'Deep space';
    return { name: label, detail: s.location.join(' › ') || 'Intergalactic space', link: encodeView(this.currentView(label)), savedAt: Date.now() };
  }

  private bookmark(name?: string): void {
    addBookmark(this.savedPlace(name));
    showToast('Saved to your bookmarks ⭐');
    platform.audio.playEffect('toggle');
  }

  private async share(): Promise<void> {
    const place = this.savedPlace(this.selection?.name);
    const url = platform.links.urlWithHash(place.link);
    if (await platform.share.share({ title: 'Starfarer', text: `Come and see ${place.name} in Starfarer`, url })) return;
    showToast((await platform.share.copy(url)) ? 'Link copied — paste it anywhere 🔗' : 'Couldn’t share from this browser');
  }

  private openLink(link: string, animate: boolean): void {
    const view = decodeView(link);
    if (!view) {
      showToast('That link doesn’t lead anywhere');
      return;
    }
    if (!animate) {
      this.applyView(view);
      return;
    }
    // Dip to black, jump, and come back: a hard cut across the universe is disorienting.
    this.fadeTarget = 1;
    this.afterFade = () => {
      this.applyView(view);
      this.fadeTarget = 0;
    };
  }

  private applyView(view: ViewLink): void {
    this.select(null);
    this.focusTarget = null;
    this.world.simTime = view.time;
    this.camera.teleport(view.pos, new THREE.Quaternion(view.quat[0], view.quat[1], view.quat[2], view.quat[3]));
    this.pendingFocus = view.focus ?? null;
    appState.set({ throttle: 0 });
  }

  /** Default starting view: looking back at Earth from a few radii out, the Sun over our shoulder. */
  private startNearEarth(): void {
    const sol = solarSystem();
    const pos = bodyPositions(sol, this.world.simTime, new Float64Array(sol.bodies.length * 3));
    const i = sol.bodies.findIndex((b) => b.id === 'sol:earth');
    const earth = new THREE.Vector3(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    const toSun = earth.clone().multiplyScalar(-1).normalize();
    const side = new THREE.Vector3(0, 0, 1).cross(toSun).normalize();
    const offset = toSun.clone().multiplyScalar(0.75).addScaledVector(side, 0.6).addScaledVector(new THREE.Vector3(0, 0, 1), 0.28).normalize().multiplyScalar(sol.bodies[i]!.radius * 4.2);
    const cam = earth.clone().add(offset);
    const look = new THREE.Matrix4().lookAt(offset, new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    this.camera.teleport(uposFromMeters(cam.x, cam.y, cam.z), new THREE.Quaternion().setFromRotationMatrix(look));
    this.pendingFocus = i;
  }

  private async takePhoto(): Promise<void> {
    const blob = await this.ctx.engine.captureScreenshot();
    if (!blob) {
      showToast('Couldn’t take the photo');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ok = await platform.share.saveFile(blob, `starfarer-${stamp}.png`);
    showToast(ok ? 'Photo saved 📸' : 'Couldn’t save the photo');
  }

  // ------------------------------------------------------------------- frame loop

  update(dt: number): void {
    const { engine } = this.ctx;
    const state = appState.get();
    const world = this.world;
    world.simTime += dt * state.timeRate;

    // A restored view asked to orbit a body of the local system: attach once that system is loaded.
    if (this.pendingFocus !== null && world.systems.renderer.system) {
      const sys = world.systems.renderer.system;
      if (this.pendingFocus < sys.bodies.length) {
        this.focusTarget = bodyTarget(sys, this.pendingFocus, () => world.simTime);
        this.camera.setFocus(this.focusTarget);
      }
      this.pendingFocus = null;
    }

    this.camera.update(dt, world.surroundings(), this.input.held);
    world.update(this.camera.pos, this.camera.quat, dt);

    // Black-hole dread: shake, colour fringing and a rising rumble as the hole looms.
    const sysR = world.systems.renderer;
    const prox = sysR.blackHoleProximity;
    this.camera.shake = prox * prox;
    engine.camera.quaternion.copy(this.camera.renderQuat(this.renderQuat));
    const post = engine.post.params;
    post.warp = this.camera.warp;
    post.chroma = 0.004 + 0.05 * prox * prox;
    platform.audio.setRumble(prox);
    platform.audio.setWarp(Math.max(this.camera.warp, Math.min(1, Math.abs(this.camera.throttle)) * 0.35));

    // Fades for link jumps, a soft flash on arrival.
    if (this.fade !== this.fadeTarget) {
      this.fade += Math.sign(this.fadeTarget - this.fade) * Math.min(Math.abs(this.fadeTarget - this.fade), dt * 3.2);
      if (this.fade >= 1 && this.afterFade) {
        const fn = this.afterFade;
        this.afterFade = null;
        fn();
      }
    }
    this.flash = Math.max(0, this.flash - dt * 0.5);
    post.fade = this.fade;
    post.flash = this.flash;

    // A flight that was cancelled, or a focus that the player flew away from, clears its chip.
    if (!this.camera.focus && !this.camera.flying) this.focusTarget = null;

    this.updateLabels(state.screen === 'explore');
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.16;
      this.publishHud();
    }
    this.hashTimer -= dt;
    if (this.hashTimer <= 0 && (state.screen === 'explore' || state.screen === 'photo')) {
      this.hashTimer = 1.5;
      if (!this.camera.flying) {
        const hash = encodeView(this.currentView());
        if (hash !== this.lastHash) {
          this.lastHash = hash;
          platform.links.setHash(hash);
        }
      }
    }
  }

  private updateLabels(show: boolean): void {
    const world = this.world;
    const sysR = world.systems.renderer;
    const settings = appState.get().settings;
    const dynamic: DynamicLabel[] = [];
    const occluders: Occluder[] = [];
    if (show && settings.labels && sysR.system) {
      const focal = this.ctx.engine.pixelsPerRadian;
      sysR.system.bodies.forEach((b, i) => {
        const rel = sysR.bodyRel(i);
        if (!rel) return;
        const dist = rel.length();
        const px = (b.radius / Math.max(dist, 1)) * focal;
        if (px > 12) occluders.push({ rel: rel.clone(), radius: b.radius });
        // Skip bodies that fill the view, and moons until their planet is reasonably close.
        if (px > this.ctx.engine.renderHeight * 0.2) return;
        if (b.kind === 'moon') {
          const parent = sysR.bodyRel(b.parent);
          const orbitPx = parent && b.orbit ? (b.orbit.a / Math.max(parent.length(), 1)) * focal : 0;
          if (orbitPx < 28) return;
        }
        dynamic.push({ text: b.name, rel: rel.clone(), priority: b.kind === 'star' ? 1 : b.kind === 'planet' ? 5 : 20 });
      });
    }
    let marker: THREE.Vector3 | null = null;
    if (show && this.selection) {
      const d = uposSub(this.selection.position(this.scratchPos), this.camera.pos);
      marker = this.tmpV.set(d.x, d.y, d.z);
      // No ring once the object is a big disc on screen.
      if ((this.selection.radius / Math.max(marker.length(), 1)) * this.ctx.engine.pixelsPerRadian > 40) marker = null;
    }
    this.labels.update(this.camera.pos, show && settings.labels, show && settings.constellations, dynamic, marker, world.starLayer.groups[0]!.magLimit, sysR.skyDimming, occluders);
  }

  private publishHud(): void {
    const world = this.world;
    const engine = this.ctx.engine;
    const sysR = world.systems.renderer;
    const sys = sysR.system;
    const body = sys && sysR.nearestIndex >= 0 ? sys.bodies[sysR.nearestIndex]! : null;
    const ratio = body ? sysR.nearestAltitude / body.radius : Infinity;
    const galaxy = world.galaxies.current;
    let scale: ScaleLevel;
    const location: string[] = [];
    if (galaxy) location.push(galaxy.model.id === 'mw' || galaxy.model.real ? galaxy.model.name : `${galaxy.model.name} Galaxy`);
    const inSystem = sys !== null && uposDistance(this.camera.pos, sys.origin) < Math.max(sys.extent * 4, 2e13);
    if (inSystem) location.push(sys.name);
    if (body && body.kind !== 'star' && ratio < 0.03) {
      scale = 'surface';
      location.push(body.name);
    } else if (body && body.kind !== 'star' && ratio < 30) {
      scale = 'planet';
      location.push(body.name);
    } else if (inSystem) {
      scale = 'system';
      if (body && ratio < 60) location.push(body.name);
    } else if (galaxy) scale = 'galaxy';
    else if (world.galaxies.nearestEdge < 4 * MPC) {
      scale = 'cluster';
      const near = world.galaxies.nearest;
      if (near) location.push(`Near ${near.model.id === 'mw' || near.model.real ? near.model.name : `${near.model.name} Galaxy`}`);
    } else {
      scale = 'universe';
      location.push(uposDistance(this.camera.pos, uposZero()) > 12_000 * MPC ? 'The edge of the observable universe' : 'The cosmic web');
    }
    if (scale !== this.scale) {
      this.scale = scale;
      platform.audio.setAmbient(SCENE_FOR_SCALE[scale]);
    }
    if (this.selection) this.publishSelection();
    appState.set({
      scale, location, speed: this.camera.speed, throttle: this.camera.throttle, simTime: (world.simTime + J2000_UNIX) * 1000,
      altitude: body && body.kind !== 'star' && ratio < 2 ? Math.max(0, sysR.nearestAltitude) : null,
      focusName: this.camera.focus ? this.camera.focus.name : null, flyingTo: this.camera.flying ? (this.camera.destination as CameraTarget).name : null,
      timeDilation: sysR.blackHoleProximity > 0 ? sysR.timeDilation : null,
      perf: {
        fps: engine.stats.fps, frameMs: engine.stats.frameMs, drawCalls: engine.stats.drawCalls, points: world.pointCount, triangles: engine.stats.triangles, tier: engine.tier.name,
        renderScale: engine.quality.renderScale, tilesLoaded: world.tilesLoaded, tilesPending: world.tilesPending, memoryMb: platform.device.heapUsedMb(),
      },
    });
  }

  exit(): void {
    for (const d of this.disposers) d();
    this.input.dispose();
    this.labels.dispose();
    this.world.dispose();
    this.pool.dispose();
    platform.audio.setAmbient('none');
    platform.audio.setRumble(0);
    platform.audio.setWarp(0);
  }
}

modes.register({
  id: 'explore',
  title: 'Explore',
  tagline: 'Fly anywhere in the universe',
  icon: '🚀',
  available: true,
  order: 1,
  create: (ctx) => new ExploreMode(ctx),
});

