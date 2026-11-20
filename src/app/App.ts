import { Quaternion, type ShaderMaterial, Vector3 } from 'three';
import { HITCH } from '../core/hitch';
import { STORAGE_PREFIX } from '../core/product';
import { VIEW_CONE } from '../render/Cull';
import { setUploadRenderer, uploadTexture, UPLOADS } from '../render/Uploads';
import { blackbodyRGB, irradianceToMag, luminance, magToIrradiance, sunIrradianceAt } from '../astro/photometry';
import { formatUtc, SimClock, utcToTdb, dateToJdUtc } from '../core/time';
import { AU, DAY, formatDistance, formatSpeed, PC, SUN_RADIUS } from '../core/units';
import { AtmospheresLayer, type AtmosphereData } from '../render/Atmospheres';
import { BlackHoleLayer } from '../render/BlackHoleLayer';
import { BodiesLayer } from '../render/Bodies';
import { PlanetTerrain } from '../render/PlanetTerrain';
import { RingSpot } from '../universe/RingSpot';
import { Landmark, LANDMARKS } from '../universe/Landmarks';
import { CometTails } from '../render/CometTails';
import { ExoPlanetLayer, type ExoView } from '../render/ExoPlanetLayer';
import { GalaxyGlow } from '../render/GalaxyLayer';
import { JetsLayer } from '../render/Jets';
import { Labels, type LabelCandidate } from '../render/Labels';
import { NearStarsLayer } from '../render/NearStars';
import { OrbitsLayer } from '../render/Orbits';
import { ProceduralStarLayer } from '../render/ProceduralStarLayer';
import { Renderer, type ViewInfo, VOLUMES } from '../render/Renderer';
import { GLOBALS, LITE, depthK } from '../render/shaders/xr';
import { SkyLayer } from '../render/Sky';
import { Comet, SmallBodiesLayer } from '../render/SmallBodies';
import { StarFieldLayer } from '../render/StarField';
import { FACE_KEY } from '../render/StarLook';
import { TileDetail } from '../render/TileDetail';
import { type CraftView, SpacecraftLayer } from '../render/SpacecraftLayer';
import { loadMaterials } from '../render/Materials';
import { Rocks } from '../render/Rocks';
import { MilkyWayVolume } from '../render/MilkyWayVolume';
import { GalaxiesLayer } from '../render/GalaxiesLayer';
import { DeepSkyLayer } from '../render/DeepSkyLayer';
import { DeepSkyObject, loadDeepSky } from '../universe/DeepSky';
import { Galaxy, loadGalaxies } from '../universe/Galaxies';
import { loadSpacecraft, Spacecraft } from '../universe/Spacecraft';
import { Hud, type HudAction, type HudState } from '../ui/Hud';
import { BlackHole, loadBlackHoles } from '../universe/BlackHoles';
import { Awe } from './Awe';
import { Body, type SpaceObject } from '../universe/Body';
import { GALAXY, glowColumn } from '../universe/Galaxy';
import { MilkyWay } from '../universe/MilkyWay';
import { ExoPlanet, type PlanetarySystem } from '../universe/Planets';
import { SolarSystem } from '../universe/SolarSystem';
import { StarCatalog } from '../universe/StarCatalog';
import { CatalogStar, NamedStars } from '../universe/Stars';
import { Catalog } from '../universe/Catalog';
import { normKey } from '../universe/CatalogSearch';
import { CameraRig } from './CameraRig';
import { Game } from '../game/Game';
import { TrafficShip } from '../game/Traffic';
import { Station } from '../game/Station';
import { adapt, diskLimit, diskSeen, hidden, released, seen, TAU_STARS } from './Exposure';
import { canHaveMoon, MADE_FIRST_ID, newMoon } from './WhatIf';
import { type Worked, workedOut } from './Worked';
import { count, LoadProgress } from './Loading';
import { Input } from './Input';
import { canvasRatio, leanDevice } from '../core/device';
import { describe, distanceText, distanceTo, objectsOf, pictureOf, starTint, type Category, type Destination, type Picture } from './destinations';
import { Systems } from './Systems';
import { VRSupport } from './VR';
import { Walk } from './Walk';
import { PERF } from '../perf/Perf';

/**
 * How bright a star's face is shown (its mean, before the tone curve): a disk large enough to
 * show its face, at the level its colours are designed for (StarLook's FACE_KEY), whether it
 * fills the view or stands in a dark sky; a smaller one brighter, up to `small` for one a few
 * pixels wide (shown brighter, a face is shown hotter: orange, yellow, white. StarLook: faceLight).
 */
const starCap = (small: number, cssRadius: number) => small + (FACE_KEY - small) * smoothstep(12, 60, cssRadius);
const DATA = `${import.meta.env.BASE_URL}data`;
/** catalogue stars closer than this (pc) are drawn individually by the near-star layer */
const NEAR_STAR_RADIUS = 0.02;
/** black-hole companions closer than this (pc) are drawn by the near-star layer */
const COMPANION_RADIUS = 2;
/** black holes are labelled within this distance (pc) */
const BH_LABEL_PC = 400;
/** how far a generated planet's rings reach, in its radii (for what counts as "in view") */
const EXO_RING_REACH = 3;
/** where a hole's disk is brightest, in inner radii (BlackHoleLayer.radianceAt) */
const DISK_PEAK_RADIUS = 49 / 36;
/**
 * With a hole itself in the frame, how many times brighter its disk may be drawn than as a
 * glowing surface: the side of the inner edge coming towards the eye, in its brightest streaks,
 * is that much over the display's white, and blooms.
 */
const DISK_GLARE = 6;
/** how much fainter than its sunlit face the brightest of a world's night side is taken to be (city lights, twilight) */
const NIGHT = 15;
/** how long the start waits for each piece of the first view (ms) before going on without it */
const FIRST_VIEW_WAIT = 12_000;
/**
 * The share of the sky's star regions that must be in before the start goes on. They arrive
 * brightest first: what is still to come by then is the faintest stars, which fill in unnoticed.
 */
const ENOUGH_STARS = 0.65;
/** the eye's height above the ground when standing on it (m) */
const EYE_HEIGHT = 1.6;
/** a double tap on the world the camera is at brings it this many times closer */
const DOUBLE_TAP_ZOOM = 6;
/** a click picks what is drawn within this many pixels of it; a finger reaches farther */
const POINTER_REACH = 9;
const FINGER_REACH = 22;
const RATE_STEPS = [1, 10, 60, 600, 3600, 21600, DAY, 7 * DAY, 30.4375 * DAY, 365.25 * DAY, 3652.5 * DAY, 36525 * DAY];

export class App {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly labels: Labels;
  readonly rig = new CameraRig();
  readonly clock: SimClock;
  selection: SpaceObject | null = null;
  /** dark-adapted limiting magnitude for stars ("star brightness") */
  starMagLimit = 7.5;
  /** stars are never dimmed below this fraction of the dark-adapted exposure */
  starFloor = 0.3;
  private worked: { key: string; at: number; rows: Worked[] } = { key: '', at: 0, rows: [] };
  private logExposure = 0;
  private logLight = 0;
  private logStarCap = 0;
  private lastTime = performance.now();
  /** the hitch detector over this loop (src/core/hitch.ts) */
  readonly hitch = HITCH;
  private fps = 60;
  private hudTimer = 0;
  private nearTimer = 0;
  private nearestStarDist = Infinity;
  /** compile every shader before it is first needed (set again when VR changes tone mapping) */
  warmupPending = false;
  /** how the start went: each piece that was loaded and what it brought */
  loading!: LoadProgress;
  /** settles when the Milky Way's map is in (or could not be had) */
  private skyMap!: Promise<unknown>;
  /** settles once the shaders compiled at the start are ready (warmUp) */
  private shadersReady!: () => void;
  private readonly warmed = new Promise<void>((resolve) => { this.shadersReady = resolve; });
  private fieldMinDistPc = 0;
  /** one object per catalogue star so selection, labels and near-star rendering agree */
  private starCache = new Map<string, CatalogStar>();
  private camPc = new Vector3();
  private invQuat = new Quaternion();
  /** geometry of the current view (desktop camera or the headset's left eye) */
  view: ViewInfo = { quat: new Quaternion(), fovY: 50, aspect: 1, width: 1, height: 1, pixelAngle: 1e-3, pixelRatio: 1, far: Infinity, xr: false };
  vr!: VRSupport;
  sky!: SkyLayer;
  atmospheres!: AtmospheresLayer;
  blackHoles: BlackHole[] = [];
  holes!: BlackHoleLayer;
  jets!: JetsLayer;
  /** scale cues: dust parallax, Earth for scale, the rumble of giants (src/app/Awe.ts) */
  awe!: Awe;
  /** the Milky Way's unresolved light (from the galaxy model) */
  galaxy!: GalaxyGlow;
  /** procedural stars filling the galaxy beyond the catalogues */
  procStars!: ProceduralStarLayer;
  readonly milkyWay = new MilkyWay();
  exo!: ExoPlanetLayer;
  /** game mode: ship, cockpit, warp, traffic, missions */
  game!: Game;
  /** walking on the ground (src/app/Walk.ts) */
  walk!: Walk;
  /** other galaxies (SIMBAD) */
  galaxies!: GalaxiesLayer;
  /** nebulae and star clusters (SIMBAD) */
  deepSky!: DeepSkyLayer;
  /** the searchable catalogue of ~200,000 real objects (universe/Catalog.ts, public/data/catalog) */
  objCatalog: Catalog | null = null;
  /** real spacecraft (JPL Horizons trajectories) */
  craft!: SpacecraftLayer;
  /** close-up map tiles for the body being approached */
  tiles!: TileDetail;
  /** the lighter set of content, for devices with little memory (src/core/device.ts) */
  lean = false;
  /** photo mode (U): panels and labels hidden (read by Walk for its own HUD line) */
  photoMode = false;
  private labelsBeforePhoto = true;
  /** real 3D ground under the explorer near solid worlds */
  readonly terrain = new PlanetTerrain();
  /** the Milky Way drawn per pixel from outside it */
  readonly mwVolume = new MilkyWayVolume();
  /** rocks on the ground around the explorer (on the landing terrain) */
  rocks!: Rocks;
  /** comas and tails of the active comets */
  cometTails!: CometTails;
  /** systems drawn this frame: those of the stars around the explorer, plus a selected/targeted one */
  private nearSystems: PlanetarySystem[] = [];
  activeSystems: PlanetarySystem[] = [];
  private camGal = new Vector3();
  private cssW = 1;
  private cssH = 1;
  private rateIndex = 0;
  private rateSign = 1;
  frameCount = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    hudRoot: HTMLElement,
    labelRoot: HTMLElement,
    readonly system: SolarSystem,
    readonly catalogs: StarCatalog[],
    readonly named: NamedStars,
    readonly starFields: StarFieldLayer[],
    readonly bodies: BodiesLayer,
    readonly orbits: OrbitsLayer,
    readonly small: SmallBodiesLayer,
    readonly near: NearStarsLayer,
    renderer: Renderer,
    readonly systems: Systems,
  ) {
    this.renderer = renderer;
    this.input = new Input(canvas);
    this.hud = new Hud(hudRoot, this);
    this.labels = new Labels(labelRoot);
    this.clock = SimClock.now();
  }

  /**
   * Load everything and build the app. All the downloads start at once, and each tells `progress`
   * when it is in and what it brought (the loading screen shows that: src/ui/Splash.ts). What
   * the explorer cannot do without (the Solar System, the stars) stops the start if it fails;
   * the rest is done without, with a warning.
   */
  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement, labelRoot: HTMLElement, progress = new LoadProgress()): Promise<App> {
    const useGaia = new URLSearchParams(location.search).get('gaia') !== '0';
    const systems = new Systems();
    const today = SimClock.now();
    const json = async <T>(url: string): Promise<T> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url.split('/').pop()}: HTTP ${res.status}`);
      return res.json() as Promise<T>;
    };
    const without = <T>(what: string, work: Promise<T>, instead: T): Promise<T> => work.catch((e) => { console.warn(what, e); return instead; });
    const kinds = (list: Body[], kind: string) => list.filter((b) => b.kind === kind).length;

    const solar = progress.run('solar', Promise.all([
      SolarSystem.load(DATA),
      json<ConstructorParameters<typeof BodiesLayer>[1]>(`${DATA}/textures/manifest.json`),
      json<ConstructorParameters<typeof BodiesLayer>[4]>(`${DATA}/solar/rings.json`),
      json<AtmosphereData>(`${DATA}/solar/atmospheres.json`),
    ]), ([s]) => `${count(kinds(s.bodies, 'planet'), 'planet')}, ${count(kinds(s.bodies, 'moon'), 'moon')}`);
    const stars = progress.run('stars', Promise.all([
      StarCatalog.load('athyg', `${DATA}/stars`),
      useGaia ? StarCatalog.load('gaia', `${DATA}/stars-gaia`) : Promise.resolve(null),
    ]), ([a, g]) => count(a.totalStars + (g?.totalStars ?? 0), 'star'));
    const names = progress.run('named', NamedStars.load(`${DATA}/stars`), (n) => n.list.length.toLocaleString('en-US'));
    const exo = progress.run('exo', without('exoplanets', systems.load(DATA), undefined),
      () => (systems.loaded ? `${count(systems.planetCount, 'planet')} of ${count(systems.count, 'star')}` : 'not available'));
    const deep = progress.run('deep', Promise.all([
      without('black holes', loadBlackHoles(DATA), [] as BlackHole[]),
      without('galaxies', loadGalaxies(DATA), [] as Galaxy[]),
      without('deep sky', loadDeepSky(DATA), [] as DeepSkyObject[]),
    ]), ([holes, galaxies, dso]) => `${count(holes.length, 'black hole')}, ${count(galaxies.length, 'galaxy', 'galaxies')}, ${count(dso.length, 'nebula and cluster', 'nebulae and clusters')}`);
    const smallBodies = progress.run('small', SmallBodiesLayer.fetch(DATA), (d) => `${count(d.orbits.length / 8, 'asteroid')}, ${count(d.comets.length, 'comet')}`);
    // (the Milky Way's map is the largest single file: it comes down beside the rest, and is waited for in firstView)
    const sky = new SkyLayer(`${DATA}/sky/milkyway_4k.jpg`);
    const skyMap = progress.run('sky', sky.ready, (size) => (size ? `${size.width.toLocaleString('en-US')} × ${size.height.toLocaleString('en-US')} pixels` : 'not available'));
    // (these two need the Solar System first)
    const spacecraft = solar.then(([s]) => progress.run('craft', without('spacecraft', loadSpacecraft(DATA, s.sun, s.byId.get(399)!), [] as Spacecraft[]), (c) => count(c.length, 'spacecraft', 'spacecraft')));
    const positions = solar.then(([s]) => progress.run('today', Promise.resolve(s.ephemeris.request(today.jdTdb)),
      () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })));

    const [xrCapable, [system, manifest, rings, atmoData], [catalog, gaia], named, , [blackHoles, galaxyList, dso], smallData, craft] = await Promise.all([
      VRSupport.detect(), solar, stars, names, exo, deep, smallBodies, spacecraft, positions,
    ]);
    const lean = leanDevice(xrCapable);
    const renderer = new Renderer(canvas, xrCapable);
    // Titan's visible disk is the top of its haze: shade it with the measured albedo spectrum
    // (Karkoschka 1998) rather than the Cassini near-infrared surface map.
    const spectral = (manifest as { spectralColors?: Record<string, { linearRGB: [number, number, number]; visualAlbedo: number }> }).spectralColors;
    const titan = system.bodies.find((b) => b.name === 'Titan');
    if (titan && spectral?.titan) {
      const [r, g, bl] = spectral.titan.linearRGB;
      const m = Math.max(r, g, bl);
      titan.texture = null;
      titan.color = [r / m, g / m, bl / m];
      titan.albedo = spectral.titan.visualAlbedo;
      titan.meta.albedo = spectral.titan.visualAlbedo;
    }
    const catalogs = gaia ? [catalog, gaia] : [catalog];
    const starField = new StarFieldLayer(catalog);
    const starFields = [starField, ...catalogs.slice(1).map((c) => new StarFieldLayer(c, starField.psf))];
    const bodies = new BodiesLayer(system, manifest, `${DATA}/textures`, starField.psf, rings);
    const orbits = new OrbitsLayer(system);
    const small = new SmallBodiesLayer(system, starField.psf);
    const near = new NearStarsLayer(starField.psf, bodies.lightExposure);
    const app = new App(canvas, hudRoot, labelRoot, system, catalogs, named, starFields, bodies, orbits, small, near, renderer, systems);
    app.loading = progress;
    systems.indexNamed(named);
    const sc = blackbodyRGB(system.sun.teff);
    const sl = luminance(sc);
    const atmospheres = new AtmospheresLayer(system, atmoData, bodies.surfaceExposure, [sc[0] / sl, sc[1] / sl, sc[2] / sl]);
    bodies.atmosphere = (b) => atmospheres.spec(b);
    app.sky = sky;
    app.skyMap = skyMap;
    app.atmospheres = atmospheres;
    app.blackHoles = blackHoles;
    app.holes = new BlackHoleLayer(blackHoles, bodies.surfaceExposure, renderer.depthMode === 'reversed-z');
    app.jets = new JetsLayer(blackHoles);
    app.galaxy = new GalaxyGlow();
    app.procStars = new ProceduralStarLayer(starField.psf, starField.colorLut, lean);
    app.exo = new ExoPlanetLayer(starField.psf, bodies.surfaceExposure);
    app.exo.gl = renderer.gl;
    app.tiles = new TileDetail(`${DATA}/tiles`, lean);
    app.rocks = new Rocks(app.terrain, lean);
    app.terrain.source = bodies.terrainSource;
    app.cometTails = new CometTails(bodies.surfaceExposure);
    app.craft = new SpacecraftLayer(craft, bodies.surfaceExposure, starField.psf);
    // M87's light is centred on its black hole
    const m87 = galaxyList.find((g) => g.name === 'M87'), m87bh = blackHoles.find((b) => b.name === 'M87*');
    if (m87 && m87bh) m87.upos.copy(m87bh.upos);
    app.galaxies = new GalaxiesLayer(galaxyList, starField.psf, lean);
    app.deepSky = new DeepSkyLayer(dso, starField.psf, starField.colorLut, lean);
    // [catalog] real objects to search and visit; picked ones join the layers above
    app.objCatalog = new Catalog(`${DATA}/catalog`, {
      addBlackHole: (d) => { const b = new BlackHole(app.blackHoles.length, d); app.blackHoles.push(b); return b; },
      addGalaxy: (d, make) => { const g = make(d, app.galaxies.galaxies.length); app.galaxies.add(g); return g; },
      addDeepSky: (d, make) => { const o = make(d, app.deepSky.objects.length); app.deepSky.add(o, starField.psf, starField.colorLut, lean); return o; },
      existing: (names) => app.catalogExisting(names),
    });
    app.objCatalog.onUpdate = () => { app.hud.refreshSearch(); if (app.vr) app.vr.menu.panel.dirty = true; };
    if (new URLSearchParams(location.search).get('procedural') === '0') app.procStars.enabled = false;
    const mw = new URLSearchParams(location.search).get('mw');
    if (mw !== null) sky.brightness = Number(mw);
    renderer.scene.add(sky.mesh, bodies.group, atmospheres.group, orbits.group, small.group, near.group, app.holes.group, app.jets.group, app.procStars.group, app.exo.group, app.terrain.group, app.rocks.group, app.mwVolume.mesh, app.cometTails.group, app.craft.group, app.galaxies.group, app.deepSky.group, ...starFields.map((f) => f.group));
    small.build(smallData);
    app.lean = lean;
    app.vr = new VRSupport(app, xrCapable, DATA);
    app.game = new Game(app);
    app.game.flight.setAtmospheres(atmoData);
    app.walk = new Walk(app); // walking hook
    app.awe = new Awe(app);
    setUploadRenderer(renderer.gl);
    bodies.uploader = (t) => { void uploadTexture(t); };
    app.warmupPending = true;
    app.resize(); // (first: how far back the camera starts depends on the view's shape)
    app.applyUrl();
    app.bindKeys();
    window.addEventListener('resize', () => app.resize());
    return app;
  }

  /**
   * The first view, ready to be looked at: the Milky Way's map, the maps of the world the view
   * starts at, the shaders compiled, and the stars of the sky around (all but the faintest) in.
   * The frames must be running already (start()): they are what asks for all of this. Each piece
   * is waited for FIRST_VIEW_WAIT at most: on a slow line the explorer starts with the rest
   * still arriving, as it always could.
   */
  async firstView(progress: LoadProgress): Promise<void> {
    const started = performance.now();
    const late = () => performance.now() - started > FIRST_VIEW_WAIT;
    /** wait for `frames` more frames to be drawn (or for time to be up) */
    const drawn = (frames: number) => new Promise<void>((resolve) => {
      const until = this.frameCount + frames;
      const poll = () => (this.frameCount >= until || late() ? resolve() : void setTimeout(poll, 30));
      poll();
    });
    const givenUp = new Promise<null>((resolve) => setTimeout(resolve, FIRST_VIEW_WAIT, null));

    const shaders = progress.run('shaders', Promise.race([this.warmed, givenUp]),
      () => count(this.renderer.gl.info.programs?.length ?? 0, 'shader'));

    // the maps of the world in view (and whatever else the first frames ask for)
    const at = this.rig.target instanceof Body && this.bodies.textureKey(this.rig.target) ? this.rig.target : null;
    if (at) progress.begin('world', `Maps of ${at.name}`);
    const world = progress.run('world', async () => {
      const before = UPLOADS.maps;
      await drawn(3);
      for (let quiet = 0; quiet < 3 && !late();) {
        quiet = UPLOADS.idle ? quiet + 1 : 0;
        await drawn(1);
      }
      return UPLOADS.maps - before;
    }, (maps) => (UPLOADS.loading > 0 ? `${count(maps, 'map')}, ${UPLOADS.loading} more on the way` : maps ? count(maps, 'map') : ''));

    // the stars the sky here is made of: the catalogue's regions arrive brightest first
    const field = progress.run('field', async () => {
      const waiting = () => this.catalogs.reduce((n, c) => n + c.pending, 0);
      const loaded = () => this.catalogs.reduce((n, c) => n + c.loadedStars, 0);
      await drawn(3);
      let most = 0;
      for (let quiet = 0; quiet < 3 && !late();) {
        const w = waiting();
        most = Math.max(most, w);
        const share = most > 0 ? 1 - w / most : 1;
        quiet = share >= ENOUGH_STARS ? quiet + 1 : 0;
        if (most > 0) progress.advance('field', share / ENOUGH_STARS, count(loaded(), 'star'));
        await drawn(1);
      }
      return loaded();
    }, (n) => count(n, 'star'));

    await Promise.all([Promise.race([this.skyMap, givenUp]), shaders, world, field]);
    // (the frames drawn while all that arrived were slow for reasons that are over now)
    this.renderer.resetQuality();
  }

  /** What can wait until the explorer is on the screen: the close-up ground, the lists' pictures. */
  afterStart(): void {
    // scanned ground materials for close-up surfaces
    void loadMaterials(DATA, this.lean, (t) => { void uploadTexture(t); }).catch((e) => console.warn('materials', e));
    // photographs of the worlds for the lists (the lists show plain discs until they arrive)
    void fetch(`${DATA}/textures/thumbs.json`).then((r) => r.json())
      .then((t: { cols: number; rows: number; bodies: Record<string, [number, number]> }) => this.hud.setThumbs({ url: `${DATA}/textures/thumbs.jpg`, ...t }))
      .catch((e) => console.warn('thumbnails', e));
  }

  // ------------------------------------------------------------------ setup
  private resize(): void {
    const c = this.renderer.canvas;
    this.cssW = c.clientWidth || window.innerWidth;
    this.cssH = c.clientHeight || window.innerHeight;
    this.rig.viewport.width = this.cssW;
    this.rig.viewport.height = this.cssH;
    // what the camera is aimed at sits in the room the interface leaves (an upright phone: above the card)
    this.rig.aim = this.hud.subjectLift() * this.rig.pixelAngle;
    this.renderer.setSize(this.cssW, this.cssH, canvasRatio(window.devicePixelRatio || 1, this.cssW, this.cssH));
  }

  private applyUrl(): void {
    const q = new URLSearchParams(location.search);
    const t = q.get('time');
    if (t) {
      const d = new Date(t);
      if (!Number.isNaN(d.getTime())) this.clock.jdTdb = utcToTdb(dateToJdUtc(d));
    }
    if (q.get('rate')) this.clock.rate = Number(q.get('rate'));
    if (q.get('paused') === '1') this.clock.paused = true;
    if (q.get('fov')) this.rig.fov = Number(q.get('fov'));
    if (q.get('starlimit')) this.starMagLimit = Number(q.get('starlimit'));
    if (q.get('belt')) this.small.boost = Number(q.get('belt'));
    this.system.update(this.clock.jdTdb);
    const camPc = q.get('campc');
    const target = q.get('target');
    const look = q.get('look');
    if (camPc) {
      const [x, y, z] = camPc.split(',').map(Number);
      this.rig.upos.set(x * PC, y * PC, z * PC);
      this.rig.lookAt(new Vector3(-x, -y, -z).normalize());
    } else if (target) {
      const place = (obj: SpaceObject) => {
        const dist = Number(q.get('dist') ?? 4) * Math.max(obj.radius, 1);
        this.placeNear(obj, dist, Number(q.get('az') ?? 35), Number(q.get('el') ?? 15));
        if (obj instanceof Galaxy && !q.get('el')) {
          const dir = obj.viewDir(this.rig.upos.sub(obj.upos, new Vector3()));
          this.rig.upos.copy(obj.upos).addVec(dir, dist);
          this.rig.lookAt(dir.clone().negate(), obj.major);
        }
        if (obj instanceof BlackHole && !q.get('el')) {
          // the view the autopilot arrives at: just above the disk plane
          const dir = obj.approachDir(this.rig.upos.sub(obj.upos, new Vector3()));
          this.rig.upos.copy(obj.upos).addVec(dir, dist);
          this.rig.lookAt(dir.clone().negate(), obj.diskNormal);
        }
        this.select(obj);
      };
      const obj = this.findByName(target);
      if (obj) place(obj);
      // [catalog] objects only the catalogue has (?target=3C 273): its best exact match
      else void this.objCatalog?.lookup(target).then((o) => { if (o) place(o); });
    } else {
      const earth = this.system.byId.get(399)!;
      this.placeNear(earth, 3.4 * earth.radius * this.rig.framing, 35, 12);
      this.select(earth);
    }
    if (look) {
      const obj = this.findByName(look);
      if (obj) this.rig.lookAt(obj.upos.sub(this.rig.upos, new Vector3()).normalize());
    }
    const ship = q.get('ship');
    if (ship === 'cockpit' || ship === 'chase') this.game.setMode(ship);
  }

  /** Put the camera at `dist` from `obj`, `az` degrees around from the sunward direction, looking at it. */
  placeNear(obj: SpaceObject, dist: number, az = 35, el = 15): void {
    // lit side: towards the Sun, or towards its own star for a planet of another star
    const light = obj instanceof ExoPlanet ? obj.system.host.upos : this.system.sun.upos;
    const sunDir = light.sub(obj.upos, new Vector3());
    if (sunDir.lengthSq() < 1) sunDir.set(1, 0, 0);
    sunDir.normalize();
    const north = new Vector3(0, 0, 1);
    const axis = new Vector3().crossVectors(sunDir, north).normalize();
    const dir = sunDir.clone().applyAxisAngle(north, (az * Math.PI) / 180).applyAxisAngle(axis, (el * Math.PI) / 180);
    this.rig.upos.copy(obj.upos).addVec(dir, dist);
    this.rig.lookAt(dir.clone().negate(), north);
    this.rig.target = obj;
    this.rig.setAnchor(obj instanceof Body || obj instanceof Comet || obj instanceof ExoPlanet || obj instanceof Spacecraft || this.isCompanion(obj) ? obj : null);
  }

  /** true for the companion star of a black hole (it moves on its orbit). */
  isCompanion(obj: SpaceObject | null): boolean {
    return !!obj && this.blackHoles.some((b) => b.companion === obj);
  }

  private bindKeys(): void {
    this.input.onTap = (x, y, touch) => {
      if (!touch && this.walk.onClick()) return; // walking: the click grabs the mouse
      if (touch && this.photoMode) { this.act('photo'); return; } // a tap brings the controls back
      this.select(this.pickAt(x, y, touch));
    };
    this.input.onDoubleTap = (x, y, touch) => {
      const hit = this.pickAt(x, y, touch);
      if (!hit) return;
      this.select(hit);
      // already there: come closer to the place that was tapped (as on a map); else fly there
      if (hit === this.rig.target && !this.rig.autopilot) this.rig.zoomToward({ x, y }, -Math.log(DOUBLE_TAP_ZOOM));
      else this.goTo(hit);
    };
    this.input.onKey = (e) => {
      if (this.game?.active) this.game.audio.start();
      if (this.walk.onKey(e)) return; // walking: B, Space jumps, ...
      switch (e.code) {
        case 'Space': this.act('pause'); e.preventDefault(); break;
        case 'BracketRight': this.act('faster'); break;
        case 'BracketLeft': this.act('slower'); break;
        case 'Backslash': this.act('reverse'); break;
        case 'Backspace': this.act('now'); e.preventDefault(); break;
        case 'KeyG': this.act('go'); break;
        case 'KeyC': this.act('centre'); break;
        case 'KeyL': this.act('labels'); break;
        case 'KeyU': this.act('photo'); break;
        case 'KeyO': this.act('orbits'); break;
        case 'KeyM': this.act('minor'); break;
        case 'KeyH': case 'F1': this.hud.toggleHelp(); e.preventDefault(); break;
        case 'KeyP': this.act('screenshot'); break;
        case 'Enter': case 'Slash': this.hud.openSearch(); e.preventDefault(); break;
        case 'KeyT': this.hud.openExplore('tour'); e.preventDefault(); break;
        case 'Equal': case 'NumpadAdd': this.rig.speedFactor *= 2; break;
        case 'Minus': case 'NumpadSubtract': this.rig.speedFactor /= 2; break;
        case 'Escape': this.cancelOrDeselect(); break;
        case 'KeyV': this.game.cycle(); break;
        case 'KeyJ': this.game.warp(); break;
        case 'KeyN': this.game.audio.setEnabled(!this.game.audio.enabled); this.hud.toast(`Sound ${this.game.audio.enabled ? 'on' : 'off'}`); break;
        case 'KeyK': this.showMissions(); break;
        case 'Comma': this.hud.toast(this.awe.toggleEarth()); break;
        case 'KeyY': if (this.game.flight.on) this.game.flight.cycleSas(e.shiftKey); break;
        case 'KeyI': if (this.game.flight.on) this.game.flight.toggleBoost(); break;
        default:
          if (/^Digit\d$/.test(e.code)) {
            const ids = [10, 199, 299, 399, 499, 599, 699, 799, 899, 999];
            const b = this.system.byId.get(ids[Number(e.code.slice(5))]);
            if (b) { this.select(b); this.goTo(b); }
          }
      }
    };
  }

  // ------------------------------------------------------------------ the interface's requests (HudHost)
  /** What a button of the interface, or the key that stands for it, does. */
  act(action: HudAction): void {
    switch (action) {
      case 'go': if (this.selection) this.goTo(this.selection); break;
      case 'centre': if (this.selection) this.center(this.selection); break;
      // the place chip: look at where the camera is; in open space, choose somewhere to go
      case 'home': if (this.rig.target) this.center(this.rig.target); else this.hud.openExplore(); break;
      case 'deselect': this.select(null); break;
      case 'add-moon': if (this.selection instanceof Body) this.addMoon(this.selection); break;
      case 'unmake': if (this.selection instanceof Body) this.unmake(this.selection); break;
      case 'stop': this.rig.cancelGoto(); break;
      case 'pause': this.togglePause(); break;
      case 'faster': this.timeFaster(); break;
      case 'slower': this.timeSlower(); break;
      case 'reverse': this.timeReverse(); break;
      case 'now': this.realTime(); break;
      case 'labels': this.labels.enabled = !this.labels.enabled; this.hud.toast(`Names ${this.labels.enabled ? 'on' : 'off'}`); break;
      case 'orbits': this.orbits.enabled = !this.orbits.enabled; this.hud.toast(`Orbits ${this.orbits.enabled ? 'on' : 'off'}`); break;
      case 'minor': this.orbits.showMinor = !this.orbits.showMinor; this.hud.toast(`Orbits of asteroids and comets ${this.orbits.showMinor ? 'on' : 'off'}`); break;
      case 'look':
        this.rig.touchDrag = this.rig.touchDrag === 'look' ? 'orbit' : 'look';
        this.hud.toast(this.rig.touchDrag === 'look' ? 'One finger looks around' : 'One finger turns round where you are');
        break;
      case 'photo': this.togglePhoto(); break;
      case 'screenshot': this.screenshot(); break;
    }
  }

  /** Photo mode: every control and name off (or back to how they were). */
  private togglePhoto(): void {
    this.photoMode = !this.photoMode;
    this.hud.setHidden(this.photoMode);
    if (this.photoMode) { this.labelsBeforePhoto = this.labels.enabled; this.labels.enabled = false; } else this.labels.enabled = this.labelsBeforePhoto;
    const leave = this.input.touch ? 'tap to leave' : 'U to leave, P to save a PNG';
    this.hud.toast(this.photoMode ? `Photo mode (${leave})` : 'Photo mode off', 1.8);
  }

  /** The places of a section of the Explore sheet, described from where the camera is. */
  browse(category: Category): Destination[] {
    if (category === 'tour') {
      // (an event is pictured by the world it happens on)
      const world: Record<string, string> = { 'tour:walk17': 'Moon', 'tour:shadow': 'Jupiter', 'tour:eclipse': 'Moon', 'tour:proxima': 'Proxima Cen b' };
      return this.tourItems().map((t) => {
        if (t.id === 'tour:comet') return { ...t, picture: { shape: 'comet', tint: [0.62, 0.92, 1] } };
        const o = world[t.id] ? this.findByName(world[t.id]) : this.resolveSearchId(t.id);
        return { ...t, picture: o ? pictureOf(o) : undefined };
      });
    }
    this.offered.clear();
    return objectsOf(this, category).map((o) => {
      this.offered.set(o.key, o);
      return { label: o.name, detail: describe(this, o), id: `obj:${o.key}`, picture: pictureOf(o) };
    });
  }
  /** the objects of the list last shown, by key */
  private offered = new Map<string, SpaceObject>();

  /** A place was chosen from a list: select it and go. */
  pickDestination(id: string): void {
    if (id.startsWith('tour:')) { this.tourAction(id.slice(5)); return; }
    const obj = this.resolveSearchId(id);
    if (obj) { this.select(obj); this.goTo(obj); }
  }

  // ------------------------------------------------------------------ actions
  togglePause(): void {
    this.clock.paused = !this.clock.paused;
  }
  timeFaster(): void {
    this.rateIndex = Math.min(RATE_STEPS.length - 1, this.rateIndex + 1);
    this.clock.rate = this.rateSign * RATE_STEPS[this.rateIndex];
    this.clock.paused = false;
  }
  timeSlower(): void {
    this.rateIndex = Math.max(0, this.rateIndex - 1);
    this.clock.rate = this.rateSign * RATE_STEPS[this.rateIndex];
  }
  timeReverse(): void {
    this.rateSign *= -1;
    this.clock.rate = this.rateSign * RATE_STEPS[this.rateIndex];
    this.hud.toast(this.rateSign < 0 ? 'Time reversed' : 'Time forward');
  }
  /** Boarding the ship: time runs, at 1x (the date is kept). */
  flightClock(): void {
    if (this.clock.paused || this.clock.rate !== 1) {
      this.rateIndex = 0;
      this.rateSign = 1;
      this.clock.rate = 1;
      this.clock.paused = false;
    }
  }
  realTime(): void {
    this.clock.setUtcNow();
    this.rateIndex = 0;
    this.rateSign = 1;
    this.clock.rate = 1;
    this.clock.paused = false;
    this.hud.toast('Real time');
  }
  /** T: a short list of places that show what the explorer can do. */
  tourItems(): { label: string; detail: string; id: string }[] {
    const lm = (n: string) => this.landmarks.findIndex((l) => l.name === n);
    const idx = (arr: { name: string }[], n: string) => arr.findIndex((o) => o.name === n);
    const items: { label: string; detail: string; id: string }[] = [
      { label: "Inside Saturn's rings", detail: 'float among the ice of the B ring', id: 'place:rings' },
      { label: 'Mount Everest', detail: 'Earth · the top of the world (real elevation data)', id: `lm:${lm('Mount Everest')}` },
      { label: 'Grand Canyon', detail: 'Earth · fly down into the canyon', id: `lm:${lm('Grand Canyon')}` },
      { label: 'Olympus Mons', detail: 'Mars · the tallest volcano known (real elevation data)', id: `lm:${lm('Olympus Mons')}` },
      { label: 'Valles Marineris', detail: 'Mars · a canyon 4,000 km long', id: `lm:${lm('Valles Marineris')}` },
      { label: 'Apollo 11 landing site', detail: 'the Moon · where people first landed', id: `lm:${lm('Apollo 11 landing site')}` },
      { label: 'Walk on the Moon at Apollo 17', detail: 'land in the Taurus-Littrow valley and walk (B: walk / fly)', id: 'tour:walk17' },
      { label: 'Shackleton crater', detail: 'the Moon\'s south pole · long shadows', id: `lm:${lm('Shackleton (lunar south pole)')}` },
      { label: 'A moon\'s shadow on Jupiter', detail: 'jumps to the next shadow transit', id: 'tour:shadow' },
      { label: 'Total lunar eclipse', detail: '3 March 2026 · the Moon in Earth\'s shadow', id: 'tour:eclipse' },
      { label: 'The brightest comet now', detail: 'coma, tails and its nucleus up close', id: 'tour:comet' },
      { label: 'Proxima Cen b', detail: 'nearest exoplanet · land on it', id: 'tour:proxima' },
      { label: 'Gaia BH1', detail: 'the nearest known black hole', id: `bh:${idx(this.blackHoles.map((h) => ({ name: h.name })), 'Gaia BH1')}` },
      { label: 'Orion Nebula', detail: 'a star-forming cloud, 1,300 light years', id: `dso:${idx(this.deepSky.objects, 'Orion Nebula')}` },
      { label: 'Andromeda Galaxy', detail: '2.5 million light years', id: `gx:${this.galaxies.galaxies.findIndex((g) => g.name.startsWith('Andromeda'))}` },
      { label: 'The Milky Way from outside', detail: 'our galaxy, 100,000 light years across', id: 'mw:0' },
    ];
    // (walking needs keys for now: it is not offered where there are none)
    return items.filter((i) => !/:-1$/.test(i.id) && !(i.id === 'tour:walk17' && this.input.touch));
  }

  /** Tour destinations that need more than a fly-to (a time jump, a search): desktop flies there. */
  private tourAction(what: string): void {
    if (what === 'walk17') { this.walk.walkAt(this.landmarks.find((l) => l.name === 'Apollo 17 landing site')!); return; }
    const o = this.prepareTour(what);
    if (o) { this.select(o); this.goTo(o); }
  }

  /**
   * Set up a tour destination (jumping the clock if needed) and return what to fly to; the caller
   * flies (desktop go-to or VR travel).
   */
  prepareTour(what: string): SpaceObject | null {
    if (what === 'proxima') return this.findByName('Proxima Cen b');
    if (what === 'eclipse') {
      this.clock.jdTdb = utcToTdb(dateToJdUtc(new Date('2026-03-03T11:33:00Z')));
      this.clock.paused = true;
      this.hud.toast('3 March 2026, 11:33 UTC: total lunar eclipse (time paused)', 4);
      if (this.vr.active) this.vr.flash('Total lunar eclipse, 3 March 2026');
      return this.findByName('Moon');
    }
    if (what === 'shadow') {
      // the next time a Galilean moon's shadow falls on Jupiter's disk (15-minute steps, up to 4 days)
      const jup = this.findByName('Jupiter') as Body;
      const moons = ['Io', 'Europa', 'Ganymede', 'Callisto'].map((n) => this.findByName(n) as Body);
      const jd0 = this.clock.jdTdb;
      let found: { jd: number; moon: string } | null = null;
      for (let k = 0; k < 4 * 96 && !found; k++) {
        const jd = jd0 + k / 96;
        this.system.update(jd);
        const sun = this.system.sun.upos.sub(jup.upos, new Vector3()).normalize();
        for (const m of moons) {
          const v = m.upos.sub(jup.upos, new Vector3());
          const along = v.dot(sun);
          if (along > 0 && Math.sqrt(v.lengthSq() - along * along) < jup.radius * 0.8) { found = { jd, moon: m.name }; break; }
        }
      }
      this.system.update(jd0);
      if (found) {
        this.clock.jdTdb = found.jd;
        this.clock.paused = true;
        this.hud.toast(`${found.moon}'s shadow on Jupiter (time paused)`, 4);
        if (this.vr.active) this.vr.flash(`${found.moon}'s shadow on Jupiter`);
      }
      return jup;
    }
    if (what === 'comet') {
      const sun = this.system.sun.upos;
      let best: Comet | null = null, bm = Infinity;
      for (const c of this.small.cometObjects) {
        if (c.row[8] === null || !['P', 'C', 'I'].includes(c.row[1])) continue;
        const r = c.upos.sub(sun, new Vector3()).length() / AU;
        const m = c.row[8] + (c.row[9] ?? 10) * Math.log10(Math.max(r, 0.1));
        if (r < 4 && m < bm) { bm = m; best = c; }
      }
      return best;
    }
    return null;
  }

  /** K: missions and recent discoveries. */
  showMissions(): void {
    const m = this.game.missions;
    const lines = m.list.map((x) => `${x.done ? '✔' : '○'} ${x.title}`).join('\n');
    const recent = m.log.slice(0, 5).map((e) => e.name).join(', ');
    this.hud.toast(`Missions ${m.doneCount}/${m.total}\n${lines}${recent ? `\nRecently discovered: ${recent}` : ''}`, 9);
  }

  /** Escape: stop the flight, or close the open panel, or let go of the selection. */
  cancelOrDeselect(): void {
    if (this.rig.autopilot) this.rig.cancelGoto();
    else if (this.hud.open) this.hud.closeSheet();
    else this.select(null);
  }
  /** Human-readable time rate. */
  rateText(): string {
    const r = Math.abs(this.clock.rate);
    const t = r === 1 ? 'real time' : r < 60 ? `${r}×` : r < 3600 ? `${(r / 60).toFixed(0)} min/s` : r < DAY ? `${(r / 3600).toFixed(0)} h/s`
      : r < 365.25 * DAY ? `${(r / DAY).toFixed(r < 7 * DAY ? 0 : 1)} d/s` : `${(r / (365.25 * DAY)).toFixed(0)} yr/s`;
    return `${this.clock.rate < 0 ? '◀ ' : ''}${t}`;
  }

  /**
   * Choose what the explorer is asking about: its name and facts are shown, and "go to" flies there.
   * The camera stays with what it is at (rig.target) until it does.
   */
  select(obj: SpaceObject | null): void {
    this.selection = obj;
    this.orbits.selected = obj instanceof Body ? obj : null;
    if (obj instanceof CatalogStar) obj.resolve(this.named, () => undefined);
  }

  // ------------------------------------------------------------------ what if (src/app/WhatIf.ts)
  /** the bodies the explorer has made, and how many ever (their numbers are not used twice) */
  readonly made: Body[] = [];
  private madeEver = 0;

  /**
   * Give a world a new moon, between it and the eye, and select it. It is a body like any other
   * from here on. Null if the world cannot have one.
   */
  addMoon(parent: Body): Body | null {
    if (!canHaveMoon(parent, this.made.length)) return null;
    const jd = this.clock.jdTdb;
    const eye = this.rig.upos.sub(parent.upos, new Vector3());
    const plan = newMoon(parent, eye.length(), parent.pos.distanceTo(this.system.sun.pos), jd,
      this.made.filter((m) => m.parent === parent).length, MADE_FIRST_ID + this.madeEver++);
    const moon = this.system.add(plan.json);
    this.system.place(moon, eye.normalize(), jd);
    // (where it is now, before anything asks: the whole system once, as after a jump in time)
    this.system.update(jd);
    this.made.push(moon);
    this.bodies.changed();
    this.select(moon);
    this.hud.toast(`${moon.name}: ${formatDistance(plan.orbit - parent.radius)} up, once round in ${plan.periodDays < 2 ? `${(plan.periodDays * 24).toFixed(1)} hours` : `${plan.periodDays.toFixed(1)} days`}`);
    return moon;
  }

  /** Take away a body the explorer made: the view goes back to what it went round. */
  unmake(b: Body): void {
    const i = this.made.indexOf(b);
    if (i < 0) return;
    const parent = b.parent;
    this.made.splice(i, 1);
    if (this.rig.target === b || this.rig.anchor === b) {
      this.rig.cancelGoto();
      this.rig.target = parent;
      this.rig.setAnchor(parent);
    }
    this.system.remove(b);
    this.bodies.changed(b);
    this.orbits.forget(b);
    this.select(parent);
    this.hud.toast(`${b.name} is gone`);
  }

  /**
   * Compile every material the scene can need (planets, rings, stars, glare, all atmospheres) up
   * front, so a shader is never compiled mid-flight. Runs inside a frame so the headset's variant
   * is compiled while presenting.
   */
  private warmUp(): void {
    const bodyObjs = this.bodies.warmupObjects(), exoObjs = this.exo.warmupObjects();
    // the landing terrain's shader for both kinds of surface material
    const terrain = [bodyObjs.find((m) => m.name === 'Saturn'), exoObjs[0]].filter((m) => !!m).map((m) => this.terrain.warmupMesh(m.material as ShaderMaterial));
    const air = this.atmospheres.warmupObjects()[0];
    if (air) terrain.push(this.terrain.warmupHaze(air.material as ShaderMaterial));
    const objs = [...bodyObjs, ...terrain, ...this.atmospheres.warmupObjects(), ...this.holes.warmupObjects(), ...this.near.warmupObjects(), ...exoObjs, ...this.craft.warmupObjects(), ...this.game.warmupObjects(), ...this.deepSky.warmupObjects(), ...this.galaxies.warmupObjects(), ...this.rocks.warmupObjects(), this.mwVolume.mesh, ...this.cometTails.warmupObjects(), ...this.jets.warmupObjects(), ...this.awe.cues.warmupObjects()];
    const was = objs.map((o) => o.visible);
    for (const o of objs) o.visible = true;
    // (into the HDR target the scene is drawn to: programs differ per output target)
    HITCH.markWarm(false);
    void this.renderer.withSceneTarget(() => this.renderer.gl.compileAsync(this.renderer.scene, this.renderer.camera)).catch(() => undefined).finally(() => { HITCH.markWarm(); this.shadersReady(); });
    this.galaxy.compile(this.renderer.gl);
    objs.forEach((o, i) => { o.visible = was[i]; });
  }

  goTo(obj: SpaceObject): void {
    if (obj instanceof Body) this.bodies.prefetch(obj);
    // arrival distances are those of a wide view; an upright one stands back to frame the same
    const fit = this.rig.framing;
    if (obj instanceof BlackHole) {
      this.rig.flyTo(obj, obj.radius * 30 * fit, undefined, true, obj.approachDir(this.rig.upos.sub(obj.upos, new Vector3())));
      return;
    }
    if (obj instanceof MilkyWay) {
      this.rig.flyTo(obj, obj.radius * 2.6 * fit, undefined, true, obj.viewDir());
      this.hud.toast('Leaving the galaxy');
      return;
    }
    if (obj instanceof DeepSkyObject) {
      this.rig.flyTo(obj, obj.radius * (obj.data.kind === 'open' ? 1.6 : 2.6) * fit);
      return;
    }
    if (obj instanceof Galaxy) {
      // a second "go" from near the galaxy flies into its disc, looking at the bulge
      const from = this.rig.upos.sub(obj.upos, new Vector3());
      if (from.length() < obj.radius * 3) {
        this.rig.flyTo(obj, obj.radius * 0.4, undefined, true, obj.insideDir(from));
        this.hud.toast(`Flying into ${obj.name}`);
        return;
      }
      this.rig.flyTo(obj, obj.radius * 2.4 * fit, undefined, true, obj.viewDir(from));
      this.hud.toast(`Going to ${obj.name} (go again to fly into it)`);
      return;
    }
    let d: number;
    if (obj instanceof Body) d = obj.kind === 'star' ? obj.radius * 8 : Math.max(obj.radius * 3.5, 2e3);
    else if (obj instanceof ExoPlanet) d = obj.radius * 3.5;
    else if (obj instanceof Spacecraft) d = Math.max(obj.radius * 5, 10);
    else if (obj instanceof TrafficShip) d = obj.radius * 6;
    else if (obj instanceof Station) {
      // arrive in front of the docking port, on the hub axis
      this.rig.flyTo(obj, 700, undefined, true, obj.axis.clone());
      this.hud.toast(`Going to ${obj.name}: fly in slowly to dock`);
      return;
    }
    else if (obj instanceof CatalogStar) d = Math.max(obj.radius * 4.5, 2e7);
    else if (obj instanceof Comet) d = Math.max(obj.radius, 2000) * 40;   // close enough to see the nucleus
    else if (obj instanceof RingSpot) {
      this.rig.flyTo(obj, 60, undefined, true, obj.approachDir());
      return;
    } else if (obj instanceof Landmark) {
      // arrive above the place from the side lit by the Sun, looking down at it
      this.rig.flyTo(obj, obj.def.view * fit, undefined, true, obj.approachDir(this.system.sun.upos.sub(obj.world.upos, new Vector3()).normalize()));
      return;
    }
    else d = Math.max(obj.radius * 4, 1e6);
    this.rig.flyTo(obj, d * fit);
  }

  center(obj: SpaceObject): void {
    const dir = obj.upos.sub(this.rig.upos, new Vector3()).normalize();
    this.rig.lookAt(dir);
  }

  screenshot(): void {
    const a = document.createElement('a');
    a.href = this.renderer.screenshot();
    a.download = `${STORAGE_PREFIX}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    this.hud.toast('Screenshot saved');
  }

  private ringSpot: RingSpot | null = null;
  private landmarkCache = new Map<string, Landmark>();

  /** Named places on the landing terrain (Olympus Mons, the Apollo 11 site …). */
  get landmarks(): Landmark[] {
    for (const d of LANDMARKS) {
      if (this.landmarkCache.has(d.name)) continue;
      const w = this.system.bodies.find((b) => b.name === d.body);
      if (w) this.landmarkCache.set(d.name, new Landmark(d, w));
    }
    return [...this.landmarkCache.values()];
  }

  findByName(name: string): SpaceObject | null {
    const n = name.toLowerCase();
    const lm = this.landmarks.find((l) => l.name.toLowerCase() === n || l.name.toLowerCase().startsWith(`${n} (`));
    if (lm) return lm;
    if (/^(saturn'?s? rings?|rings of saturn|the rings|b ring)$/.test(n)) {
      const saturn = this.system.bodies.find((x) => x.name === 'Saturn');
      if (saturn) this.ringSpot ??= new RingSpot(saturn, this.system.sun.upos.sub(saturn.upos, new Vector3()).normalize());
      return this.ringSpot;
    }
    const b = this.system.bodies.find((x) => x.name.toLowerCase() === n);
    if (b) return b;
    const gx = this.galaxies.galaxies.find((g) => g.name.toLowerCase() === n || g.data.simbad.toLowerCase().replace(/\s+/g, '') === n.replace(/\s+/g, '') || (n === 'andromeda' && g.name.startsWith('Andromeda')));
    if (gx) return gx;
    const dso = this.deepSky.objects.find((o) => o.name.toLowerCase() === n || o.data.simbad.toLowerCase().replace(/\s+/g, '') === n.replace(/\s+/g, ''));
    if (dso) return dso;
    const sc = this.craft.craft.find((c) => c.name.toLowerCase() === n || (n === 'iss' && c.name.startsWith('International')) || (n === 'jwst' && c.name.startsWith('James')) || (n === 'hubble' && c.name.startsWith('Hubble')));
    if (sc) { sc.update(this.clock.jdTdb); return sc; }
    const c = this.small.cometObjects.find((x) => x.name.toLowerCase().includes(n));
    if (c) return c;
    const h = this.blackHoles.find((x) => x.name.toLowerCase() === n || x.data.aliases.some((a) => a.toLowerCase() === n));
    if (h) return h;
    const ps = this.procStars.find(name);
    if (ps) return ps;
    if (n === 'milky way' || n === 'galaxy' || n === 'the galaxy') return this.milkyWay;
    const xp = this.systems.findPlanet(name);
    if (xp) return this.exoPlanet(xp.i, xp.k);
    const s = this.named.list.find((x) => x.names.some((nm) => nm.toLowerCase() === n));
    if (s) return this.getStar(this.catalog, s.node, s.slot);
    const xh = this.systems.findHost(name);
    if (xh !== null) return this.exoHost(xh);
    // a generated planet: "<star> <letter>"
    const m = /^(.+)\s([b-k])$/i.exec(name.trim());
    if (m) {
      const host = this.findByName(m[1]);
      const sys = host instanceof CatalogStar ? this.systems.of(host) : null;
      const pl = sys?.planets.find((p) => p.name.toLowerCase() === n);
      if (sys && pl) { sys.update(this.clock.jdTdb); return pl; }
    }
    return null;
  }

  searchItems(q: string): Destination[] {
    const n = q.toLowerCase();
    const out: { label: string; detail: string; id: string; score: number }[] = [];
    const score = (name: string) => {
      const l = name.toLowerCase();
      if (l === n) return 0;
      if (l.startsWith(n)) return 1 + l.length / 100;
      if (l.includes(n)) return 2 + l.length / 100;
      return -1;
    };
    for (const b of this.system.bodies) {
      const s = score(b.name);
      if (s >= 0) out.push({ label: b.name, detail: b.kind === 'moon' ? `moon of ${b.parent?.name}` : b.kind, id: `body:${b.id}`, score: s - (b.kind === 'planet' ? 0.5 : 0) });
    }
    this.small.cometObjects.forEach((c, i) => {
      const s = score(c.name);
      if (s >= 0) out.push({ label: c.name, detail: 'comet', id: `comet:${i}`, score: s + 0.2 });
    });
    {
      const s = Math.min(...['Milky Way', 'galaxy'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(s)) out.push({ label: 'Milky Way', detail: 'our galaxy, seen from outside', id: 'mw:0', score: s - 0.2 });
    }
    this.blackHoles.forEach((h, i) => {
      // SIMBAD-style aliases ("NAME Sgr A*", "M  87") match as typed
      const names = [h.name, ...h.data.aliases.map((a) => a.replace(/^NAME\s+/, '').replace(/\s+/g, ' ')), 'black hole'];
      const best = Math.min(...names.map(score).filter((x) => x >= 0));
      if (Number.isFinite(best)) out.push({ label: h.name, detail: h.supermassive ? 'supermassive black hole' : 'black hole', id: `bh:${i}`, score: best - 0.1 });
      if (h.companion && score(h.companion.name) >= 0) out.push({ label: h.companion.name, detail: 'star orbiting a black hole', id: `bhc:${i}`, score: score(h.companion.name) + 0.3 });
    });
    for (const st of this.named.list) {
      let best = -1;
      for (const nm of st.names) {
        const s = score(nm);
        if (s >= 0 && (best < 0 || s < best)) best = s;
      }
      if (best >= 0) out.push({ label: st.names[0], detail: `star · ${st.names.slice(1, 3).join(', ')}`, id: `star:${st.index}`, score: best + (st.proper ? 0 : 0.3) });
    }
    out.push(...this.systems.search(q, score));
    this.deepSky.objects.forEach((o, i) => {
      const sc = Math.min(...[o.name, o.data.simbad, o.data.simbad.replace(/\s+/g, ''), o.kind].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: o.name, detail: `${o.data.kind === 'open' || o.data.kind === 'globular' ? `${o.data.kind} cluster` : 'nebula'} · ${Math.round(o.data.distPc * 3.2616).toLocaleString()} ly`, id: `dso:${i}`, score: sc + 0.02 });
    });
    this.galaxies.galaxies.forEach((g, i) => {
      const sc = Math.min(...[g.name, g.data.simbad, g.data.simbad.replace(/\s+/g, ''), 'galaxy'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: g.name, detail: `galaxy · ${((g.data.distPc * 3.2616) / 1e6).toFixed(g.data.distPc < 3e5 ? 2 : 1)} million ly`, id: `gx:${i}`, score: sc + (g.name === 'Milky Way' ? 0 : 0.05) });
    });
    {
      const s = Math.min(...["Saturn's rings", 'Saturn rings', 'rings', 'B ring'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(s)) out.push({ label: "Saturn's rings", detail: 'fly into the B ring, among its ice', id: 'place:rings', score: s + 0.1 });
    }
    this.landmarks.forEach((l, i) => {
      const sc = Math.min(...[l.name, l.def.body, 'landing', 'place'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: l.name, detail: `place on ${l.def.body}`, id: `lm:${i}`, score: sc + 0.15 });
    });
    this.craft.craft.forEach((c, i) => {
      const sc = Math.min(...[c.name, 'spacecraft', 'probe'].map(score).filter((x) => x >= 0));
      if (Number.isFinite(sc)) out.push({ label: c.name, detail: 'spacecraft', id: `sc:${i}`, score: sc - 0.1 });
    });
    // [catalog] ~200,000 real objects by name and designation (results arrive asynchronously)
    if (this.objCatalog) {
      const k = normKey(q);
      const have = new Set(out.map((o) => normKey(o.label)));
      for (const r of this.objCatalog.find(q)) {
        if (have.has(normKey(r.label))) continue;
        out.push({ ...r, score: normKey(r.label) === k ? 0.05 : 1.5 });
      }
    }
    out.sort((a, b) => a.score - b.score);
    return out.slice(0, 14).map(({ label, detail, id }) => ({ label, detail, id, picture: this.pictureFor(id) }));
  }

  /** The picture beside a search result (what can be told without loading anything for it). */
  private pictureFor(id: string): Picture | undefined {
    const [kind, v] = id.split(':');
    if (kind === 'star') return { shape: 'star', tint: starTint(this.named.list[Number(v)]?.teff ?? 0) };
    if (kind === 'xh' || kind === 'bhc') return { shape: 'star', tint: starTint(0) };
    if (kind === 'xp') return { shape: 'world', tint: [0.55, 0.66, 0.78] };
    if (kind === 'cat') return undefined; // (a catalogue entry becomes an object only when it is chosen)
    const o = this.resolveSearchId(id);
    return o ? pictureOf(o) : undefined;
  }

  /** [catalog] The app's own object for a catalogue entry, if it has one under any of these names. */
  catalogExisting(names: string[]): SpaceObject | null {
    for (const name of names) {
      const n = name.toLowerCase(), ns = n.replace(/\s+/g, '');
      const g = this.galaxies.galaxies.find((x) => x.name.toLowerCase() === n || x.data.simbad.toLowerCase().replace(/\s+/g, '') === ns);
      if (g) return g;
      const d = this.deepSky.objects.find((x) => x.name.toLowerCase() === n || x.data.simbad.toLowerCase().replace(/\s+/g, '') === ns);
      if (d) return d;
      const h = this.blackHoles.find((x) => x.name.toLowerCase() === n || x.data.aliases.some((a) => a.toLowerCase() === n));
      if (h) return h;
      const st = this.named.list.find((s) => s.names.some((x) => x.toLowerCase() === n));
      if (st) return this.getStar(this.catalog, st.node, st.slot);
    }
    return null;
  }

  resolveSearchId(id: string): SpaceObject | null {
    const [kind, v] = id.split(':');
    if (kind === 'obj') return this.offered.get(id.slice(4)) ?? null;
    if (kind === 'body') return this.system.byId.get(Number(v)) ?? null;
    if (kind === 'comet') return this.small.cometObjects[Number(v)] ?? null;
    if (kind === 'bh') return this.blackHoles[Number(v)] ?? null;
    if (kind === 'mw') return this.milkyWay;
    if (kind === 'bhc') return this.blackHoles[Number(v)]?.companion ?? null;
    if (kind === 'star') { const st = this.named.list[Number(v)]; return this.getStar(this.catalog, st.node, st.slot); }
    if (kind === 'xh') return this.exoHost(Number(v));
    if (kind === 'sc') return this.craft.craft[Number(v)] ?? null;
    if (kind === 'gx') return this.galaxies.galaxies[Number(v)] ?? null;
    if (kind === 'dso') return this.deepSky.objects[Number(v)] ?? null;
    if (kind === 'xp') return this.exoPlanet(Number(v), Number(id.split(':')[2]));
    if (kind === 'place' && v === 'rings') return this.findByName("Saturn's rings");
    if (kind === 'lm') return this.landmarks[Number(v)] ?? null;
    if (kind === 'cat') return this.objCatalog?.resolve(id) ?? null;
    return null;
  }

  /** The star of confirmed-planet system `i`: the catalogue's copy when the archive names one, else built from the archive. */
  exoHost(i: number): CatalogStar {
    const ni = this.systems.namedHost(i);
    if (ni !== null) {
      const st = this.named.list[ni];
      const cs = this.getStar(this.catalog, st.node, st.slot);
      this.systems.claim(cs, i);
      return cs;
    }
    return this.systems.hostStar(i);
  }

  /** Planet `k` of confirmed-planet system `i` (its system becomes active so it moves and is drawn). */
  exoPlanet(i: number, k: number): ExoPlanet | null {
    const sys = this.systems.of(this.exoHost(i));
    if (!sys) return null;
    const name = this.systems.planetName(i, k);
    const pl = sys.planets.find((p) => p.name === name) ?? sys.planets[k] ?? null;
    if (pl) sys.update(this.clock.jdTdb);
    return pl;
  }

  // ------------------------------------------------------------------ per-frame helpers
  /** camera-relative vector -> CSS pixel coordinates; null if behind the camera */
  project(rel: Vector3): { x: number; y: number } | null {
    const v = rel.clone().applyQuaternion(this.invQuat);
    if (v.z >= 0) return null;
    const t = Math.tan((this.view.fovY * Math.PI) / 360);
    const aspect = this.view.aspect;
    const nx = v.x / -v.z / (t * aspect);
    const ny = v.y / -v.z / t;
    return { x: (nx * 0.5 + 0.5) * this.view.width, y: (-ny * 0.5 + 0.5) * this.view.height };
  }

  private chooseAnchor(): void {
    let best: Body | null = null;
    let bestSoi = Infinity;
    const rel = new Vector3();
    for (const b of this.system.bodies) {
      if (!b.valid) continue;
      const soi = b.soiRadius();
      if (soi >= bestSoi) continue;
      const d = b.upos.sub(this.rig.upos, rel).length();
      if (d < soi) { best = b; bestSoi = soi; }
    }
    // close to a ship (game mode) or a spacecraft: ride along with it
    for (const st of this.game.traffic.stations) {
      if (st.upos.sub(this.rig.upos, rel).length() < 3000) { this.rig.setAnchor(st); return; }
    }
    for (const sh of this.game.traffic.ships) {
      if (sh.upos.sub(this.rig.upos, rel).length() < sh.radius * 300) { this.rig.setAnchor(sh); return; }
    }
    for (const cv of this.craft.views) {
      if (cv.dist < Math.max(300 * cv.craft.radius, 2000)) { this.rig.setAnchor(cv.craft); return; }
    }
    // an exoplanet whose Hill sphere we are in (planets of other stars carry the camera along)
    if (!best) {
      let bestExo: ExoPlanet | null = null;
      let bestD = Infinity;
      for (const ev of this.exo.views) {
        if (ev.dist < ev.planet.hill && ev.dist < bestD) { bestExo = ev.planet; bestD = ev.dist; }
      }
      if (bestExo) { this.rig.setAnchor(bestExo); return; }
    }
    const sel = this.selection;
    if (sel instanceof Comet) {
      const d = sel.upos.sub(this.rig.upos, rel).length();
      if (d < 1e9) { this.rig.setAnchor(sel); return; }
    }
    if (sel && this.isCompanion(sel) && sel.upos.sub(this.rig.upos, rel).length() < sel.radius * 60) {
      this.rig.setAnchor(sel);
      return;
    }
    this.rig.setAnchor(best);
  }

  /** the world (a body, or a planet of another star) whose surface is the nearest thing to the camera, and how high above it */
  private nearWorld: { obj: SpaceObject; alt: number } | null = null;

  private computeAltitude(): number {
    let alt = Infinity;
    let world: SpaceObject | null = null;
    const rel = new Vector3();
    // above the landing terrain, the height of the ground below
    const tb = this.terrain.owner;
    const below = this.terrain.below(this.rig.upos);
    if (below) { alt = below.dist - below.ground; world = tb as SpaceObject; }
    for (const b of this.system.bodies) {
      if (!b.valid || b === tb) continue;
      const d = b.upos.sub(this.rig.upos, rel).length() - b.radius;
      if (d < alt) { alt = d; world = b; }
    }
    for (const ev of this.exo.views) if (ev.planet !== tb && ev.dist - ev.planet.radius < alt) { alt = ev.dist - ev.planet.radius; world = ev.planet; }
    const worldAlt = alt;
    if (this.selection instanceof Comet) alt = Math.min(alt, this.selection.upos.sub(this.rig.upos, rel).length() - Math.max(this.selection.radius, 2000));
    alt = Math.min(alt, this.nearestStarDist);
    for (const cv of this.craft.views) alt = Math.min(alt, cv.dist - cv.craft.radius);
    for (const st of this.game.traffic.stations) alt = Math.min(alt, st.upos.sub(this.rig.upos, rel).length() - st.radius * 0.5);
    for (const h of this.blackHoles) {
      alt = Math.min(alt, h.upos.sub(this.rig.upos, rel).length() - h.radius);
      if (h.companion) alt = Math.min(alt, h.companion.upos.sub(this.rig.upos, rel).length() - h.companion.radius);
    }
    this.nearWorld = world && worldAlt <= alt ? { obj: world, alt: Math.max(worldAlt, 0) } : null;
    return Math.max(alt, 0.5);
  }

  /** the orientation, at the previous frame, of the world whose ground is under the camera */
  private carried: { owner: object; q: Quaternion } | null = null;

  /**
   * Near the ground the camera turns with the world, so the ground stays put under it instead of
   * sliding by at the world's spin (465 m/s at Earth's equator), and the sky wheels overhead when
   * time runs fast. From afar it does not: a planet is seen to rotate. Fully below 2 % of the
   * radius above the ground, not at all above 20 %, part of the turn in between. Walking and the
   * ship have frames of their own, and a flight under way is flown about the centre.
   */
  private carryWithGround(): void {
    const world = this.terrain.current;
    const below = world ? this.terrain.below(this.rig.upos) : null;
    if (!world || !below) { this.carried = null; return; }
    const q = new Quaternion().setFromRotationMatrix(world.orient);
    const before = this.carried?.owner === world.ground.owner ? this.carried.q : null;
    this.carried = { owner: world.ground.owner, q };
    // (only a camera that moves with that world's centre: beside a spacecraft in orbit it keeps to the spacecraft)
    if (!before || this.rig.anchor !== world.ground.owner || this.rig.autopilot || this.walk.walking || this.game.flight.on) return;
    const share = 1 - smoothstep(0.02, 0.2, (below.dist - below.ground) / below.ground);
    if (share <= 0) return;
    // the world's turn since the last frame, and the share of it the camera takes
    const turn = q.clone().multiply(before.clone().invert());
    this.rig.carry(below.centre, new Quaternion().slerp(turn, share));
  }

  /**
   * Tell the camera what it has to work with this frame: its target as a pointer finds it (the
   * surface under the camera, how close zooming may come) and which way is up when a world is near.
   */
  private describeSurroundings(): void {
    const rig = this.rig, t = rig.target;
    const below = this.terrain.below(rig.upos);
    rig.surface = 0;
    rig.closest = 1;
    if (t && t === this.terrain.owner && below) {
      // over the landing terrain: the ground itself, down to eye height
      rig.surface = below.ground;
      rig.closest = below.ground + EYE_HEIGHT;
    } else if (t instanceof Body || t instanceof ExoPlanet || t instanceof CatalogStar) {
      rig.surface = t.radius;
      rig.closest = t.radius * 1.002;
    } else if (t instanceof BlackHole) rig.closest = t.radius * 1.5;
    else if (t instanceof Galaxy || t instanceof DeepSkyObject || t instanceof MilkyWay) rig.closest = t.radius * 0.02; // into it
    else if (t instanceof Landmark) rig.closest = 30;
    else if (t instanceof RingSpot) rig.closest = 5;
    else if (t) rig.closest = Math.max(t.radius * 1.5, 2);
    // within a radius of a world its vertical takes over: looking round keeps the horizon level
    const w = this.nearWorld;
    rig.verticalWeight = 0;
    if (w) {
      const d = rig.upos.sub(w.obj.upos, rig.vertical).length();
      if (d > 0) {
        rig.vertical.divideScalar(d);
        rig.verticalWeight = 1 - smoothstep(0.25, 1, w.alt / Math.max(w.obj.radius, 1));
      }
    }
  }

  /** Registry of selectable catalogue stars, keyed by octree node and slot. */
  get catalog(): StarCatalog {
    return this.catalogs[0];
  }

  getStar(cat: StarCatalog, node: number, slot: number): CatalogStar {
    const key = `star:${cat.id}:${node}:${slot}`;
    let cs = this.starCache.get(key);
    const n = cat.nodes[node];
    // named stars belong to the primary (AT-HYG) catalogue
    const nm = cat === this.catalog ? this.named.byNodeSlot.get(`${node}:${slot}`) : undefined;
    if (!cs) {
      const ref = { catalog: cat, node: n, slot };
      if (n.state === 'ready') {
        cs = new CatalogStar(key, cat.starPosition(ref), cat.starAbsMag(ref), nm?.teff ?? cat.starTeff(ref), nm?.spect ?? '', nm?.names ?? [], ref);
        cs.exact = true;
      } else {
        cs = new CatalogStar(key, nm!.pos.clone(), nm!.absMag, nm!.teff, nm!.spect, nm!.names, ref);
      }
      if (!nm) cs.resolve(this.named, () => undefined);
      this.starCache.set(key, cs);
    } else if (!cs.exact && n.state === 'ready') {
      // the name list's position (rounded, and from a different reduction) can be hundreds of AU
      // off the catalogue's: an explorer parked at the star (arrived, or started there) moves with it
      const before = cs.upos.clone();
      cs.setPosition(cat.starPosition({ catalog: cat, node: n, slot }));
      cs.exact = true;
      const shift = cs.upos.sub(before, new Vector3());
      const away = before.sub(this.rig.upos, new Vector3()).length();
      // (an explorer anchored to the star, or to anything that moves with it — its planets and
      // their moons — already follows its anchor: rig.followAnchor; shifting again moved it twice)
      const movesWithStar = (o: unknown): boolean => {
        let x = o as { system?: { host?: unknown }; parentObject?: unknown } | null;
        for (let i = 0; x && i < 6; i++) {
          if (x === cs) return true;
          x = (x.system?.host ?? x.parentObject ?? null) as typeof x;
        }
        return false;
      };
      if (!movesWithStar(this.rig.anchor) && shift.lengthSq() > 0 && away < Math.max(1000 * cs.radius, 50 * shift.length())) this.rig.upos.addVec(shift, 1);
    }
    return cs;
  }

  private updateNearStars(): void {
    // Nearest catalogue stars (for speed control and individual rendering)
    let nearestNamed = Infinity;
    for (const s of this.named.list) {
      const d = s.pos.distanceTo(this.camPc);
      if (d < nearestNamed) nearestNamed = d;
    }
    const near = this.catalogs
      .flatMap((c) => c.nearest(this.camPc, Math.max(NEAR_STAR_RADIUS, Math.min(1, nearestNamed)), 12))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 12);
    const nearestCat = near.length ? near[0].dist : Infinity;
    // Lower bound on the distance of any star the star field draws (half, for motion between updates)
    const searchR = Math.max(NEAR_STAR_RADIUS, Math.min(1, nearestNamed));
    const beyond = near.find((x) => x.dist > NEAR_STAR_RADIUS);
    const bound = beyond ? beyond.dist : near.length < 12 ? searchR : NEAR_STAR_RADIUS;
    this.fieldMinDistPc = Math.min(bound, nearestNamed > NEAR_STAR_RADIUS ? nearestNamed : bound) * 0.5;
    this.nearestStarDist = Math.min(nearestNamed, nearestCat) * PC;
    const list: CatalogStar[] = [];
    for (const { ref, dist } of near) {
      if (dist > NEAR_STAR_RADIUS) break;
      const cs = this.getStar(ref.catalog, ref.node.id, ref.slot);
      list.push(cs);
      // nearest star surface distance
      this.nearestStarDist = Math.min(this.nearestStarDist, dist * PC - cs.radius);
    }
    for (const h of this.blackHoles) {
      if (h.companion && h.companion.upos.sub(this.rig.upos, new Vector3()).length() < COMPANION_RADIUS * PC) list.push(h.companion);
    }
    for (const { star, dist } of this.procStars.nearest(this.camPc, 1, 12)) {
      this.nearestStarDist = Math.min(this.nearestStarDist, dist * PC - star.radius);
      if (dist < NEAR_STAR_RADIUS) list.push(star);
    }
    // planetary systems of the stars around us; claim archive systems for their catalogue stars
    const systems: PlanetarySystem[] = [];
    for (const st of list) {
      if (this.isCompanion(st)) continue;
      const sys = this.systems.of(st);
      if (sys) systems.push(sys);
    }
    // confirmed-planet hosts the catalogues lack (or know only under another name)
    const tmp = new Vector3();
    for (const i of this.systems.hostsNear(this.camPc, NEAR_STAR_RADIUS)) {
      const h = this.systems.hostStar(i);
      const claimedBy = this.systems.claimedBy(i);
      if (claimedBy && list.some((x) => x.key === claimedBy)) continue;
      // the same star from a catalogue: same place (within catalogue distance errors) and brightness
      const twin = list.find((x) => !this.isCompanion(x) && x.upos.sub(h.upos, tmp).length() < 0.03 * PC && Math.abs(x.absMag - h.absMag) < 1.5);
      if (twin) {
        this.systems.claim(twin, i);
        const at = systems.findIndex((y) => y.host === twin);
        const sys = this.systems.of(twin);
        if (at >= 0) systems.splice(at, 1);
        if (sys) systems.push(sys);
        continue;
      }
      list.push(h);
      this.nearestStarDist = Math.min(this.nearestStarDist, h.upos.sub(this.rig.upos, tmp).length() - h.radius);
      const sys = this.systems.of(h);
      if (sys) systems.push(sys);
    }
    // [catalog] visited catalogue stars the star tiles lack (brown dwarfs, pulsars, faint white dwarfs)
    for (const st of this.objCatalog?.nearStars(this.camPc, NEAR_STAR_RADIUS) ?? []) {
      if (list.includes(st) || list.some((x) => x.upos.sub(st.upos, tmp).length() < 0.03 * PC && Math.abs(x.absMag - st.absMag) < 1.5)) continue;
      list.push(st);
      this.nearestStarDist = Math.min(this.nearestStarDist, st.upos.sub(this.rig.upos, tmp).length() - st.radius);
    }
    this.near.stars = list;
    this.nearSystems = systems;
  }

  /** A planet is labelled/pickable once resolved, or while the explorer is inside its system. */
  private exoShown(ev: ExoView): boolean {
    if (ev.pixelRadius >= 0.8 || ev.planet === this.selection) return true;
    const host = ev.planet.system.host;
    const dHost = host.upos.sub(this.rig.upos, new Vector3()).length();
    return dHost < Math.max(400 * AU, ev.planet.spec.aM * 25);
  }

  /** Spacecraft are labelled/pickable once resolved, when selected, or when near enough to find. */
  private craftShown(cv: CraftView): boolean {
    if (cv.pixelRadius > 0.5 || cv.craft === this.selection) return true;
    const reach = cv.craft.isOrbiter ? 3e7 : cv.craft.parentObject ? 5e9 : 0.3 * AU;
    return cv.dist < reach;
  }

  /** Systems to draw: the stars' around us, plus those of a selected or targeted planet or host. */
  private updateActiveSystems(): void {
    const act = [...this.nearSystems];
    for (const o of [this.selection, this.rig.target]) {
      let sys: PlanetarySystem | null = null;
      if (o instanceof ExoPlanet) sys = o.system;
      else if (o instanceof CatalogStar && !this.isCompanion(o) && o.upos.sub(this.rig.upos, new Vector3()).length() < 0.5 * PC) sys = this.systems.of(o);
      if (sys && !act.includes(sys)) act.push(sys);
    }
    this.activeSystems = act;
  }

  /**
   * Fraction of the view a sphere covers, from angles: for bodies so close that their centre may be
   * behind the camera (standing on a surface, skimming it).
   */
  /**
   * Radiance of the daytime sky when the explorer is inside a sunlit atmosphere (0 otherwise):
   * the zenith Rayleigh optical depth (green) times the sunlight, fading through twilight.
   */
  private skyRadiance(): number {
    let best = 0;
    const rel = new Vector3();
    const sky = (tau: number, up: Vector3, sunDir: Vector3, sunIrr: number) => {
      const t = Math.min(1, Math.max(0, (up.dot(sunDir) + 0.1) / 0.2));
      best = Math.max(best, Math.min(1, tau) * (sunIrr / Math.PI) * t * t * (3 - 2 * t));
    };
    for (const v of this.bodies.views.values()) {
      if (!v.resolved || v.body.kind === 'star') continue;
      const spec = this.atmospheres.spec(v.body);
      if (!spec || v.dist > v.body.radius + spec.top * 0.5) continue;
      const up = rel.copy(v.rel).negate().normalize();
      const toSun = this.system.sun.upos.sub(v.body.upos, new Vector3());
      const d = toSun.length();
      sky(spec.betaR[1] * spec.HR, up.clone(), toSun.divideScalar(d), sunIrradianceAt(d));
    }
    for (const e of this.exo.atmospheres()) {
      if (e.rel.length() > e.radius + e.spec.top * 0.5) continue;
      sky(e.spec.betaR[1] * e.spec.HR, e.rel.clone().negate().normalize(), e.sunDir, e.sunIrr);
    }
    return best;
  }

  /** Radiance of the sunlit ring ice around the explorer (0 when not inside Saturn's rings). */
  private ringRadiance(): number {
    const rp = this.bodies.ringParticles;
    const sat = this.system.bodies.find((b) => b.name === 'Saturn');
    if (!(rp?.mesh.visible || rp?.slabActive) || !sat) return 0;
    return (0.6 * sunIrradianceAt(Math.max(sat.pos.distanceTo(this.system.sun.pos), 1))) / Math.PI;
  }

  /** A body's albedo for the exposure: near its ground, the eye adapts to the ground around (TerrainPatch.exposureAlbedo). */
  private surfaceAlbedo(b: Body): number {
    return this.terrain.owner === b ? this.terrain.exposureAlbedo(b.albedo) : b.albedo;
  }

  private seenScratch = new Vector3();

  /**
   * The share of a sun's disc (from the eye: `rel`, `radius`) that no world stands in front of. A
   * sun behind a world shines on nothing the eye sees: it holds no exposure and throws no glare
   * (in a planet's shadow the stars are out, and the planet's night side is there to be seen).
   */
  private inSight(rel: Vector3, radius: number): number {
    let share = 1;
    for (const v of this.bodies.views.values()) {
      if (v.resolved && v.body.kind !== 'star') share = Math.min(share, 1 - hidden(rel, radius, v.rel, v.body.radius));
    }
    for (const ev of this.exo.views) share = Math.min(share, 1 - hidden(rel, radius, ev.rel, ev.planet.radius));
    return share;
  }

  /**
   * The exposures of this frame: `xSurf` for surfaces, `xLight` for a sun's own face, `xStar` for
   * the stars and what glows among them, the limiting magnitude that goes with it, and `xDark`,
   * the exposure of an eye in the dark.
   *
   * The eye settles on the largest bright thing in view (a sunlit world at mid-grey, a star's or a
   * hot disk's face brighter), and nothing in view is shown brighter than its limit. "In view" is
   * measured by how much of the thing is in the frame (src/app/Exposure.ts), so the limits let go
   * gradually as it leaves, and the eye opens up slowly and shuts quickly (adapt).
   *
   * A sun in the frame puts out the stars, and its own face is shown at a sun's level; the worlds
   * beside it stay exposed for themselves. (They used to go down with it: with the Sun a few
   * pixels wide anywhere in the frame, the planet being looked at was black.)
   */
  private updateExposure(dt: number): { xStar: number; xSurf: number; xLight: number; mLim: number; xDark: number } {
    const pixSA = (this.view.pixelAngle * this.view.pixelRatio) ** 2; // per CSS pixel
    const xDark = (0.01 * pixSA) / magToIrradiance(this.starMagLimit);
    const open = Math.log(xDark);
    const look = (rel: Vector3, radius: number) => seen(rel, radius, this.view, this.seenScratch, this.invQuat);
    // what the eye settles on: the bright thing covering most of the frame, its radiance, and the
    // display level a frame-filling one is shown at
    let wBest = 0, lBest = 1, keyBest = 0.45;
    const settle = (coverage: number, radiance: number, key: number) => {
      const w = smoothstep(0.0015, 0.08, coverage);
      if (w > wBest && radiance > 0) { wBest = w; lBest = radiance; keyBest = key; }
    };
    // the limits (log exposure): a lit surface holds the surface exposure down, a sun or a
    // daylit sky the stars' too
    let surfaceLimit = Infinity, lightLimit = Infinity;
    const limitSurface = (level: number, radiance: number, presence: number) => {
      if (radiance > 0) surfaceLimit = Math.min(surfaceLimit, released(Math.log(level / radiance), open, presence));
    };
    const limitLight = (level: number, radiance: number, presence: number) => {
      if (radiance > 0) lightLimit = Math.min(lightLimit, released(Math.log(level / radiance), open, presence));
    };
    const litBy = (distToSun: number, albedo: number) => (albedo * sunIrradianceAt(Math.max(distToSun, 1))) / Math.PI;
    const sunRel = this.system.sun.upos.sub(this.rig.upos, new Vector3());

    // A lit disc holds the surfaces' exposure from the size at which it is drawn as one (each
    // layer's own: BodiesLayer `resolved`, a planet of another star 0.8 px, a spacecraft 0.6): a
    // disc a pixel wide that did not would be drawn ten thousand times too bright with the eye
    // open for the dark, and bloom into a ball of light (a moon of Jupiter from Jupiter; with the
    // worlds exposed for themselves beside a sun, a small planet next to its star).
    for (const v of this.bodies.views.values()) {
      if (!v.resolved) continue;
      const b = v.body;
      const s = look(v.rel, b.radius);
      if (b.kind === 'star') {
        if (v.pixelRadius <= 1.5) continue;
        const L = (AU / SUN_RADIUS) ** 2;
        const shown = this.inSight(v.rel, b.radius);
        if (v.pixelRadius >= 2) settle(s.coverage * shown, L, FACE_KEY);
        // (a small Sun is shown glaring)
        limitLight(starCap(1.8, v.pixelRadius / this.view.pixelRatio), L, s.presence * shown);
        continue;
      }
      // In the world's own shadow none of its sunlit face is in sight (the Sun behind it, the side
      // turned to the eye is all night): what is left to see of it, the lights of its night side
      // and the twilight round its limb, is NIGHT times fainter at the most.
      // (Rings reach out of the shadow and shine as the world does, well beyond its disc.)
      const rings = this.bodies.ringOuter(b);
      const night = rings > 0 ? 1 : 1 + (NIGHT - 1) * hidden(sunRel, SUN_RADIUS, v.rel, b.radius);
      const L = (litBy(b.pos.distanceTo(this.system.sun.pos), Math.min(1, 1.5 * this.surfaceAlbedo(b))) * (this.bodies.sunlit.get(b) ?? 1)) / night;
      if (v.pixelRadius >= 2) settle(s.coverage, L, 0.45);
      limitSurface(1.6, L, rings > 0 ? Math.max(s.presence, look(v.rel, rings).presence) : s.presence);
    }
    for (const cv of this.craft.views) {
      if (cv.pixelRadius <= 0.6) continue;
      const s = look(cv.rel, cv.craft.radius);
      const L = litBy(cv.craft.upos.sub(this.system.sun.upos, new Vector3()).length(), 0.6);
      if (cv.pixelRadius >= 2) settle(s.coverage, L, 0.45);
      limitSurface(1.6, L, s.presence);
    }
    const nucleus = this.cometTails.nucleusView;
    if (nucleus) {
      const s = look(nucleus.rel, nucleus.radius);
      if (s.size / this.view.pixelAngle / this.view.pixelRatio > 2) settle(s.coverage, nucleus.radiance, 0.45);
      // (a comet nucleus is very dark rock: shown grey, not as bright as a planet's disc)
      limitSurface(1.0, nucleus.radiance, s.presence);
    }
    for (const ev of this.exo.views) {
      if (ev.pixelRadius <= 0.8 || ev.radiance <= 0) continue;
      const s = look(ev.rel, ev.planet.radius);
      if (ev.pixelRadius >= 2) settle(s.coverage, ev.radiance, 0.45);
      limitSurface(1.6, ev.radiance, ev.planet.spec.rings ? Math.max(s.presence, look(ev.rel, ev.planet.radius * EXO_RING_REACH).presence) : s.presence);
    }
    // inside Saturn's rings the ice around the explorer is a lit surface filling much of the view
    const ringL = this.ringRadiance();
    if (ringL > 0) {
      settle(0.12, ringL, 0.45);
      limitSurface(1.6, ringL, 1);
    }
    for (const hv of this.holes.views) {
      if (!hv.diskRadiance) continue;
      // A disk is brightest at its inner edge and fades outwards, and its centre is often out of
      // frame while the disk fills it: the eye is set by the brightest part that is in view.
      // Close to the hole its gravity wraps the disk's picture round it: there it is measured
      // as a ball, out to four times the radius of the brightest part in view.
      const whole = look(hv.rel, hv.bh.diskOuter);
      const peak = hv.bh.diskInner * DISK_PEAK_RADIUS;
      const nearest = Math.max(peak, hv.dist * Math.sin(Math.min(Math.PI / 2, Math.max(0, whole.angle - whole.halfFrame))));
      // The inner edge is shown glaring (it blooms): with the hole itself in the frame, the eye is set for that.
      const glare = smoothstep(3, 1, nearest / peak);
      // Away from the hole the disk is flat, and from within its own radius it lies all round
      // the eye: whichever part of it is in the frame holds the exposure, from any side, and
      // is shown as a glowing surface, under the display's white.
      const flat = diskSeen(hv.rel, hv.bh.diskNormal, hv.bh.diskInner, hv.bh.diskOuter, this.view, this.invQuat);
      surfaceLimit = Math.min(surfaceLimit, diskLimit(flat, (r, approach) => this.holes.shownAt(hv.bh, r, approach), 0.9 * (1 + DISK_GLARE * glare), open));
      const L = this.holes.radianceAt(hv.bh, nearest);
      const bright = look(hv.rel, Math.min(4 * nearest, hv.bh.diskOuter));
      if (bright.size / this.view.pixelAngle / this.view.pixelRatio <= 1.5) continue;
      settle(bright.coverage, L, 0.8);
      // (a hot inner disk only takes over the eye once it covers part of the view)
      limitSurface((0.9 + 1.1 * glare) / Math.max(smoothstep(0.0015, 0.08, bright.coverage), 1e-6), L, whole.presence);
    }
    // (unresolved point sources never drive the exposure: their displayed glare is capped in the PSF)
    for (const st of this.near.stars) {
      const rel = st.upos.sub(this.rig.upos, new Vector3());
      const d = rel.length();
      const s = look(rel, st.radius);
      const L = (magToIrradiance(st.absMag + 5 * Math.log10(d / PC) - 5) * d * d) / (Math.PI * st.radius * st.radius);
      const shown = this.inSight(rel, st.radius);
      settle(s.coverage * shown, L, FACE_KEY);
      const px = s.size / this.view.pixelAngle;
      if (px <= 1.5) continue;
      limitLight(starCap(1.4, px / this.view.pixelRatio), L, s.presence * shown);
    }
    // under a daytime sky the eye adapts to the sky: the stars fade out, and the sky itself is a lit surface
    const sky = this.skyRadiance();
    if (sky > 0) {
      const limit = Math.log(1.2 / sky);
      surfaceLimit = Math.min(surfaceLimit, limit);
      lightLimit = Math.min(lightLimit, limit);
    }

    const settled = wBest > 0 ? Math.min(open, open + (Math.log(keyBest / lBest) - open) * wBest) : open;
    const target = Math.min(settled, surfaceLimit);
    const lightTarget = Math.min(target, lightLimit);
    const first = this.frameCount < 3;
    this.logExposure = first ? target : adapt(this.logExposure, target, dt);
    this.logLight = first ? lightTarget : adapt(this.logLight, lightTarget, dt);
    const xSurf = Math.exp(this.logExposure);
    const xLight = Math.exp(Math.min(this.logLight, this.logExposure));
    // Stars keep a floor exposure (artistic, SpaceEngine-like) unless a star or a daylit sky is in view.
    const starTarget = Math.min(lightLimit, open);
    this.logStarCap = first ? starTarget : adapt(this.logStarCap, starTarget, dt, TAU_STARS);
    const xStar = Math.min(Math.exp(this.logStarCap), Math.max(xSurf, xDark * this.starFloor));
    const minEnergy = this.starFields[0].psf.uMinEnergy.value;
    const mLim = irradianceToMag((minEnergy * pixSA) / xStar);
    return { xStar, xSurf, xLight, mLim, xDark };
  }

  /**
   * What a click or a tap at a point of the view means: the object under it, or the one whose label
   * is under it. A finger covers more than a mouse pointer: it reaches FINGER_REACH pixels.
   */
  pickAt(x: number, y: number, touch = false): SpaceObject | null {
    const reach = touch ? FINGER_REACH : POINTER_REACH;
    const label = this.labels.at(x, y, touch ? 8 : 2);
    return (label ? this.pick(label.x, label.y, reach) : null) ?? this.pick(x, y, reach);
  }

  /** The object drawn nearest to a point of the view (CSS px), within `reach` pixels of it or under it. */
  private pick(cx: number, cy: number, reach = POINTER_REACH): SpaceObject | null {
    let best: SpaceObject | null = null;
    let bestScore = Infinity;
    const consider = (obj: SpaceObject, p: { x: number; y: number } | null, radiusPx: number, bias: number) => {
      if (!p) return;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > Math.max(radiusPx, reach)) return;
      const s = d + bias;
      if (s < bestScore) { bestScore = s; best = obj; }
    };
    const mLim = this.lastMLim;
    for (const v of this.bodies.views.values()) {
      if (!v.resolved && v.apparentMag > mLim + 1.5) continue;
      consider(v.body, this.project(v.rel), v.pixelRadius / this.view.pixelRatio, v.resolved ? -6 : -3);
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > mLim) continue;
      consider(c, this.project(c.upos.sub(this.rig.upos, rel)), 0, 0);
    }
    for (const ev of this.exo.views) if (this.exoShown(ev)) consider(ev.planet, this.project(ev.rel), ev.pixelRadius / this.view.pixelRatio, ev.pixelRadius > 2 ? -6 : -3);
    for (const cv of this.craft.views) if (this.craftShown(cv)) consider(cv.craft, this.project(cv.rel), cv.pixelRadius / this.view.pixelRatio, -5);
    for (const gv of this.galaxies.views) if (gv.pixelRadius >= 2.5) consider(gv.galaxy, this.project(gv.rel), Math.min(gv.pixelRadius / this.view.pixelRatio, 80), 2);
    for (const dv of this.deepSky.views) if (dv.pixelRadius >= 3 && dv.dist > dv.obj.radius) consider(dv.obj, this.project(dv.rel), Math.min(dv.pixelRadius / this.view.pixelRatio, 80), 1.5);
    for (const sh of [...this.game.traffic.ships, ...this.game.traffic.stations]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() < 2e6) consider(sh, this.project(r), (Math.atan2(sh.radius, r.length()) / this.view.pixelAngle) / this.view.pixelRatio, -4);
    }
    for (const s of this.near.stars) consider(s, this.project(s.upos.sub(this.rig.upos, rel)), 0, -2);
    for (const { bh, rel: r, shadowPx } of this.labelledHoles()) consider(bh, this.project(r), shadowPx / this.view.pixelRatio, -4);
    if (best) return best;
    // Catalogue stars currently drawn
    let bestRef: { cat: StarCatalog; node: number; slot: number } | null = null;
    const cam = this.camPc;
    for (const cat of this.catalogs) for (const n of cat.needed) {
      const pos = cat.cpuPositions(n);
      if (!pos || !n.absMag) continue;
      for (let i = 0; i < n.drawCount; i++) {
        rel.set(pos[i * 3] - cam.x, pos[i * 3 + 1] - cam.y, pos[i * 3 + 2] - cam.z);
        const d = rel.length();
        if (d < NEAR_STAR_RADIUS) continue;
        const m = n.absMag[i] + 5 * Math.log10(d) - 5;
        if (m > mLim) continue;
        const p = this.project(rel);
        if (!p) continue;
        const ds = Math.hypot(p.x - cx, p.y - cy);
        if (ds > starReach(reach, m)) continue;
        const s = ds + 0.4 * m;
        if (s < bestScore) { bestScore = s; bestRef = { cat, node: n.id, slot: i }; }
      }
    }
    let bestProc: (() => SpaceObject) | null = null;
    this.procStars.forEachVisible(cam, mLim, (r, m, star) => {
      if (r.length() < NEAR_STAR_RADIUS) return;
      const p = this.project(r);
      if (!p) return;
      const ds = Math.hypot(p.x - cx, p.y - cy);
      if (ds > starReach(reach, m)) return;
      const sc = ds + 0.4 * m;
      if (sc < bestScore) { bestScore = sc; bestProc = star; }
    });
    if (bestProc) return (bestProc as () => SpaceObject)();
    if (!bestRef) return null;
    return this.getStar(bestRef.cat, bestRef.node, bestRef.slot);
  }
  private lastMLim = 6;

  /**
   * Pick along a ray (VR controller). `origin` and `dir` are camera-relative,
   * world-oriented. Objects within ~1.5° of the ray (or under it) qualify.
   */
  pickRay(origin: Vector3, dir: Vector3): SpaceObject | null {
    const d = dir.clone().normalize();
    const surface = this.rayHitBody(origin, d);
    if (surface) return surface;
    const tol = (1.5 * Math.PI) / 180;
    let best: SpaceObject | null = null;
    let bestScore = Infinity;
    const tmp = new Vector3();
    const angleTo = (rel: Vector3) => {
      tmp.copy(rel).sub(origin);
      const len = tmp.length();
      return { ang: Math.acos(Math.max(-1, Math.min(1, tmp.dot(d) / len))), len };
    };
    const consider = (obj: SpaceObject, rel: Vector3, radius: number, bias: number) => {
      const { ang, len } = angleTo(rel);
      const size = Math.asin(Math.min(1, radius / Math.max(len, radius * 1.0001)));
      if (ang > Math.max(tol, size)) return;
      const score = ang / tol + bias;
      if (score < bestScore) { bestScore = score; best = obj; }
    };
    const mLim = this.lastMLim;
    for (const v of this.bodies.views.values()) {
      if (!v.resolved && v.apparentMag > mLim + 1.5) continue;
      consider(v.body, v.rel, v.body.radius, v.resolved ? -1 : -0.3);
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > mLim) continue;
      consider(c, c.upos.sub(this.rig.upos, rel).clone(), c.radius, 0);
    }
    for (const ev of this.exo.views) if (this.exoShown(ev)) consider(ev.planet, ev.rel, ev.planet.radius, ev.pixelRadius > 2 ? -1 : -0.3);
    for (const cv of this.craft.views) if (this.craftShown(cv)) consider(cv.craft, cv.rel, cv.craft.radius, -0.6);
    for (const gv of this.galaxies.views) if (gv.pixelRadius >= 2.5) consider(gv.galaxy, gv.rel, gv.galaxy.radius * 0.5, 0.5);
    for (const dv of this.deepSky.views) if (dv.pixelRadius >= 3 && dv.dist > dv.obj.radius) consider(dv.obj, dv.rel, dv.obj.radius * 0.6, 0.4);
    for (const sh of [...this.game.traffic.ships, ...this.game.traffic.stations]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() < 2e6) consider(sh, r, sh.radius, -0.6);
    }
    for (const st of this.near.stars) consider(st, st.upos.sub(this.rig.upos, rel).clone(), st.radius, -0.2);
    for (const { bh, rel: r } of this.labelledHoles()) consider(bh, r, bh.radius * 2.6, -0.5);
    if (best) return best;
    let bestRef: { cat: StarCatalog; node: number; slot: number } | null = null;
    const cam = this.camPc;
    const dpc = new Vector3();
    for (const cat of this.catalogs) for (const n of cat.needed) {
      const pos = cat.cpuPositions(n);
      if (!pos || !n.absMag) continue;
      for (let i = 0; i < n.drawCount; i++) {
        dpc.set(pos[i * 3] - cam.x, pos[i * 3 + 1] - cam.y, pos[i * 3 + 2] - cam.z);
        const dist = dpc.length();
        if (dist < NEAR_STAR_RADIUS) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, dpc.dot(d) / dist)));
        if (ang > tol) continue;
        const m = n.absMag[i] + 5 * Math.log10(dist) - 5;
        if (m > mLim) continue;
        const score = ang / tol + 0.08 * m;
        if (score < bestScore) { bestScore = score; bestRef = { cat, node: n.id, slot: i }; }
      }
    }
    let bestProc: (() => SpaceObject) | null = null;
    this.procStars.forEachVisible(cam, mLim, (r, m, star) => {
      const dist = r.length();
      if (dist < NEAR_STAR_RADIUS) return;
      const ang = Math.acos(Math.max(-1, Math.min(1, r.dot(d) / dist)));
      if (ang > tol) return;
      const score = ang / tol + 0.08 * m;
      if (score < bestScore) { bestScore = score; bestProc = star; }
    });
    if (bestProc) return (bestProc as () => SpaceObject)();
    return bestRef ? this.getStar(bestRef.cat, bestRef.node, bestRef.slot) : null;
  }

  /** Nearest resolved body whose sphere the ray actually hits (what you see along the ray). */
  private rayHitBody(origin: Vector3, d: Vector3): SpaceObject | null {
    let best: SpaceObject | null = null;
    let bestT = Infinity;
    const oc = new Vector3();
    for (const v of this.bodies.views.values()) {
      if (!v.resolved) continue;
      oc.copy(origin).sub(v.rel);
      const b = oc.dot(d);
      const c = oc.lengthSq() - v.body.radius * v.body.radius;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) { bestT = t; best = v.body; }
    }
    for (const ev of this.exo.views) {
      if (ev.pixelRadius < 0.8) continue;
      oc.copy(origin).sub(ev.rel);
      const b = oc.dot(d);
      const disc = b * b - (oc.lengthSq() - ev.planet.radius * ev.planet.radius);
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) { bestT = t; best = ev.planet; }
    }
    return best;
  }

  /**
   * Cheap ray pick for per-frame hover in VR: Solar System bodies, comets, nearby stars and
   * named stars (no scan of the full catalogue).
   */
  pickRayFast(origin: Vector3, dir: Vector3, tolDeg = 2): SpaceObject | null {
    const d = dir.clone().normalize();
    const surface = this.rayHitBody(origin, d);
    if (surface) return surface;
    const tol = (tolDeg * Math.PI) / 180;
    let best: SpaceObject | null = null;
    let bestScore = Infinity;
    const tmp = new Vector3();
    const consider = (obj: SpaceObject, rel: Vector3, radius: number, bias: number) => {
      tmp.copy(rel).sub(origin);
      const len = tmp.length();
      const ang = Math.acos(Math.max(-1, Math.min(1, tmp.dot(d) / len)));
      const size = Math.asin(Math.min(1, radius / Math.max(len, radius * 1.0001)));
      if (ang > Math.max(tol, size)) return;
      const score = ang / tol + bias;
      if (score < bestScore) { bestScore = score; best = obj; }
    };
    const mLim = this.lastMLim;
    for (const v of this.bodies.views.values()) {
      if (!v.resolved && v.apparentMag > mLim + 1.5) continue;
      if (this.occluded(v.rel, v.body)) continue;
      consider(v.body, v.rel, v.body.radius, v.resolved ? -1 : -0.3);
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > mLim) continue;
      consider(c, c.upos.sub(this.rig.upos, rel).clone(), c.radius, 0);
    }
    for (const ev of this.exo.views) if (this.exoShown(ev)) consider(ev.planet, ev.rel, ev.planet.radius, ev.pixelRadius > 2 ? -1 : -0.3);
    for (const cv of this.craft.views) if (this.craftShown(cv)) consider(cv.craft, cv.rel, cv.craft.radius, -0.6);
    for (const gv of this.galaxies.views) if (gv.pixelRadius >= 2.5) consider(gv.galaxy, gv.rel, gv.galaxy.radius * 0.5, 0.5);
    for (const dv of this.deepSky.views) if (dv.pixelRadius >= 3 && dv.dist > dv.obj.radius) consider(dv.obj, dv.rel, dv.obj.radius * 0.6, 0.4);
    for (const sh of [...this.game.traffic.ships, ...this.game.traffic.stations]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() < 2e6) consider(sh, r, sh.radius, -0.6);
    }
    for (const st of this.near.stars) consider(st, st.upos.sub(this.rig.upos, rel).clone(), st.radius, -0.2);
    for (const { bh, rel: r } of this.labelledHoles()) consider(bh, r, bh.radius * 2.6, -0.5);
    if (best) return best;
    const cam = this.camPc;
    let bestStar: { node: number; slot: number } | null = null;
    for (const s of this.named.list) {
      const dist = s.pos.distanceTo(cam);
      if (dist < NEAR_STAR_RADIUS) continue;
      const m = s.absMag + 5 * Math.log10(dist) - 5;
      if (m > Math.min(mLim, 6.5)) continue;
      rel.copy(s.pos).sub(cam);
      const ang = Math.acos(Math.max(-1, Math.min(1, rel.dot(d) / rel.length())));
      if (ang > tol) continue;
      const score = ang / tol + 0.1 * m;
      if (score < bestScore) { bestScore = score; bestStar = s; }
    }
    return bestStar ? this.getStar(this.catalog, bestStar.node, bestStar.slot) : null;
  }

  /** true if the segment camera -> rel is blocked by a resolved body or a black hole's shadow (other than `self`). */
  private occluded(rel: Vector3, self: SpaceObject | null): boolean {
    const dist = rel.length();
    for (const v of this.holes.views) {
      if (v.bh === self || v.dist > dist) continue;
      // shadow seen from the eye: angular radius asin(3√3/2 rs / d); objects behind it out to ~3
      // shadow radii are seen only as displaced, lensed images, so their labels would mislead
      const ang = Math.asin(Math.min(1, (2.598 * v.bh.radius) / v.dist));
      if (self !== v.bh.companion && rel.angleTo(v.rel) < 3 * ang) return true;
    }
    for (const o of this.occluders) {
      if (o.body === self) continue;
      if (o.dist > dist) continue;
      // ray-sphere test (camera at origin, direction rel/dist)
      const t = o.rel.dot(rel) / dist;
      if (t <= 0 || t > dist) continue;
      const d2 = o.rel.lengthSq() - t * t;
      if (d2 < o.radius * o.radius * 0.995) return true;
    }
    return false;
  }
  private occluders: { body: object; rel: Vector3; dist: number; radius: number }[] = [];

  /** Black holes worth a label/pick: near ones, ones being drawn, and the selection. */
  private labelledHoles(): { bh: BlackHole; rel: Vector3; shadowPx: number }[] {
    const out: { bh: BlackHole; rel: Vector3; shadowPx: number }[] = [];
    for (const bh of this.blackHoles) {
      const v = this.holes.views.find((x) => x.bh === bh);
      if (v) { out.push({ bh, rel: v.rel, shadowPx: v.shadowPx }); continue; }
      const rel = bh.upos.sub(this.rig.upos, new Vector3());
      if (bh === this.selection || rel.length() < BH_LABEL_PC * PC) out.push({ bh, rel, shadowPx: 0 });
    }
    return out;
  }

  /** Never let the camera reach an event horizon. */
  /**
   * Never below the landing terrain: an eye height above the ground. Within a few metres of it and
   * not climbing, the explorer walks: eye height is kept over hills and into craters.
   */
  private keepAboveGround(dt: number): void {
    const below = this.terrain.below(this.rig.upos);
    if (!below) return;
    const EYE = EYE_HEIGHT;
    const h = below.dist - below.ground;
    const out = this.rig.upos.sub(below.centre, new Vector3()).normalize();
    let target = h;
    if (h < EYE) target = EYE;
    else if (h < 4 && !this.rig.autopilot && this.rig.vel.dot(out) < 0.05 && this.rig.rising <= 0 && !this.input.keys.has('KeyR')) {
      target = h + (EYE - h) * (1 - Math.exp(-dt * 6));
    }
    if (target !== h) this.rig.upos.addVec(out, target - h);
  }

  private keepOutsideHorizons(): void {
    const rel = new Vector3();
    for (const h of this.blackHoles) {
      this.rig.upos.sub(h.upos, rel);
      const d = rel.length();
      const min = h.radius * 1.15;
      if (d < min) this.rig.upos.copy(h.upos).addVec(d > 0 ? rel.divideScalar(d) : rel.set(0, 0, 1), min);
    }
  }

  private labelCandidates(): LabelCandidate[] {
    const out: LabelCandidate[] = [];
    this.occluders = [];
    for (const v of this.bodies.views.values()) {
      if (v.resolved && v.pixelRadius > 2) this.occluders.push({ body: v.body, rel: v.rel, dist: v.dist, radius: v.body.radius });
    }
    // on the landing terrain: the horizon is that of the ground below (a sphere through it, a little
    // lower so labels just above the horizon stay), and planets of other stars occlude too
    const below = this.terrain.below(this.rig.upos);
    if (below) {
      const owner = this.terrain.owner;
      const oc = this.occluders.find((o) => o.body === owner);
      const r = Math.min(below.ground, below.dist) - Math.max(2, (below.dist - below.ground) * 0.02);
      if (oc) oc.radius = r;
      else this.occluders.push({ body: owner!, rel: below.centre.sub(this.rig.upos, new Vector3()), dist: below.dist, radius: r });
    }
    const mLim = this.lastMLim;
    const sel = this.selection;
    const dpr = this.view.pixelRatio;
    for (const v of this.bodies.views.values()) {
      const b = v.body;
      const isSel = b === sel;
      let show = isSel;
      let prio = 0;
      if (b.kind === 'star') { show = true; prio = 600; }
      else if (b.kind === 'planet') { show = show || v.apparentMag < mLim + 2 || v.resolved; prio = 500 - v.apparentMag; }
      else if (b.kind === 'dwarf') { show = show || v.apparentMag < mLim || v.resolved; prio = 380 - v.apparentMag; }
      else if (b.kind === 'moon') {
        const parentView = b.parent ? this.bodies.views.get(b.parent) : undefined;
        const sep = parentView ? b.pos.distanceTo(b.parent!.pos) / v.dist / this.view.pixelAngle / dpr : 0;
        show = show || ((v.apparentMag < mLim + 1 || v.resolved) && sep > 18 && (!b.radiusEstimated || v.resolved));
        prio = 300 - v.apparentMag + (b.radiusEstimated ? -50 : 0);
      } else {
        show = show || v.resolved || v.apparentMag < Math.min(mLim, 9);
        prio = 200 - v.apparentMag;
      }
      if (!show) continue;
      const p = this.project(v.rel);
      if (!p || this.occluded(v.rel, b)) continue;
      out.push({ rel: v.rel.clone(), key: b.key, text: b.name, x: p.x, y: p.y, radius: v.pixelRadius / dpr, priority: isSel ? 1e4 : prio, cls: isSel ? 'selected' : b.kind });
    }
    const rel = new Vector3();
    for (const c of this.small.cometObjects) {
      if (c.apparentMag > Math.min(mLim, 10) && c !== sel) continue;
      c.upos.sub(this.rig.upos, rel);
      const p = this.project(rel);
      if (p && !this.occluded(rel, null)) out.push({ rel: rel.clone(), key: c.key, text: c.name, x: p.x, y: p.y, radius: 2, priority: c === sel ? 1e4 : 250 - c.apparentMag, cls: c === sel ? 'selected' : 'comet' });
    }
    const cam = this.camPc;
    for (const s of this.named.list) {
      if (!s.proper) continue;
      const d = s.pos.distanceTo(cam);
      if (d < NEAR_STAR_RADIUS) continue;
      const m = s.absMag + 5 * Math.log10(d) - 5;
      if (m > Math.min(mLim - 4, 2.6)) continue;
      rel.copy(s.pos).sub(cam).multiplyScalar(PC);
      const p = this.project(rel);
      if (p && !this.occluded(rel, null)) out.push({ rel: rel.clone(), key: `named:${s.index}`, text: s.names[0], x: p.x, y: p.y, radius: 3, priority: 100 - m, cls: 'star' });
    }
    for (const s of this.near.stars) {
      const p = this.project(s.upos.sub(this.rig.upos, rel));
      if (p) out.push({ rel: rel.clone(), key: s.key, text: s.name, x: p.x, y: p.y, radius: 4, priority: s === sel ? 1e4 : 450, cls: s === sel ? 'selected' : 'star' });
    }
    for (const sh of [...this.game.traffic.stations, ...this.game.traffic.ships]) {
      const r = sh.upos.sub(this.rig.upos, new Vector3());
      if (r.length() > (sh instanceof Station ? 3e7 : 1.5e6) && sh !== sel) continue;
      const p = this.project(r);
      if (p && !this.occluded(r, null)) out.push({ rel: r, key: sh.key, text: sh.name, x: p.x, y: p.y, radius: 3, priority: sh === sel ? 1e4 : 300, cls: sh === sel ? 'selected' : 'ship' });
    }
    for (const cv of this.craft.views) {
      if (!this.craftShown(cv)) continue;
      const p = this.project(cv.rel);
      if (p && !this.occluded(cv.rel, null)) {
        const isSel = cv.craft === sel;
        out.push({ rel: cv.rel.clone(), key: cv.craft.key, text: cv.craft.name, x: p.x, y: p.y, radius: cv.pixelRadius / dpr, priority: isSel ? 1e4 : 460, cls: isSel ? 'selected' : 'craft' });
      }
    }
    for (const ev of this.exo.views) {
      if (!this.exoShown(ev)) continue;
      const p = this.project(ev.rel);
      if (p && !this.occluded(ev.rel, null)) {
        const isSel = ev.planet === sel;
        out.push({ rel: ev.rel.clone(), key: ev.planet.key, text: ev.planet.name, x: p.x, y: p.y, radius: ev.pixelRadius / dpr, priority: isSel ? 1e4 : 470 + Math.min(ev.pixelRadius, 20), cls: isSel ? 'selected' : 'exoplanet' });
      }
    }
    for (const { bh, rel: r, shadowPx } of this.labelledHoles()) {
      const p = this.project(r);
      if (p && !this.occluded(r, bh)) out.push({ rel: r, key: bh.key, text: bh.name, x: p.x, y: p.y, radius: shadowPx / dpr, priority: bh === sel ? 1e4 : 420, cls: bh === sel ? 'selected' : 'blackhole' });
    }
    for (const dv of this.deepSky.views) {
      const isSel = dv.obj === sel;
      if (!isSel && (dv.pixelRadius < 3 || dv.dist < dv.obj.radius * 0.8)) continue;
      const p = this.project(dv.rel);
      if (p && !this.occluded(dv.rel, null)) out.push({ rel: dv.rel.clone(), key: dv.obj.key, text: dv.obj.name, x: p.x, y: p.y, radius: Math.min(dv.pixelRadius / dpr, 60), priority: isSel ? 1e4 : 520 + Math.min(dv.pixelRadius, 40), cls: isSel ? 'selected' : 'nebula' });
    }
    for (const gv of this.galaxies.views) {
      const isSel = gv.galaxy === sel;
      if (!isSel && gv.pixelRadius < 2.5) continue;
      const p = this.project(gv.rel);
      if (p && !this.occluded(gv.rel, null)) out.push({ rel: gv.rel.clone(), key: gv.galaxy.key, text: gv.galaxy.name, x: p.x, y: p.y, radius: Math.min(gv.pixelRadius / dpr, 60), priority: isSel ? 1e4 : 640 + Math.min(gv.pixelRadius, 50), cls: isSel ? 'selected' : 'galaxy' });
    }
    {
      const mw = this.milkyWay;
      const r = mw.upos.sub(this.rig.upos, new Vector3());
      if (r.length() > mw.radius * 1.4 || sel === mw) {
        const p = this.project(r);
        if (p && !this.occluded(r, null)) out.push({ rel: r, key: mw.key, text: mw.name, x: p.x, y: p.y, radius: 40, priority: sel === mw ? 1e4 : 700, cls: sel === mw ? 'selected' : 'galaxy' });
      }
    }
    if (sel instanceof CatalogStar && !this.near.stars.includes(sel)) {
      const p = this.project(sel.upos.sub(this.rig.upos, rel));
      if (p && !this.occluded(rel, null)) out.push({ rel: rel.clone(), key: sel.key, text: sel.name, x: p.x, y: p.y, radius: 3, priority: 1e4, cls: 'selected' });
    }
    return out;
  }

  // ------------------------------------------------------------------ main loop
  start(): void {
    // setAnimationLoop follows the display's refresh, or the headset's while presenting.
    this.renderer.gl.setAnimationLoop(() => this.frame());
  }

  frame(): void {
    const now = performance.now();
    PERF.frameStart(now);
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    // Camera/controls use a clamped step for stability; the simulation clock follows real time.
    const dt = Math.min(0.1, rawDt);
    this.lastTime = now;
    if (rawDt > 0) this.fps += (1 / rawDt - this.fps) * 0.05;
    this.frameCount++;
    HITCH.begin();

    // 1. time and ephemerides
    // (in the ship, physics picks the universe step: time warp limits, dilation; the ship moves first)
    const flight = this.game.flight;
    const jd0 = this.clock.jdTdb;
    if (flight.on) this.clock.jdTdb += flight.before(rawDt, dt) / DAY;
    else this.clock.advance(Math.min(rawDt, 1));
    if (flight.on) {
      flight.simDt = Math.max(0, (this.clock.jdTdb - jd0) * DAY);
      flight.step();
    }
    const jd = this.clock.jdTdb;
    this.system.update(jd, this.clock.paused ? 0 : Math.sign(this.clock.rate), this.simFocus());
    HITCH.lap('solarSystem');
    for (const h of this.blackHoles) h.update(jd);
    // planets and spacecraft move before the camera follows its anchor (which may be one of them)
    for (const sys of this.activeSystems) sys.update(jd);
    for (const c of this.craft.craft) c.update(jd);
    HITCH.lap('ephemeris');
    PERF.lap('sim');

    if (this.selection instanceof CatalogStar && !this.selection.exact && this.selection.ref) {
      const r = this.selection.ref;
      this.getStar(r.catalog, r.node.id, r.slot);
    }
    // 2. camera: co-move with the reference body (and, near its ground, turn with it), then apply controls
    this.rig.followAnchor();
    this.carryWithGround();
    this.chooseAnchor();
    this.awe?.beginFrame();
    this.camPc.set((this.rig.upos.xh + this.rig.upos.xl) / PC, (this.rig.upos.yh + this.rig.upos.yl) / PC, (this.rig.upos.zh + this.rig.upos.zl) / PC);
    HITCH.lap('anchor');
    if (this.nearTimer-- <= 0) {
      this.updateNearStars();
      this.nearTimer = 10;
      HITCH.lap('nearScan');
    }
    this.rig.altitude = this.computeAltitude();
    this.describeSurroundings();
    HITCH.lap('altitude');
    if (this.vr.active) this.vr.updateInput(dt);
    this.rig.braking = this.input.keys.has('KeyX');
    // walking (src/app/Walk.ts) owns the camera while on foot; otherwise free flight
    if (this.walk.update(dt)) { /* on foot */ }
    else if (flight.on) {
      // the warp drive / docking computer flies the rig; physics resumes at drop-out
      if (flight.external) this.rig.update(dt, this.input);
      flight.after(dt);
    }
    else {
      this.rig.update(dt, this.input);
      this.keepOutsideHorizons();
      this.keepAboveGround(dt);
    }
    this.camPc.set((this.rig.upos.xh + this.rig.upos.xl) / PC, (this.rig.upos.yh + this.rig.upos.yl) / PC, (this.rig.upos.zh + this.rig.upos.zl) / PC);

    // The dolly carries the explorer's orientation; a headset pose is applied on top of it.
    this.renderer.rig.quaternion.copy(this.rig.quat);
    this.renderer.rig.updateMatrixWorld(true);
    PERF.lap('cam');
    const cam = this.renderer.camera;
    cam.fov = this.rig.fovY;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.view = this.renderer.viewInfo();
    this.invQuat.copy(this.view.quat).invert();
    // culling cone for per-object layers: the frame's corners plus a margin (more in a headset:
    // the second eye and head motion until the next frame)
    VIEW_CONE.set(this.view.quat, this.view.fovY, this.view.aspect, this.view.xr ? 0.35 : 0.12);
    // Headset runtimes may clamp the far plane: pull distant geometry inside it, and fit log depth to it.
    // (not with reversed-Z in the headset: Renderer.reverseXrProjections drops the runtime's far plane)
    const finiteFar = this.view.xr && Number.isFinite(this.view.far) && this.renderer.depthMode !== 'reversed-z';
    GLOBALS.uPullIn.value = finiteFar ? this.view.far * 0.5 : 0;
    LITE.uLite.value = this.vr.active ? 1 : 0;
    GLOBALS.uDepthK.value = finiteFar ? depthK(this.renderer.camera.far) : 1;
    HITCH.lap('camera');

    // 3. exposure and level of detail
    const pixelAngle = this.view.pixelAngle;
    // the Sun's glare (the desktop bloom alone leaves a resolved Sun a bare dot)
    this.bodies.glareOn = true;
    this.bodies.glareVr = this.vr.active;
    const sunRel = this.system.sun.upos.sub(this.rig.upos, new Vector3());
    const sunSeen = seen(sunRel, this.system.sun.radius, this.view, this.seenScratch, this.invQuat);
    // (no glare from a Sun behind a world: as the worlds stood a frame ago)
    this.bodies.glarePresence = sunSeen.presence * this.inSight(sunRel, this.system.sun.radius);
    // (the glare is a far-off Sun's: once its disk takes a twelfth of the frame's half-width it fades, gone by a third)
    const halfY = (this.view.fovY * Math.PI) / 360;
    this.bodies.glareFill = smoothstep(0.08, 0.35, sunSeen.size / Math.min(halfY, Math.atan(Math.tan(halfY) * this.view.aspect)));
    this.bodies.allowHi = !this.vr.active && !this.lean;
    this.bodies.update(this.rig.upos, pixelAngle, dt, this.view.quat);
    HITCH.lap('bodies');
    this.bodies.updateDetail(this.renderer.gl, this.tiles, pixelAngle, new Vector3(0, 0, -1).applyQuaternion(this.view.quat));
    HITCH.lap('bodyDetail');
    PERF.lap('bodies');
    this.atmospheres.steps = this.vr.active ? 10 : 16;
    this.atmospheres.update(this.rig.upos, this.bodies.views);
    HITCH.lap('atmospheres');
    PERF.lap('atmo');
    this.updateActiveSystems();
    HITCH.lap('systems');
    this.exo.showOrbits = this.orbits.enabled;
    this.exo.update(this.rig.upos, pixelAngle, this.activeSystems, jd, now / 1000);
    this.atmospheres.updateExo(this.exo.atmospheres());
    HITCH.lap('exo');
    PERF.lap('exo');
    // landing terrain on the nearest solid world (Solar System body or generated planet)
    {
      const cands = [this.bodies.terrainCandidate(), this.exo.terrainCandidate()].filter((c) => c !== null);
      cands.sort((a, b) => a.alt - b.alt);
      const c = cands[0] ?? null;
      if (c) c.air = this.atmospheres.material(c.ground.owner);
      this.terrain.vr = this.vr.active;
      this.terrain.view = this.view;
      this.terrain.update(c);
      this.rocks.update(this.rig.upos, this.renderer.gl);
      HITCH.lap('terrain');
    }
    PERF.lap('terrain');
    this.craft.update(this.rig.upos, pixelAngle, jd, this.system.sun, this.system.byId.get(399)!);
    HITCH.lap('craft');
    PERF.lap('craft');
    this.holes.vr = this.vr.active;
    this.holes.update(this.rig.upos, pixelAngle, now / 1000);
    // a black hole's environment capture sees every direction: no view culling while one is active
    if (this.holes.views.length) VIEW_CONE.enabled = false;
    // the volume pass: its pixels are larger than the frame's (their noise's level of detail), and
    // inside a hole's lensing region it is not seen at all (the hole draws the surroundings itself)
    VOLUMES.pixelAngle.value = pixelAngle / Math.min(1, LITE.uLite.value > 0.5 ? VOLUMES.scaleXr : VOLUMES.scale);
    VOLUMES.covered = this.holes.views.some((v) => v.inside);
    this.jets.update(this.rig.upos, pixelAngle, now / 1000);
    HITCH.lap('holes');
    PERF.lap('holes');
    const { xStar, xSurf, xLight, mLim, xDark } = this.updateExposure(dt);
    HITCH.lap('exposure');
    const sunDistPc = this.camPc.length();
    GALAXY.toGal(this.camPc, this.camGal);
    this.galaxy.vr = this.vr.active;
    // one face per frame while travelling; all at once if we find ourselves far out with no map yet
    if (sunDistPc > 60) this.galaxy.update(this.renderer.gl, this.camGal, !this.galaxy.ready && sunDistPc > 150 ? 6 : 1);
    HITCH.lap('galaxyCube');
    this.sky.updateWith(xStar / xDark, sunDistPc, this.galaxy.ready ? this.galaxy.target.texture : null, this.camGal);
    this.mwVolume.update(this.rig.upos, this.camGal, this.sky.modelK, SkyLayer.MODEL_REF, this.sky.modelExp);
    HITCH.lap('sky');
    this.galaxies.update(this.rig.upos, pixelAngle, xStar / xDark, smoothstep(300, 1500, sunDistPc), this.view.quat);
    HITCH.lap('galaxies');
    this.deepSky.update(this.rig.upos, this.camPc, pixelAngle, xStar / xDark);
    HITCH.lap('deepSky');
    this.cometTails.gain.value = xStar / xDark;
    // (what a black hole shows of the glow around it follows the glow's brightness)
    this.holes.glowLevel = [this.galaxies.gain.value, this.deepSky.gain.value, this.mwVolume.level, this.cometTails.gain.value];
    PERF.lap('sky');
    this.lastMLim = mLim;
    const psf = this.starFields[0].psf;
    psf.uExposure.value = xStar;
    const dpr = this.view.pixelRatio;
    psf.uPixelSA.value = (this.view.pixelAngle * dpr) ** 2;
    psf.uDpr.value = dpr;
    // The narrowest star is half a pixel of the screen wide, whatever the screen's density: a
    // sharp point on each. (A headset's pixels are large and the head never still: wider there.)
    // Its light is what a star 0.6 px wide had on the display: the faint stars are as bright as
    // they were, in less room.
    psf.uMinSigma.value = this.vr.active ? 0.8 : 0.5 / dpr;
    psf.uPointLight.value = this.vr.active ? 1.41 : 0.79;
    this.bodies.surfaceExposure.value = xSurf;
    this.bodies.lightExposure.value = xLight;
    for (const c of this.catalogs) c.update(this.camPc, mLim, this.fieldMinDistPc);
    HITCH.lap('catalogs');
    for (const f of this.starFields) f.update(this.camPc, NEAR_STAR_RADIUS);
    HITCH.lap('starFields');
    this.procStars.update(this.camPc, mLim, NEAR_STAR_RADIUS, this.vr.active ? 2 : 4);
    HITCH.lap('procStars');
    this.near.update(this.rig.upos, pixelAngle, now / 1000, this.view.quat);
    HITCH.lap('nearStars');
    PERF.lap('stars');
    this.orbits.focus = this.rig.anchor instanceof Body ? this.rig.anchor : null;
    this.orbits.update(this.rig.upos, pixelAngle, jd);
    HITCH.lap('orbits');
    this.small.update(this.rig.upos, jd);
    HITCH.lap('smallBodies');
    this.cometTails.update(this.rig.upos, this.system.sun.upos, this.small.cometObjects, this.selection, jd);
    HITCH.lap('cometTails');

    PERF.lap('orbits');
    this.game.update(dt);
    HITCH.lap('game');
    PERF.lap('game');
    this.awe?.update(dt);
    HITCH.lap('awe');
    PERF.lap('awe'); // scale cues

    // 4. draw
    if (this.warmupPending) {
      this.warmupPending = false;
      this.warmUp();
    }
    HITCH.lap('warmUp');
    UPLOADS.budgetMs = this.vr.active ? 2 : 4;
    UPLOADS.pump();
    HITCH.lap('uploads');
    PERF.gpuBegin();
    this.holes.capture(this.renderer.gl, this.renderer.scene, [this.renderer.rig, this.renderer.volQuad, this.orbits.group, ...this.vr.sceneOverlays], psf);
    HITCH.lap('holeCapture');
    PERF.lap('capture');
    this.renderer.render();
    PERF.gpuEnd();
    HITCH.lap('render');
    PERF.lap('render');

    // 5. overlays
    if (this.vr.active) {
      this.labels.update([], this.cssW, this.cssH);
      this.vr.updateOverlays(this.labelCandidates(), dt);
    } else {
      this.labels.update(this.labelCandidates(), this.view.width, this.view.height);
    }
    HITCH.lap('labels');
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.updateHud();
    }
    HITCH.lap('hud');
    const info = this.renderer.gl.info;
    HITCH.end(info.programs ?? 0, info.memory.textures);
    PERF.lap('overlay');
    PERF.frameEnd();
  }

  private readonly focusSet = new Set<Body>();
  /**
   * The Solar System bodies whose motion must be exact this frame (SolarSystem.update scales the
   * rest with what is on screen): where the camera is and what it is going to or has selected, and
   * every body drawn larger than a pixel last frame.
   */
  private simFocus(): ReadonlySet<Body> | undefined {
    if (SIM_FOCUS_OFF) return undefined;
    const f = this.focusSet;
    f.clear();
    for (const o of [this.rig.anchor, this.rig.target, this.selection]) if (o instanceof Body) f.add(o);
    for (const v of this.bodies.views.values()) if (v.pixelRadius > 0.7) f.add(v.body);
    return f;
  }

  private updateHud(): void {
    const c = this.clock, rig = this.rig;
    let selection: HudState['selection'] = null;
    if (this.selection) {
      const sel = this.selection;
      const d = sel.upos.sub(rig.upos, new Vector3()).length();
      // what the textbook makes of its facts, worked afresh a few times a second (an orbit's speed moves on)
      const now = performance.now();
      if (this.worked.key !== sel.key || now - this.worked.at > 400) this.worked = { key: sel.key, at: now, rows: workedOut(sel) };
      const worked = this.worked.rows;
      // (a fact that is worked out is shown there, with its working: not twice)
      const rows: [string, string][] = [['Distance', distanceText(distanceTo(this, sel))], ...sel.info().filter(([k]) => !worked.some((w) => w.label === k)), ...this.awe.rows(sel, d)];
      if (sel instanceof CatalogStar && !this.isCompanion(sel)) {
        const sys = this.systems.of(sel);
        if (sys) rows.push(['Planets', sys.real ? `${sys.planets.length} confirmed (NASA Exoplanet Archive)` : `${sys.planets.length} generated (not observed)`]);
      }
      selection = {
        key: sel.key, name: sel.name, detail: describe(this, sel), rows, worked, picture: pictureOf(sel), here: sel === rig.target && !rig.autopilot,
        canAddMoon: sel instanceof Body && canHaveMoon(sel, this.made.length), made: sel instanceof Body && this.made.includes(sel),
      };
    }
    // where the camera is: at its target (how high above it, or how far from it), or in open space
    const t = rig.target;
    let place = rig.anchor ? `Near ${rig.anchor.name}` : 'Open space';
    let placeDetail = 'no destination';
    if (t) {
      const d = t.upos.sub(rig.upos, new Vector3()).length();
      place = t.name;
      // close to a world it is a height; from afar, or with nothing to stand on, a distance
      const h = Math.max(d - rig.surface, 0);
      placeDetail = rig.surface > 0 && h < 10 * rig.surface ? `${formatDistance(h)} up` : `${distanceText(rig.surface > 0 ? h : d)} away`;
    }
    if (rig.speed > 0) placeDetail = t ? `${placeDetail} · ${formatSpeed(rig.speed)}` : formatSpeed(rig.speed);
    const drawn = this.starFields.reduce((a, f) => a + f.drawnStars, 0) + this.procStars.drawnStars;
    const loaded = this.catalogs.reduce((a, cat) => a + cat.loadedStars, 0);
    const total = this.catalogs.reduce((a, cat) => a + cat.totalStars, 0);
    const pending = this.catalogs.reduce((a, cat) => a + cat.pending, 0);
    this.hud.update({
      place,
      placeDetail,
      date: formatUtc(c.jdTdb),
      rate: this.rateText(),
      paused: c.paused,
      reversed: c.rate < 0,
      selection,
      flying: rig.autopilot && t ? t.name : null,
      labels: this.labels.enabled,
      orbits: this.orbits.enabled,
      minor: this.orbits.showMinor,
      look: rig.touchDrag === 'look',
      mode: this.walk.active ? 'walk' : this.game.active ? 'ship' : 'explore',
      touch: this.input.touch,
      status: [
        `${this.fps.toFixed(0)} fps`,
        `${(drawn / 1e3).toFixed(0)}k stars drawn, ${(loaded / 1e6).toFixed(2)}M of ${(total / 1e6).toFixed(2)}M loaded`,
        ...(pending ? [`streaming ${pending} star tiles`] : []),
        this.system.usingDE ? 'ephemeris JPL DE442S' : 'ephemeris: approximate elements',
        `depth ${this.renderer.depthMode}`,
      ].join(' · '),
    });
  }

  /** Galaxy model column (L☉/pc², light beyond 300 pc) along world direction `dir` from the eye (debugging). */
  debugGlowColumn(dir: [number, number, number]): number {
    return glowColumn(this.camGal, GALAXY.dirToGal(new Vector3(...dir).normalize()), 400, 300);
  }

  /** Scripting helpers (used by automated tests and the browser console). */
  debugState() {
    return {
      jd: this.clock.jdTdb,
      camera: this.rig.upos.toVector3().toArray(),
      anchor: this.rig.anchor?.name ?? null,
      selection: this.selection?.name ?? null,
      target: this.rig.target?.name ?? null,
      starsDrawn: this.starFields.reduce((a, f) => a + f.drawnStars, 0),
      proceduralDrawn: this.procStars.drawnStars,
      proceduralPending: this.procStars.pending,
      starsLoaded: this.catalogs.reduce((a, c) => a + c.loadedStars, 0),
      pendingTiles: this.catalogs.reduce((a, c) => a + c.pending, 0),
      exposure: this.bodies.surfaceExposure.value,
      lightExposure: this.bodies.lightExposure.value,
      starExposure: this.starFields[0].psf.uExposure.value,
      glare: this.bodies.glareLevel,
      mLim: this.lastMLim,
      depthMode: this.renderer.depthMode,
      usingDE: this.system.usingDE,
      fps: this.fps,
      autopilot: this.rig.autopilot,
    };
  }
}

/** `?simfocus=0`: update every body every frame (A/B of the focus-scaled update) */
const SIM_FOCUS_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('simfocus') === '0';

/**
 * How near a star a tap must be to pick it (px): the whole reach for a bright star, down to a
 * pointer's for a faint one. The sky is full of faint stars: a finger put down between them is
 * not asking for one.
 */
function starReach(reach: number, magnitude: number): number {
  return Math.max(Math.min(reach, POINTER_REACH), Math.min(reach, reach - 3 * (magnitude - 2)));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
